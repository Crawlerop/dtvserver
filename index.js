const express = require("express");
const path = require("path");
const fs_sync = require("fs");
const fs = require("fs/promises");
const ws = require("websocket-as-promised");
const ws_a = require("ws")
const luxon = require("luxon");
const proc = require("process");
const dvb2ip = require("./dvb2ip");
const crypto = require("crypto");
const check_output = require('./utils/check_output')
const cp = require("child_process")
const nms = require("node-media-server")
const events = require("events")
const axios = require("axios")
const os = require("os")
const nc = require("nominatim-client")
const geoip = require("geoip-lite")

const Knex = require("knex")
const knex = Knex(require("./knexFile"))
const objection = require("objection");
const dtv_postcode = require("./dtv_postcodes.json")

objection.Model.knex(knex)

const nominatim = nc.createClient({
    "useragent": "DTV Backend",
    "referer": "https://dvb.ucomsite.my.id/"
})

/*
const bull = require("bull");
const {CancelablePromise} = require("cancelable-promise");
*/

const streams = require("./db/streams");

const config_defaults_nvenc = {
    "name": "DTV Uplink Server",
    "dtv_forward_host": "dvb.ucomsite.my.id",
    "dtv_forward_key": "",
    "dtv_protocol": "frp",
    "streams_path": "(pathname)/streams/",
    "ffmpeg": "ffmpeg",
    "hls_settings": {
        "duration": 2,
        "list_size": 15,
        "unreferenced_segments": 10
    },
    "multiple_renditions": false,
    "dtv_use_tsduck": true,
    "renditions": [
        {
            "hwaccel": "nvenc",
            "width": 1280,
            "height": 720,
            "speed": 1,
            "profile": "high",
            "video_bitrate": 2000000,
            "bufsize": 2500000,
            "bf": 2,
            "interp_algo": 1,
            "audio_bitrate": 128000,
            "audio_profile": "low",
            "audio_codec": "aac"
        },
        {
            "hwaccel": "nvenc",
            "width": 640,
            "height": 360,
            "speed": 1,
            "profile": "main",
            "video_bitrate": 600000,
            "bufsize": 1100000,
            "bf": 2,
            "interp_algo": 1,
            "audio_bitrate": 64000,
            "audio_profile": "low",
            "audio_codec": "aac"
        }
    ],
    "rtmp_settings": {
        "port": 1935,
        "chunk_size": 60000,
        "gop_cache": true,
        "ping": 30,
        "ping_timeout": 60
    },
    "port": 6520
}

const config_defaults = {
    "name": "DTV Uplink Server",
    "dtv_forward_host": "dvb.ucomsite.my.id",
    "dtv_forward_key": "",
    "dtv_protocol": "frp",
    "streams_path": "(pathname)/streams/",
    "ffmpeg": "ffmpeg",
    "hls_settings": {
        "duration": 2,
        "list_size": 15,
        "unreferenced_segments": 10
    },
    "multiple_renditions": false,
    "dtv_use_tsduck": true,
    "renditions": [
        {
            "hwaccel": "nvenc",
            "width": 1280,
            "height": 720,
            "speed": 1,
            "profile": "high",
            "video_bitrate": 2000000,
            "bufsize": 2500000,
            "bf": 2,
            "interp_algo": 1,
            "audio_bitrate": 128000,
            "audio_profile": "low",
            "audio_codec": "aac"
        },
        {
            "hwaccel": "vaapi",
            "width": 640,
            "height": 360,
            "speed": 2,
            "profile": "main",
            "video_bitrate": 600000,
            "bufsize": 1100000,
            "bf": 2,
            "interp_algo": 1,
            "audio_bitrate": 64000,
            "audio_profile": "low",
            "audio_codec": "aac"
        }
    ],
    "rtmp_settings": {
        "port": 1935,
        "chunk_size": 60000,
        "gop_cache": true,
        "ping": 30,
        "ping_timeout": 60
    },
    "port": 6520
}

if (!fs_sync.existsSync(path.join(__dirname, "/config.json"))) fs_sync.writeFileSync(path.join(__dirname, "/config.json"), JSON.stringify(config_defaults, null, 4))
const config = require("./config.json");
const app = express();

app.enable("trust proxy")
app.set('trust proxy', ['loopback', 'linklocal', 'uniquelocal']) 
app.use(express.json())

var StreamDTVJobs = {};
var RTMPStreamID = {};
var pingInterval = null;
var pingTimeout = null;

const rtmp_server = new nms({
    rtmp: config.rtmp_settings,
    logType: 1
})

var ws_p = null

var geo_params = {}

// /var manifest_data = null

const ping = () => {
    ws_p.send(Buffer.from("\0"+JSON.stringify({type: "ping"}), "utf-8"))
    pingInterval = null
    pingTimeout = setTimeout(async ()=>{console.log(`ping timeout for ${config.dtv_forward_host}, reconnecting...`); await ws_p.close()}, 10000)
}

const do_wss = () => {
    ws_p.open().then(() => {
        pingInterval = setTimeout(ping, 2000)
    }).catch((e) => {    
         
    })
}
 
const bufPush = new events.EventEmitter()
const bufTmp = {}

const chunksEV = new events.EventEmitter()
const ss = cp.fork(path.join(__dirname,"utils/sendSegments.js"))

bufPush.on("buffer", (request_id) => {
    const processBuffer = () => {
        if (bufTmp[request_id] !== undefined) {
            const chunk = bufTmp[request_id].splice(0)[0]
            if (chunk) {
                ws_p.send(Buffer.concat([Buffer.from("01", "hex"), Buffer.from(request_id, "hex"), chunk]))
            }
        }

        setImmediate(processBuffer)
    }
    setImmediate(processBuffer)
})

var frp_cp = null

if (config.dtv_forward_key) {
    if (config.dtv_protocol == "frp") {
        frp_cp = cp.spawn(path.join(__dirname, "/bin/frpc"), ["http", "-l", config.port, "-s", config.dtv_forward_host, "-u", config.dtv_forward_key, "-n", crypto.randomBytes(128).toString("hex"), "--log_level", "error"])
    } else {
        ws_p = new ws(`${config.dtv_protocol}://${config.dtv_forward_host}/ws/dtv?token=${config.dtv_forward_key}`, {
            createWebSocket: url => new ws_a(url),
            extractMessageData: event => event
        })

        ws_p.onMessage.addListener(
            /**
             * 
             * @param {Buffer} payload 
             */
            async (payload) => {
                if (payload[0] == 0x00) {
                    const data = JSON.parse(payload.subarray(1).toString("utf-8"))
                    if (data.type == "pong") {
                        if (pingTimeout) clearTimeout(pingTimeout)
                        pingTimeout = null
                        pingInterval = setTimeout(ping, 2000)   
                        return
                    } else if (data.type == "chunk") {
                        chunksEV.emit("chunk", data.request_id, data.worker_id)
                    } else if (data.type == "manifest") {
                        try {
                            const streams_path = `${config.streams_path.replace(/\(pathname\)/g, __dirname)}/${data.id}/`
                            if (!fs_sync.existsSync(`${streams_path}/`)) return ws_p.send(Buffer.from("\0"+JSON.stringify({status: "error", type: "notfound", error: "Stream is inactive or non-existent.", request_id: data.request_id, worker_id: data.worker_id})))
                            const manifest = await fs.readFile(`${streams_path}/${data.path}.m3u8`)
                            return ws_p.send(Buffer.from("\0"+JSON.stringify({status: "ok", manifest: manifest.toString('utf-8'), request_id: data.request_id, worker_id: data.worker_id})))
                        } catch (e) {
                            console.trace(e)
                            ws_p.send(Buffer.from("\0"+JSON.stringify({status: "error", type: e.code == "ENOENT" ? "notfound":"exception", error: e.toString(), request_id: data.request_id, worker_id: data.worker_id})))
                        }
                    } else if (data.type == "segment") {
                        try {
                            const streams_path = `${config.streams_path.replace(/\(pathname\)/g, __dirname)}/${data.id}/`
                            if (!fs_sync.existsSync(`${streams_path}/`)) return ws_p.send(Buffer.from("\0"+JSON.stringify({status: "error", type: "notfound", error: "Stream is inactive or non-existent.", request_id: data.request_id, worker_id: data.worker_id})))
                            
                            const seg_stat = await fs.stat(`${streams_path}/${data.path}.ts`)                        

                            ws_p.send(Buffer.from("\0"+JSON.stringify({status: "ok", size: seg_stat.size, request_id: data.request_id, worker_id: data.worker_id})))
                            ss.send({
                                'path': `${streams_path}/${data.path}.ts`,
                                'dtv_forward_host': config.dtv_forward_host,
                                'dtv_protocol': config.dtv_protocol,
                                'request_id': data.request_id,
                                'worker_id': data.worker_id
                            })

                            //const seg_fd = await fs.open(`${streams_path}/${data.path}.ts`)
                            
                            /*
                            const rd = seg_fd.createReadStream()
                            
                            bufTmp[data.request_id] = []                        
                            
                            console.log("push")
                            bufPush.emit("buffer", data.request_id)  
                            console.log("tick")                      

                            rd.on("data", (c) => {                     
                                console.log(c.length)
                                bufTmp[data.request_id].push(c)
                            })
                            */

                            /*
                            const BLOCK_SIZE = 512*1024

                            let r = await seg_fd.read(Buffer.alloc(BLOCK_SIZE), 0, BLOCK_SIZE)
                            let total_read = 0
                            let send_timeout = null

                            const p = async () => {
                                if (r.bytesRead > 0) {
                                    total_read += r.bytesRead
                                    console.log(r.bytesRead)
                                    ws_p.send(Buffer.concat([Buffer.from("01", "hex"), Buffer.from(data.request_id, "hex"), r.buffer.subarray(0,r.bytesRead)]))
                                    r = await seg_fd.read(Buffer.alloc(BLOCK_SIZE), 0, BLOCK_SIZE)
                                    
                                    setTimeout(p, 500)
                                    /*
                                    chunksEV.once("chunk", (sid) => {
                                        if (data.request_id == sid) {
                                            clearTimeout(send_timeout)                                        
                                            proc.nextTick(p)
                                        }
                                    })

                                    send_timeout = setTimeout(() => {
                                        console.log("send timeout")
                                        ws_p.send(Buffer.concat([Buffer.from("01", "hex"), Buffer.from(data.request_id, "hex")]))
                                        seg_fd.close()
                                    }, 5000)
                                    */
                                /*
                                } else {
                                    console.log(total_read)
                                    console.log(seg_stat.size)
                                    send_timeout = null
                                    seg_fd.close()
                                }
                            }

                            proc.nextTick(p)
                            */

                        } catch (e) {
                            console.trace(e)
                            ws_p.send(Buffer.from("\0"+JSON.stringify({status: "error", type: e.code == "ENOENT" ? "notfound":"exception", error: e.toString(), request_id: data.request_id, worker_id: data.worker_id})))
                        }
                    }
                }
        })

        ws_p.onClose.addListener(() => {
            if (pingInterval) clearTimeout(pingInterval)
            if (pingTimeout) clearTimeout(pingTimeout)
            setTimeout(do_wss, 5000) 
        })

        ws_p.onError.addListener((e) => {
            console.trace(e)
            setTimeout(do_wss, 5000) 
        })

        do_wss()
    }
}

rtmp_server.on('prePlay', async (id, StreamPath, args) => {
    let sid = rtmp_server.getSession(id)    
    if (!StreamPath.startsWith("/live/")) return sid.reject()
    let stream_id = /\/live\/([\s\S]*)/g.exec(StreamPath)    
    if (!stream_id) return sid.reject()
    stream_id = stream_id[1]
    const rtmp_streams = await streams.query().where("type","=","rtmp")
    let found = false
    let found_id = ""    
    for (let i = 0; i<rtmp_streams.length; i++) {
        const rtmp_params = JSON.parse(rtmp_streams[i].params)                
        if (rtmp_params.rtmp_key == stream_id) {
            found = true
            found_id = rtmp_streams[i].stream_id
            break
        }
    }
    if (!found) return sid.reject() 
    if (RTMPStreamID[found_id] != args.token) {
        return sid.reject()
    }
});

rtmp_server.on('prePublish', async (id, StreamPath, args) => {
    let sid = rtmp_server.getSession(id)    
    if (!StreamPath.startsWith("/live/")) return sid.reject()
    let stream_id = /\/live\/([\s\S]*)/g.exec(StreamPath)    
    if (!stream_id) return sid.reject()
    stream_id = stream_id[1]
    const rtmp_streams = await streams.query().where("type","=","rtmp")
    let found = false
    let found_id = ""    
    for (let i = 0; i<rtmp_streams.length; i++) {
        const rtmp_params = JSON.parse(rtmp_streams[i].params)                
        if (rtmp_params.rtmp_key == stream_id) {
            found = true
            found_id = rtmp_streams[i].stream_id
            break
        }
    }
    if (!found) return sid.reject()    
    
    const out_path = `${config.streams_path.replace(/\(pathname\)/g, __dirname)}/${found_id}/`
    await fs.mkdir(out_path, {recursive: true})
    const cur_proc = cp.fork(path.join(__dirname, "/scripts/rtmp.js"))

    cur_proc.on("message", (d) => {        
        if (!d.retry) {
            try {
                delete StreamDTVJobs[found_id]
                delete RTMPStreamID[found_id]
                sid.reject()   
            } catch (e) {
                
            }
        }     
    })
    StreamDTVJobs[found_id] = cur_proc
    RTMPStreamID[found_id] = crypto.randomBytes(32).toString("hex")

    cur_proc.send({
        ffmpeg: config.ffmpeg, 
        rtmp_id: stream_id,
        stream_id: found_id,
        rtmp_port: config.rtmp_settings.port,
        rtmp_token_id: RTMPStreamID[found_id],
        type: "rtmp",
        output_path: out_path, 
        renditions: config.renditions, 
        multiple_renditions: config.multiple_renditions, 
        hls_settings: config.hls_settings
    })
});

rtmp_server.on('donePublish', async (id, StreamPath, args) => {
    let sid = rtmp_server.getSession(id)    
    if (!StreamPath.startsWith("/live/")) returnd.stream_id
    let stream_id = /\/live\/([\s\S]*)/g.exec(StreamPath)    
    if (!stream_id) return
    stream_id = stream_id[1]
    const rtmp_streams = await streams.query().where("type","=","rtmp")
    let found = false
    let found_id = ""    
    for (let i = 0; i<rtmp_streams.length; i++) {
        const rtmp_params = JSON.parse(rtmp_streams[i].params)                
        if (rtmp_params.rtmp_key == stream_id) {
            found = true
            found_id = rtmp_streams[i].stream_id
            break
        }
    }
    if (!found) return 

    if (StreamDTVJobs[found_id]) StreamDTVJobs[found_id].send({quit: true, stream_id: found_id})
});

//const StreamDTV = new bull("broadcast dtv");

const addDTVJobs = (stream_id, type, params) => {
    if (type == "rtmp") return;
    const out_path = `${config.streams_path.replace(/\(pathname\)/g, __dirname)}/${stream_id}/`
    fs.mkdir(out_path, {recursive: true}).then(() => {
        const cur_proc = cp.fork(path.join(__dirname, "/scripts/"+type+".js"))
        if (type == "dvb2ip") {
            cur_proc.send({
                ffmpeg: config.ffmpeg, 
                src: params.src, 
                src_id: params.src_id,
                stream_id: stream_id,
                type: type,
                output_path: out_path, 
                renditions: config.renditions, 
                multiple_renditions: config.multiple_renditions, 
                hls_settings: config.hls_settings
            })
        } else if (type == "dtv") {
            cur_proc.send({
                ffmpeg: config.ffmpeg, 
                tuner: params.tuner,
                frequency: params.frequency,
                channels: params.channels,
                stream_id: stream_id,
                type: type,
                output_path: out_path, 
                renditions: config.renditions, 
                multiple_renditions: config.multiple_renditions, 
                hls_settings: config.hls_settings,
                dtv_use_fork: config.dtv_use_fork
            })
        }
        cur_proc.on("message", (d) => {
            if (d.retry) {
                console.log("stream has encountered an error, retrying.")                
                addDTVJobs(d.stream_id, d.type, d.params)
            } else {            
                delete StreamDTVJobs[d.stream_id]                                
            }
        })
        StreamDTVJobs[stream_id] = cur_proc
    }).catch((e) => {
        console.trace(e)
    })
}

const cors = require("cors")

app.get("/", (req,res)=>{res.sendFile(path.join(__dirname,"website/index.html"))})
app.get("/index.html", (req,res)=>{res.sendFile(path.join(__dirname,"website/index.html"))})
app.use("/static/", express.static(path.join(__dirname, "/website_res/")))

app.get("/play/:stream/:file", cors(), async (req, res) => {
    if (req.params.file.endsWith(".ts")) {
        const have_stream = await streams.query().where("stream_id", "=", req.params.stream)
        if (have_stream.length <= 0) return res.status(404).json({error: "This stream is non-existent."})

        const streams_path = `${config.streams_path.replace(/\(pathname\)/g, __dirname)}/${req.params.stream}/`
        if (!fs_sync.existsSync(`${streams_path}/`)) return res.status(404).json({error: "This stream is not available."})
        if (!fs_sync.existsSync(`${streams_path}/${req.params.file}`)) return res.status(404).json({error: "Not found"})

        return res.status(200).sendFile(`${streams_path}/${req.params.file}`)                          
    } else if (req.params.file.endsWith(".m3u8")) {
        const have_stream = await streams.query().where("stream_id", "=", req.params.stream)
        if (have_stream.length <= 0) return res.status(404).json({error: "This stream is non-existent."})

        const streams_path = `${config.streams_path.replace(/\(pathname\)/g, __dirname)}/${req.params.stream}/`
        if (!fs_sync.existsSync(`${streams_path}/`)) return res.status(404).json({error: "This stream is not available."})

        try {
            const hls_ts_file = await fs.readFile(`${streams_path}/${req.params.file}`, {encoding: "utf-8"})

            return res.status(200).header("Content-Type", "application/x-mpegurl").end(hls_ts_file.replace(/\r/g, "").replace(/#EXT-X-MEDIA-SEQUENCE/g, `#EXT-X-PLAY-ON:DTVAnywhere\n#EXT-X-STREAM-NAME:${have_stream[0].name}\n#EXT-X-STREAM-SOURCE:${have_stream[0].type}\nEXT-X-STREAM-HOSTNAME:${os.hostname()}\n#EXT-X-MEDIA-SEQUENCE`))
        } catch (e) {            
            if (e.code == "ENOENT") {
                res.status(404).json({error: "Not found"})
            } else {
                console.trace(e)
                res.status(500).json({error: e})
            }         
        }

    } else {
        return res.status(403).json({error: "Not OTT content"})
    }
})

/* API */
app.get("/api/streams", async (req, res) => {
    const stream = await streams.query()
    return res.status(200).json(stream)
});

app.post("/api/dvb2ip_get", async (req, res) => {
    if (!req.body.src) return res.status(400).json({"error": "A source address must be specified."})
    try {
        return res.status(200).json({channels: await dvb2ip(req.body.src)})
    } catch (e) {
        return res.status(200).json({channels: []})
    }
});

proc.nextTick(async () => {
    const active_streams = await streams.query().where("active", '=', true)
    for (var v = 0; v<active_streams.length; v++) {        
        addDTVJobs(active_streams[v].stream_id, active_streams[v].type, JSON.parse(active_streams[v].params))
    }
})

app.post("/api/active", async (req, res) => {    
    if (!req.body.id && !req.body.active) return res.status(400).json({error: "A channel id and active flag must be specified."})
    const stream = await streams.query().where("stream_id", '=', req.body.id)
    if (stream.length <= 0) return res.status(400).json({error: `A channel with id ${req.body.id} could not be found.`})
    await streams.query().patch({active: req.body.active}).where("stream_id", '=', req.body.id)
    if (req.body.active) {
        addDTVJobs(req.body.id, stream[0].type, JSON.parse(stream[0].params))
    } else {
        if (StreamDTVJobs[req.body.id]) StreamDTVJobs[req.body.id].send({quit: true, stream_id: req.body.id})
    }
    return res.status(200).json({status: "ok"})
});

app.post("/api/add", async (req, res) => {
    if (!req.body.type) return res.status(400).json({error: "You must specify the stream type"})    
    var random_id = crypto.randomBytes(32).toString("hex")

    switch (req.body.type) {
        case "rtmp":
            if (!req.body.name) return res.status(400).json({error: "A stream name must be specified"}) 
            await streams.query().insert({
                stream_id: random_id,
                name: req.body.name,
                type: req.body.type,
                active: true,
                params: {
                    rtmp_key: crypto.randomBytes(32).toString("hex"),
                    audio_filters: req.body.audio_filters
                }
            })
            return res.status(200).json({status: "ok", id: random_id})            
        case "dvb2ip":
            if (!req.body.name || !req.body.source_id || !req.body.source_address) return res.status(400).json({error: "A stream name, channel source id, and source address must be specified"}) 
            await streams.query().insert({
                stream_id: random_id,
                name: req.body.name,
                type: req.body.type,
                params: {
                    src: req.body.source_address,
                    src_id: req.body.source_id,
                    audio_filters: req.body.audio_filters
                }
            })
            return res.status(200).json({status: "ok", id: random_id})            
            break
        case "dtv":
            if (!req.body.name || !req.body.tuner || !req.body.frequency || !req.body.channels) return res.status(400).json({error: "A stream name, tuner id, frequency, and channels must be specified"}) 
            await streams.query().insert({
                stream_id: random_id,
                name: req.body.name,
                type: req.body.type,
                params: {
                    tuner: req.body.tuner,
                    frequency: req.body.frequency,
                    channels: req.body.channels,
                    audio_filters: req.body.audio_filters
                }
            })
            break
        default:
            return res.status(400).json({error: "Invalid channel input type"})
    }
});

app.post("/api/get_channels_by_frequency", async (req, res) => {
    if (req.body.tuner == undefined || req.body.frequency == undefined) return res.status(400).json({"error": "A tuner and frequency parameters were required."})
    try {
        var dtv_chunk = null
        var found = false

        for (var b = 0; b<5; b++) {
            try {
                dtv_chunk = await check_output('tsp', `-I dvb --signal-timeout 2 --guard-interval auto --receive-timeout 10 --adapter ${req.body.tuner} --delivery-system DVB-T2 --frequency ${req.body.frequency}000000 --transmission-mode auto --spectral-inversion off`.split(" "), 128)
                found = true
                break;
            } catch (e) {}
        }

        if (!found) throw new Error("no channels were found at this frequency")
        const probe_streams = JSON.parse((await check_output(config.ffmpeg.replace(/mpeg/g, "probe"), "-loglevel quiet -print_format json -show_error -show_format -show_programs -".split(" "), 0, dtv_chunk)).toString("utf-8")).programs

        var channels_temp = []
        for (var i = 0; i<probe_streams.length; i++) {
            var program = probe_streams[i];
            var program_streams = [];
            var is_hd = false;

            for (var j = 0; j<program.streams.length; j++) {
                var stream = program.streams[j];
                if (stream.codec_type == "video") {
                    if (stream.height >= 720) is_hd = true
                    program_streams.push({
                        type: "video", 
                        width: stream.width, 
                        height: stream.height,
                        fps: eval(stream.avg_frame_rate),
                        interlace: stream.field_order,
                        id: eval(stream.id),
                        codec: stream.codec_name
                    })
                } else if (stream.codec_type == "audio" && eval(stream.sample_rate) > 0) {
                    program_streams.push({
                        type: "audio", 
                        sample_rate: eval(stream.sample_rate),
                        channels: stream.channels,
                        bitrate: eval(stream.bit_rate) / 1000,
                        id: eval(stream.id),
                        codec: stream.codec_name
                    })
                }
            }

            channels_temp.push({name:program.tags ? program.tags.service_name : `CH${program.program_id}_${program.pmt_pid}_${program.pcr_pid}`, provider:program.tags ? program.tags.service_provider : "",channel_id:program.program_id,channel_pid:[program.pmt_pid,program.pcr_pid],is_hd, streams:program_streams})
        }
        return res.status(200).json({channels: channels_temp})
    } catch (e) {
        return res.status(200).json({channels: []})
    }
});

app.get("/api/tuners", async (req, res) => {
  const tuners = (await check_output("tslsdvb")).toString("ascii").replace(/\r/g, "").split("\n")
  return res.status(200).json({
    status: "ok",
    tuners: tuners
  })
})

app.get("/manifest.json", cors(), async (req, res) => {
    return res.status(200).json({
        name: config.name,
        hostname: os.hostname(),
        server_uptime: os.uptime(),
        os_name: `${os.type()} ${os.release()}`,
        num_streams: (await streams.query()).length,
        country: geo_params.country,
        region_id: geo_params.region_id
    })
})

const PORT = proc.env["PORT"] ? proc.env["PORT"] : config.port

check_output("tsp", ["--version"]).then(()=>{
    check_output(config.ffmpeg, ["-version"]).then(()=>{
        app.listen(PORT, async () => {
            rtmp_server.run()
            const geoip_res = await axios.get("https://dtvtools.ucomsite.my.id/geoip/json")
            const geoip_data = geoip_res.data

            geo_params = {
                country: geoip_data.country,
                region_id: null
            }

            /*
            manifest_data = {
                name: config.name,
                hostname: os.hostname(),
                server_uptime: os.uptime(),
                os_name: `${os.type()} ${os.release()}`,
                num_streams: (await streams.query()).length,
                country: geoip_data.country,
                region_id: null
            }
            */

            const n_res = await nominatim.reverse({lat: geoip_data.ll[0], lon: geoip_data.ll[1], zoom: 17})

            if (!n_res.error) {
                const zip_code = n_res.address.postcode
                switch (geoip_data.country) {
                    case "ID":
                        for (d in dtv_postcode) {
                            if (zip_code.slice(0,3) == d) {
                                geo_params.region_id = dtv_postcode[d]
                                break
                            }
                        }
                        break
                    default:
                        geo_params.region_id = n_res.address.city
                }
            }
            console.log(`Live on port ${PORT}`)
        })
    }).catch(()=>{
        check_output(path.join(__dirname, "/bin/ffmpeg"), ["-version"]).then(()=>{
            app.listen(PORT, async () => {
                rtmp_server.run()
                const geoip_res = await axios.get("https://dtvtools.ucomsite.my.id/geoip/json")
                const geoip_data = geoip_res.data

                geo_params = {
                    country: geoip_data.country,
                    region_id: null
                }

                /*
                manifest_data = {
                    name: config.name,
                    hostname: os.hostname(),
                    server_uptime: os.uptime(),
                    os_name: `${os.type()} ${os.release()}`,
                    num_streams: (await streams.query()).length,
                    country: geoip_data.country,
                    region_id: null
                }
                */

                const n_res = await nominatim.reverse({lat: geoip_data.ll[0], lon: geoip_data.ll[1], zoom: 17})

                if (!n_res.error) {
                    const zip_code = n_res.address.postcode
                    switch (geoip_data.country) {
                        case "ID":
                            for (d in dtv_postcode) {
                                if (zip_code.slice(0,3) == d) {
                                    geo_params.region_id = dtv_postcode[d]
                                    break
                                }
                            }
                            break
                        default:
                            geo_params.region_id = n_res.address.city
                    }
                }
                console.log(`Live on port ${PORT}`)
            })
        }).catch(()=>{
            console.error("FFmpeg is not available. Please download FFmpeg files at https://ffmpeg.org and put into the \"bin\" folder.")
        })
    })
}).catch(()=>{
    console.error("TSDuck is not installed. You can install TSDuck at https://tsduck.io")
})