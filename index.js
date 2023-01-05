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
const m3u8 = require("m3u8")

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
const dvr = require("./db/dvr")

const config_defaults_nvenc = {
    "name": "DTV Uplink Server",
    "dtv_forward_host": "dvb.ucomsite.my.id:31460",
    "dtv_forward_key": "",
    "dtv_geoblock": false,
    "dtv_protocol": "frps",
    "streams_path": "(pathname)/streams/",
    "dvr_path": "(pathname)/dvr/",
    "ffmpeg": "ffmpeg",
    "watermark": "(pathname)/watermarks/lv-high-50-256-dark3.png",
    "watermark_ignore_streams": [],
    "hls_settings": {
        "duration": 2,
        "list_size": 15,
        "unreferenced_segments": 10
    },
    "multiple_renditions": false,
    "nvenc_use_nvdec": true,
    "dtv_use_fork": true,
    "renditions_hd": [
        {
            "hwaccel": "nvenc",
            "width": 1280,
            "height": 720,
            "speed": 2,
            "profile": "high",
            "video_bitrate": 1500000,
            "bufsize": 2000000,
            "bf": 2,
            "interp_algo": 1,
            "audio_bitrate": 128000,
            "audio_profile": "low",
            "audio_codec": "aac"
        },
        {
            "hwaccel": "nvenc",
            "width": 960,
            "height": 540,
            "speed": 2,
            "profile": "high",
            "video_bitrate": 1250000,
            "bufsize": 1750000,
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
            "speed": 2,
            "profile": "main",
            "video_bitrate": 750000,
            "bufsize": 1250000,
            "bf": 2,
            "interp_algo": 1,
            "audio_bitrate": 96000,
            "audio_profile": "low",
            "audio_codec": "aac"
        },
        {
            "hwaccel": "nvenc",
            "width": 320,
            "height": 180,
            "speed": 2,
            "profile": "baseline",
            "video_bitrate": 250000,
            "bufsize": 750000,
            "bf": 2,
            "interp_algo": 1,
            "audio_bitrate": 64000,
            "audio_profile": "low",
            "audio_codec": "aac"
        }
    ],
    "renditions_sd": [
        {
            "hwaccel": "nvenc",
            "width": 640,
            "height": 360,
            "speed": 2,
            "profile": "main",
            "video_bitrate": 750000,
            "bufsize": 1250000,
            "bf": 2,
            "interp_algo": 1,
            "audio_bitrate": 96000,
            "audio_profile": "low",
            "audio_codec": "aac"
        },
        {
            "hwaccel": "nvenc",
            "width": 320,
            "height": 180,
            "speed": 2,
            "profile": "baseline",
            "video_bitrate": 250000,
            "bufsize": 750000,
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
    "port": 6520,
    "play_port": 6521,
    "dtv_buffer_size": 2
}

const config_defaults = {
    "name": "DTV Uplink Server",
    "dtv_forward_host": "dvb.ucomsite.my.id:31460",
    "dtv_forward_key": "",
    "dtv_geoblock": false,
    "dtv_protocol": "frps",
    "streams_path": "(pathname)/streams/",
    "dvr_path": "(pathname)/dvr/",
    "ffmpeg": "ffmpeg",
    "watermark": "(pathname)/watermarks/lv-high-50-256-dark3.png",
    "watermark_ignore_streams": [],
    "hls_settings": {
        "duration": 2,
        "list_size": 15,
        "unreferenced_segments": 10
    },
    "multiple_renditions": false,
    "nvenc_use_nvdec": true,
    "dtv_use_fork": true,
    "renditions_hd": [
        {
            "hwaccel": "nvenc",
            "width": 1280,
            "height": 720,
            "speed": 2,
            "profile": "high",
            "video_bitrate": 1500000,
            "bufsize": 2000000,
            "bf": 2,
            "interp_algo": 1,
            "audio_bitrate": 128000,
            "audio_profile": "low",
            "audio_codec": "aac"
        },
        {
            "hwaccel": "nvenc",
            "width": 960,
            "height": 540,
            "speed": 2,
            "profile": "high",
            "video_bitrate": 1250000,
            "bufsize": 1750000,
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
            "speed": 2,
            "profile": "main",
            "video_bitrate": 750000,
            "bufsize": 1250000,
            "bf": 2,
            "interp_algo": 1,
            "audio_bitrate": 96000,
            "audio_profile": "low",
            "audio_codec": "aac"
        },
        {
            "hwaccel": "nvenc",
            "width": 320,
            "height": 180,
            "speed": 2,
            "profile": "baseline",
            "video_bitrate": 250000,
            "bufsize": 750000,
            "bf": 2,
            "interp_algo": 1,
            "audio_bitrate": 64000,
            "audio_profile": "low",
            "audio_codec": "aac"
        }
    ],
    "renditions_sd": [
        {
            "hwaccel": "vaapi",
            "width": 640,
            "height": 360,
            "speed": 2,
            "profile": "main",
            "video_bitrate": 750000,
            "bufsize": 1250000,
            "bf": 2,
            "interp_algo": 1,
            "audio_bitrate": 96000,
            "audio_profile": "low",
            "audio_codec": "aac"
        },
        {
            "hwaccel": "vaapi",
            "width": 320,
            "height": 180,
            "speed": 2,
            "profile": "578",
            "video_bitrate": 250000,
            "bufsize": 750000,
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
    "port": 6520,
    "play_port": 6521,
    "dtv_buffer_size": 2
}

if (!fs_sync.existsSync(path.join(__dirname, "/config.json"))) fs_sync.writeFileSync(path.join(__dirname, "/config.json"), JSON.stringify(config_defaults, null, 4))
const config = require("./config.json");
const cluster = require("cluster")

if (!fs_sync.existsSync(config.dvr_path)) fs_sync.mkdirSync(config.dvr_path, {recursive: true})
if (!fs_sync.existsSync(config.streams_path)) fs_sync.mkdirSync(config.streams_path, {recursive: true})

if (!cluster.isPrimary) {
    const fastify = require("fastify")
    const fastify_cors = require("@fastify/cors")
    const fastify_static = require("@fastify/static")

    // const fastify_plugin = require("fastify-plugin")

    const app_play = fastify.fastify({maxParamLength: 256, trustProxy: ['loopback', 'linklocal', 'uniquelocal']})

    app_play.register(fastify_static, {
        root: config.streams_path.replace(/\(pathname\)/g, __dirname),
        serve: false
    })

    app_play.register(fastify_static, {
        root: config.dvr_path.replace(/\(pathname\)/g, __dirname),
        prefix: "/dvr/",
        decorateReply: false,
        index: false
    })

    app_play.register(fastify_static, {
        root: path.join(__dirname, '/tests/'),
        prefix: "/test/",
        decorateReply: false,
        index: false    
    })

    app_play.register(fastify_cors, {
        exposedHeaders: ["X-Cluster-ID"]
    })

    app_play.addHook('onSend', function (req, res, payload, next) {
        if (req.url.startsWith("/dvr/")) {
            if (res.getHeader('content-type') === 'application/vnd.apple.mpegurl') {
                res.header('Content-Type', 'application/x-mpegurl')
            }
        }
        next()
    })

    /*
    app_play.get("/dvr/:stream/:file", async (req, res) => {
        const file_path = req.params.file

        res.header("x-playback-worker", process.pid)

        if (file_path.endsWith(".ts")) {
            const have_stream = await dvr.query().where("dvr_id", "=", req.params.stream)
            if (have_stream.length <= 0) {
                return res.status(404).send({error: "This stream is non-existent."})
            }

            const streams_path = `${config.dvr_path.replace(/\(pathname\)/g, __dirname)}/${req.params.stream}/`
            if (!fs_sync.existsSync(`${streams_path}/`)) return res.status(404).send({error: "This stream is not available."})
            if (!fs_sync.existsSync(`${streams_path}/${file_path}`)) return res.status(404).send({error: "Not found"})

            return res.status(200).sendFile(`${req.params.stream}/${file_path}`)                          
        } else if (file_path.endsWith(".m3u8")) {
            const have_stream = await dvr.query().where("dvr_id", "=", req.params.stream)
            if (have_stream.length <= 0) {
                return res.status(404).send({error: "This stream is non-existent."})
            }

            const streams_path = `${config.dvr_path.replace(/\(pathname\)/g, __dirname)}/${req.params.stream}/`
            if (!fs_sync.existsSync(`${streams_path}/`)) return res.status(404).send({error: "This stream is not available."})

            try {
                const hls_ts_file = await fs.readFile(`${streams_path}/${file_path}`, {encoding: "utf-8"})

                return res.status(200).header("Content-Type", "application/x-mpegurl").send(hls_ts_file.replace(/\r/g, ""))
            } catch (e) {            
                if (e.code == "ENOENT") {
                    res.status(404).send({error: "Not found"})
                } else {
                    console.trace(e)
                    res.status(500).send({error: e})
                }         
            }

        } else {
            return res.status(403).send({error: "Not OTT content"})
        }
    })
    */

    app_play.get("/play/:stream/:file/:file2?", async (req, res) => {
        const file_path = req.params.file+(req.params.file2 ? ("/"+req.params.file2) : "")

        res.header("x-playback-worker", process.pid)

        if (file_path.endsWith(".ts")) {
            const have_stream = await streams.query().where("stream_id", "=", req.params.stream)
            if (have_stream.length <= 0) {
                return res.status(404).send({error: "This stream is non-existent."})
            }

            const streams_path = `${config.streams_path.replace(/\(pathname\)/g, __dirname)}/${req.params.stream}/`
            if (!fs_sync.existsSync(`${streams_path}/`)) return res.status(404).send({error: "This stream is not available."})
            if (!fs_sync.existsSync(`${streams_path}/${file_path}`)) return res.status(404).send({error: "Not found"})

            return res.status(200).sendFile(`${req.params.stream}/${file_path}`)                          
        } else if (file_path.endsWith(".m3u8")) {
            const have_stream = await streams.query().where("stream_id", "=", req.params.stream)
            if (have_stream.length <= 0) {
                return res.status(404).send({error: "This stream is non-existent."})
            }

            const streams_path = `${config.streams_path.replace(/\(pathname\)/g, __dirname)}/${req.params.stream}/`
            if (!fs_sync.existsSync(`${streams_path}/`)) return res.status(404).send({error: "This stream is not available."})

            try {
                const hls_ts_file = await fs.readFile(`${streams_path}/${file_path}`, {encoding: "utf-8"})

                return res.status(200).header("Content-Type", "application/x-mpegurl").send(hls_ts_file.replace(/\r/g, "").replace(/#EXT-X-MEDIA-SEQUENCE/g, `#EXT-X-PLAY-ON:DTVAnywhere\n#EXT-X-STREAM-NAME:${have_stream[0].name}\n#EXT-X-STREAM-SOURCE:${have_stream[0].type}\n#EXT-X-STREAM-HOSTNAME:${os.hostname()}\n#EXT-X-MEDIA-SEQUENCE`))
            } catch (e) {            
                if (e.code == "ENOENT") {
                    res.status(404).send({error: "Not found"})
                } else {
                    console.trace(e)
                    res.status(500).send({error: e})
                }         
            }

        } else {
            return res.status(403).send({error: "Not OTT content"})
        }
    })

    const geo_params = JSON.parse(process.env.geo_params)

    app_play.get("/manifest.json", async (req, res) => {
        res.header("x-playback-worker", process.pid)

        return res.status(200).send({
            name: config.name,
            hostname: os.hostname(),
            server_uptime: os.uptime(),
            os_name: `${os.type()} ${os.release()}`,
            num_streams: (await streams.query()).length,
            country: geo_params.country,
            region_id: geo_params.region_id,
            dtv_area: geo_params.dtv_area,
            is_geoblock: config.dtv_geoblock
        })
    })

    app_play.get("/playlist.m3u", async (req, res) => {
        const streams_ = await streams.query().where("active", "=", true)
        var streams_out = []
        var m3u = "#EXTM3U\n"

        res.header("x-playback-worker", process.pid)

        for (let i = 0; i<streams_.length; i++) {
            const stream = streams_[i]
            if (stream.type === "dtv") {
                const sp = JSON.parse(stream.params)
                var ch_mux = []
                for (let j = 0; j<sp.channels.length; j++) {
                    const st_channel = sp.channels[j]
                    m3u += `#EXTINF:-1 tvg-id="${stream.stream_id}-${st_channel.id}",${st_channel.name}\n${req.protocol}://${req.headers["x-forwarded-prefix"] ? req.headers["x-forwarded-prefix"] : (req.headers.host+'/play')}/${stream.stream_id}/${st_channel.id}/index.m3u8\n`
                }
            } else {
                m3u += `#EXTINF:-1 tvg-id="${stream.stream_id}",${stream.name}\n${req.protocol}://${req.headers["x-forwarded-prefix"] ? req.headers["x-forwarded-prefix"] : (req.headers.host+'/play')}/${stream.stream_id}/index.m3u8\n`
            }
        }
        return res.status(200).header("Content-Type", "application/x-mpegurl").send(m3u)
    })

    app_play.get("/api/streams", async (req, res) => {
        const streams_ = await streams.query().where("active", "=", true)

        res.header("x-playback-worker", process.pid)

        var streams_out = []
        for (let i = 0; i<streams_.length; i++) {
            const stream = streams_[i]
            if (stream.type === "dtv") {
                const sp = JSON.parse(stream.params)
                var ch_mux = []
                for (let j = 0; j<sp.channels.length; j++) {
                    const st_channel = sp.channels[j]
                    ch_mux.push(
                        {
                            name: st_channel.name,
                            id: st_channel.id,
                            is_hd: st_channel.is_hd,
                            playback_url: `${req.headers["x-forwarded-prefix"] ? req.protocol + "://" + req.headers["x-forwarded-prefix"] : "/play"}/${stream.stream_id}/${st_channel.id}/index.m3u8`,
                            stream_path: `${stream.stream_id}/${st_channel.id}`
                        }
                    )
                }
                streams_out.push({
                    name: stream.name,
                    id: stream.stream_id,
                    type: stream.type,
                    active: Boolean(stream.active),
                    channels: ch_mux
                })
            } else {
                streams_out.push({
                    name: stream.name,
                    id: stream.stream_id,
                    type: stream.type,
                    active: Boolean(stream.active),
                    channels: [
                        {
                            name: stream.name,
                            id: 0,
                            is_hd: false,
                            playback_url: `${req.headers["x-forwarded-prefix"] ? req.protocol + "://" + req.headers["x-forwarded-prefix"] : "/play"}/${stream.stream_id}/index.m3u8`,
                            stream_path: `${stream.stream_id}`
                        }
                    ]
                })
            }
        }
        return res.status(200).send(streams_out)
    });

    /*
    app_play.get("/manifest.json", cors(), async (req, res) => {
        return res.status(200).json({
            name: config.name,
            hostname: os.hostname(),
            server_uptime: os.uptime(),
            os_name: `${os.type()} ${os.release()}`,
            num_streams: (await streams.query()).length,
            country: geo_params.country,
            region_id: geo_params.region_id,
            dtv_area: geo_params.dtv_area
        })
    })
    */

    app_play.listen({port: config.play_port, host: "::"}, (e) => {
        if (e) {
            console.trace(e); 
            return
        }
        console.log(`worker ${process.env.cluster_id}-${process.pid} has been started`)
        if (config.dtv_protocol == "frp" && process.env.cluster_id == 1) {
            setTimeout(() => {
                // frp_cp = cp.spawn(path.join(__dirname, "/bin/frpc"), ["http", "-l", config.play_port, "-s", config.dtv_forward_host, "-u", config.dtv_forward_key, "-n", crypto.randomBytes(128).toString("hex"), "--log_level", "error", "--ue"])
                frp_cp = cp.spawn(path.join(__dirname, "/bin/frpc"), ["http", "-l", config.play_port, "-s", config.dtv_forward_host, "-u", config.dtv_forward_key, "-n", crypto.randomBytes(128).toString("hex"), "--log_level", "error"])
                
                frp_cp.stderr.pipe(proc.stderr)
                frp_cp.stdout.pipe(proc.stdout)
            }, 2000)
        } else if (config.dtv_protocol == "frps" && process.env.cluster_id == 1) {
            setTimeout(() => {
                // frp_cp = cp.spawn(path.join(__dirname, "/bin/frpc"), ["http", "-l", config.play_port, "-s", config.dtv_forward_host, "-u", config.dtv_forward_key, "-n", crypto.randomBytes(128).toString("hex"), "--log_level", "error", "--ue"])
                frp_cp = cp.spawn(path.join(__dirname, "/bin/frpc"), ["http", "--tls_enable", "-l", config.play_port, "-s", config.dtv_forward_host, "-u", config.dtv_forward_key, "-n", crypto.randomBytes(128).toString("hex"), "--log_level", "error"])
                
                frp_cp.stderr.pipe(proc.stderr)
                frp_cp.stdout.pipe(proc.stdout)
            }, 2000)
        }
    })
} else {
    const app = express();

    const read_m3u8 = (file) => {
        return new Promise((res, rej) => {
            const m3u8_parse = m3u8.createStream()
            const read_stream = fs_sync.createReadStream(file)

            read_stream.pipe(m3u8_parse)
            m3u8_parse.on("m3u", res)

            read_stream.on("error", rej)
        })
    }

    app.enable("trust proxy")
    app.set('trust proxy', ['loopback', 'linklocal', 'uniquelocal']) 
    app.use(express.json())

    var StreamDTVJobs = {};
    var StreamDTVOutput = {};

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
            
        } else if (config.dtv_protocol == "frps") {
            
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
        let passthrough = false

        for (let i = 0; i<rtmp_streams.length; i++) {
            const rtmp_params = JSON.parse(rtmp_streams[i].params)                
            if (rtmp_params.rtmp_key == stream_id) {
                found = true
                found_id = rtmp_streams[i].stream_id
                passthrough = rtmp_params.passthrough !== undefined ? rtmp_params.passthrough : false
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
                    delete StreamDTVOutput[found_id]
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
            renditions_hd: config.renditions_hd, 
            renditions_sd: config.renditions_sd, 
            multiple_renditions: config.multiple_renditions, 
            hls_settings: config.hls_settings,
            passthrough: passthrough
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
                    renditions_hd: config.renditions_hd, 
                    renditions_sd: config.renditions_sd, 
                    multiple_renditions: config.multiple_renditions, 
                    hls_settings: config.hls_settings,
                    additional_params: params.additional_params,
                    watermark: config.watermark_ignore_streams.indexOf(stream_id) ? "" : config.watermark,
                    pathname: __dirname
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
                    renditions_hd: config.renditions_hd, 
                    renditions_sd: config.renditions_sd,  
                    multiple_renditions: config.multiple_renditions, 
                    hls_settings: config.hls_settings,
                    dtv_use_fork: config.dtv_use_fork,
                    additional_params: params.additional_params,
                    buffer_size: config.dtv_buffer_size,
                    system: params.system ? params.system : "DVB-T2",
                    watermark: config.watermark,
                    watermark_ignore_streams: config.watermark_ignore_streams,
                    pathname: __dirname
                })
            }
            cur_proc.on("message", (d) => {
                if (d.retry) {
                    console.log("stream has encountered an error, retrying.")                
                    addDTVJobs(d.stream_id, d.type, d.params)
                } else {            
                    delete StreamDTVJobs[d.stream_id]     
                    delete StreamDTVOutput[d.stream_id]                           
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

    app.use("/dvr/", express.static(config.dvr_path.replace(/\(pathname\)/g, __dirname), {index: false, setHeaders: (res, path) => {
        if (path.endsWith(".m3u8")) {
            res.header('Content-Type', 'application/x-mpegurl')
        }
    }}))

    app.get("/play/:stream/:file/:file2?", cors(), async (req, res) => {
        const file_path = req.params.file+(req.params.file2 ? ("/"+req.params.file2) : "")

        if (file_path.endsWith(".ts")) {
            const have_stream = await streams.query().where("stream_id", "=", req.params.stream)
            if (have_stream.length <= 0) {
                return res.status(404).json({error: "This stream is non-existent."})
            }

            const streams_path = `${config.streams_path.replace(/\(pathname\)/g, __dirname)}/${req.params.stream}/`
            if (!fs_sync.existsSync(`${streams_path}/`)) return res.status(404).json({error: "This stream is not available."})
            if (!fs_sync.existsSync(`${streams_path}/${file_path}`)) return res.status(404).json({error: "Not found"})

            return res.status(200).sendFile(`${streams_path}/${file_path}`)                          
        } else if (file_path.endsWith(".m3u8")) {
            const have_stream = await streams.query().where("stream_id", "=", req.params.stream)
            if (have_stream.length <= 0) {
                return res.status(404).json({error: "This stream is non-existent."})
            }

            const streams_path = `${config.streams_path.replace(/\(pathname\)/g, __dirname)}/${req.params.stream}/`
            if (!fs_sync.existsSync(`${streams_path}/`)) return res.status(404).json({error: "This stream is not available."})

            try {
                const hls_ts_file = await fs.readFile(`${streams_path}/${file_path}`, {encoding: "utf-8"})

                return res.status(200).header("Content-Type", "application/x-mpegurl").end(hls_ts_file.replace(/\r/g, "").replace(/#EXT-X-MEDIA-SEQUENCE/g, `#EXT-X-PLAY-ON:DTVAnywhere\n#EXT-X-STREAM-NAME:${have_stream[0].name}\n#EXT-X-STREAM-SOURCE:${have_stream[0].type}\n#EXT-X-STREAM-HOSTNAME:${os.hostname()}\n#EXT-X-MEDIA-SEQUENCE`))
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

    app.use(function(req, res, next) {
        var schema = req.headers["x-forwarded-proto"];

        req.schema = schema ? schema : "http"

        next();
    });

    const stream = require("stream")

    /* API */
    app.get("/api/status", async (req,res) => {
        const tuners = (await check_output("tslsdvb")).toString("ascii").replace(/\r/g, "").split("\n")
        var tuners_stat = []

        for (let i = 0; i<(tuners.length-1); i++) {
            const tuner_stat = (await check_output('tslsdvb', ['-a', i, '-e'], 0, null, new stream.Writable({write:()=>{}}), true)).toString("ascii").replace(/\r/g, "").split("\n")
            var status;
            var current;

            for (let j = 0; j<tuner_stat.length; j++) {
                if (tuner_stat[j].indexOf("Current ") !== -1) {
                    current = tuner_stat[j].slice(tuner_stat[j].indexOf("Current "))
                } else if (tuner_stat[j].indexOf("Signal: ") !== -1) {
                    status = tuner_stat[j].slice(tuner_stat[j].indexOf("Signal: "))
                }
            }

            tuners_stat.push({name: tuners[i], status, current: current ? current : "Current N/A"})
        }

        return res.status(200).json(tuners_stat)
    })

    app.get("/playlist.m3u", cors(), async (req, res) => {
        const streams_ = await streams.query()
        var streams_out = []
        var m3u = "#EXTM3U\n"

        for (let i = 0; i<streams_.length; i++) {
            const stream = streams_[i]
            if (stream.type === "dtv") {
                const sp = JSON.parse(stream.params)
                var ch_mux = []
                for (let j = 0; j<sp.channels.length; j++) {
                    const st_channel = sp.channels[j]
                    m3u += `#EXTINF:-1 tvg-id="${stream.stream_id}-${st_channel.id}",${st_channel.name}\n${req.schema}://${req.headers["x-forwarded-prefix"] ? req.headers["x-forwarded-prefix"] : (req.headers.host+'/play')}/${stream.stream_id}/${st_channel.id}/index.m3u8\n`
                }
            } else {
                m3u += `#EXTINF:-1 tvg-id="${stream.stream_id}",${stream.name}\n${req.schema}://${req.headers["x-forwarded-prefix"] ? req.headers["x-forwarded-prefix"] : (req.headers.host+'/play')}/${stream.stream_id}/index.m3u8\n`
            }
        }
        return res.status(200).header("Content-Type", "application/x-mpegurl").end(m3u)
    })

    app.get("/api/config", (req,res) => {
        res.status(200).json(config)
    })

    app.post("/api/config", async (req,res) => {
        await fs.writeFile(path.join(__dirname, "/config.json"), JSON.stringify(req.body, null, 4))
        res.status(200).json({status: "OK"})
        setTimeout(() => {
            process.on("exit", function () {
                cp.spawn(process.argv.shift(), process.argv, {
                    cwd: process.cwd(),
                    detached : true,
                    stdio: "inherit"
                });
            });
            process.exit(0);
        }, 3000)
    })

    app.get("/api/streams", cors(), async (req, res) => {
        const streams_ = await streams.query()
        var streams_out = []
        for (let i = 0; i<streams_.length; i++) {
            const stream = streams_[i]
            if (stream.type === "dtv") {
                const sp = JSON.parse(stream.params)
                var ch_mux = []
                for (let j = 0; j<sp.channels.length; j++) {
                    const st_channel = sp.channels[j]
                    ch_mux.push(
                        {
                            name: st_channel.name,
                            id: st_channel.id,
                            is_hd: st_channel.is_hd,
                            playback_url: `${req.headers["x-forwarded-prefix"] ? req.protocol + "://" + req.headers["x-forwarded-prefix"] : "/play"}/${stream.stream_id}/${st_channel.id}/index.m3u8`,
                            stream_path: `${stream.stream_id}/${st_channel.id}`
                        }
                    )
                }
                streams_out.push({
                    name: stream.name,
                    id: stream.stream_id,
                    type: stream.type,
                    active: Boolean(stream.active),
                    channels: ch_mux
                })
            } else {
                streams_out.push({
                    name: stream.name,
                    id: stream.stream_id,
                    type: stream.type,
                    active: Boolean(stream.active),
                    channels: [
                        {
                            name: stream.name,
                            id: 0,
                            is_hd: false,
                            playback_url: `${req.headers["x-forwarded-prefix"] ? req.protocol + "://" + req.headers["x-forwarded-prefix"] : "/play"}/${stream.stream_id}/index.m3u8`,
                            stream_path: `${stream.stream_id}`
                        }
                    ]
                })
            }
        }
        return res.status(200).json(streams_out)
    });

    //const m3u8 = require("m3u8")
    var DVR_STREAMS = {}
    var DVR_PROC = {}

    app.post("/api/dvr/status", async (req, res) => {
        if (!req.body.id) return res.status(400).json({error: "A stream id must be specified."})

        const stream = await streams.query().where("stream_id", "=", req.body.id)
        if (stream.length <= 0) return res.status(400).json({error: `A channel with id ${req.body.id} could not be found.`})

        if (stream[0].type == "dtv") {
            if (!req.body.program) return res.status(400).json({error: "A program must be specified."})
            return res.status(200).json({is_recording: DVR_STREAMS[`${req.body.id}/${req.body.program}`] !== undefined, recordings: await dvr.query().where("stream_id", "=", req.body.id).where("channel", "=", req.body.program).orderBy("created_on", "desc")})
        } else {
            return res.status(200).json({is_recording: DVR_STREAMS[req.body.id] !== undefined, recordings: await dvr.query().where("stream_id", "=", req.body.id).orderBy("created_on", "desc")})
        }
    })

    app.post("/api/dvr/delete", async (req, res) => {
        if (!req.body.id) return res.status(400).json({error: "A stream id must be specified."})

        const dvri = await dvr.query().where("dvr_id", "=", req.body.id)
        if (dvri.length <= 0) return res.status(400).json({error: `A channel with id ${req.body.id} could not be found.`})

        await dvr.query().delete().where("dvr_id", "=", req.body.id)
        try {
            await fs.rm(`${config.dvr_path.replace(/\(pathname\)/g, __dirname)}/${req.body.id}`, {force: true, recursive: true})
        } catch (e) {}

        return res.status(200).json({status: "OK"})
    })

    app.post("/api/dvr/start", async (req, res) => {
        if (!req.body.id) return res.status(400).json({error: "A stream id must be specified."})

        const stream = await streams.query().where("stream_id", "=", req.body.id)
        if (stream.length <= 0) return res.status(400).json({error: `A channel with id ${req.body.id} could not be found.`})

        if (!stream[0].active) res.status(200).json({error: "Stream is not active"})

        if (stream[0].type == "dtv") {
            if (!req.body.program) return res.status(400).json({error: "A program id must be specified."})

            if (DVR_STREAMS[`${req.body.id}/${req.body.program}`] === undefined) {
                DVR_STREAMS[`${req.body.id}/${req.body.program}`] = crypto.randomBytes(64).toString("hex")
                DVR_PROC[DVR_STREAMS[`${req.body.id}/${req.body.program}`]] = cp.fork(path.join(__dirname, "/scripts/dvr.js"))
                DVR_PROC[DVR_STREAMS[`${req.body.id}/${req.body.program}`]].send({
                    stream_id: req.body.id,
                    channel: req.body.program,
                    target: DVR_STREAMS[`${req.body.id}/${req.body.program}`]
                })

                await fs.mkdir(`${config.dvr_path.replace(/\(pathname\)/g, __dirname)}/${DVR_STREAMS[`${req.body.id}/${req.body.program}`]}`)
                return res.status(200).json({status: "OK"})
            } else {
                return res.status(400).json({error: "Stream is already recording"})
            }
        } else {
            if (DVR_STREAMS[req.body.id] === undefined) {
                DVR_STREAMS[req.body.id] = crypto.randomBytes(64).toString("hex")
                DVR_PROC[DVR_STREAMS[req.body.id]] = cp.fork(path.join(__dirname, "/scripts/dvr.js"))
                DVR_PROC[DVR_STREAMS[req.body.id]].send({
                    stream_id: req.body.id,
                    channel: -1,
                    target: DVR_STREAMS[req.body.id]
                })

                await fs.mkdir(`${config.dvr_path.replace(/\(pathname\)/g, __dirname)}/${DVR_STREAMS[req.body.id]}`)
                return res.status(200).json({status: "OK"})
            } else {
                return res.status(400).json({error: "Stream is already recording"})
            }
        }
    })

    app.post("/api/dvr/stop", async (req, res) => {
        if (!req.body.id) return res.status(400).json({error: "A stream id must be specified."})

        const stream = await streams.query().where("stream_id", "=", req.body.id)
        if (stream.length <= 0) return res.status(400).json({error: `A channel with id ${req.body.id} could not be found.`})

        if (!stream[0].active) res.status(200).json({error: "Stream is not active"})

        if (stream[0].type == "dtv") {
            if (!req.body.program) return res.status(400).json({error: "A program id must be specified."})

            if (DVR_STREAMS[`${req.body.id}/${req.body.program}`] !== undefined) {
                
                await dvr.query().insert({
                    stream_id: req.body.id,
                    channel: req.body.program,
                    dvr_id: DVR_STREAMS[`${req.body.id}/${req.body.program}`],
                    created_on: Date.now()
                })
                
                DVR_PROC[DVR_STREAMS[`${req.body.id}/${req.body.program}`]].send({quit: true, abort: false})
                delete DVR_PROC[DVR_STREAMS[`${req.body.id}/${req.body.program}`]]
                delete DVR_STREAMS[`${req.body.id}/${req.body.program}`]
                return res.status(200).json({status: "OK"})
            } else {
                return res.status(400).json({error: "Stream is not recording"})
            }
        } else {
            if (DVR_STREAMS[req.body.id] !== undefined) {
                await dvr.query().insert({
                    stream_id: req.body.id,
                    dvr_id: DVR_STREAMS[req.body.id],
                    created_on: Date.now()
                })

                DVR_PROC[DVR_STREAMS[req.body.id]].send({quit: true, abort: false})
                delete DVR_PROC[DVR_STREAMS[req.body.id]]
                delete DVR_STREAMS[req.body.id]
                return res.status(200).json({status: "OK"})
            } else {
                return res.status(400).json({error: "Stream is not recording"})
            }
        }
    })

    app.post("/api/shutdown", (req, res) => {
        res.status(200).json({status: "OK"})
        setTimeout(async () => {
            for (k in StreamDTVJobs) {
                StreamDTVJobs[k].kill("SIGKILL")
                try {
                    await fs.rm(StreamDTVOutput[k], {force: true, recursive: true})
                } catch (e) {}
            }

            process.exit(0)
        }, 2000)
    })

    app.post("/api/rtmp_publish_url", async (req, res) => {
        if (!req.body.id) return res.status(400).json({"error": "A channel id must be specified"})

        const stream = await streams.query().where("stream_id", "=", req.body.id)
        if (stream.length <= 0) return res.status(400).json({error: `A channel with id ${req.body.id} could not be found.`})
        if (stream[0].type !== "rtmp") return res.status(400).json({error: `channel ${req.body.id} is not an RTMP stream`})

        return res.status(200).json({publish_url: `rtmp://${req.hostname}:${config.rtmp_settings.port}/live/${JSON.parse(stream[0].params).rtmp_key}`})
    });

    app.post("/api/dvb2ip_get", async (req, res) => {
        if (!req.body.src) return res.status(400).json({"error": "A source address must be specified."})
        try {
            const dvb2ip_arr = await dvb2ip(req.body.src)
            var dvb2ip_ar = []

            for (let i = 0; i<dvb2ip_arr.length; i++) {
                dvb2ip_ar.push({name: dvb2ip_arr[i].name.replace(/(HD$)/g, ""), stream_id: dvb2ip_arr[i].stream_id})
            }

            return res.status(200).json({channels: dvb2ip_ar})
        } catch (e) {
            return res.status(200).json({channels: []})
        }
    });

    proc.nextTick(async () => {
        const active_streams = await streams.query().where("active", '=', true)
        for (let v = 0; v<active_streams.length; v++) {        
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
            
            if (stream[0].type === "dtv") {
                const TMP_DVR = DVR_STREAMS
                for (k in TMP_DVR) {
                    if (k.startsWith(`${req.body.id}/`)) {
                        DVR_PROC[DVR_STREAMS[k]].send({quit: true, abort: true})

                        delete DVR_PROC[DVR_STREAMS[k]]
                        delete DVR_STREAMS[k]
                    }
                }
            } else if (DVR_PROC[DVR_STREAMS[`${req.body.id}`]]) {
                DVR_PROC[DVR_STREAMS[`${req.body.id}`]].send({quit: true, abort: true})

                delete DVR_PROC[DVR_STREAMS[`${req.body.id}`]]
                delete DVR_STREAMS[`${req.body.id}`]
            }
        }
        return res.status(200).json({status: "ok"})
    });

    app.post("/api/delete", async (req, res) => {    
        if (!req.body.id) return res.status(400).json({error: "A channel id must be specified."})
        const stream = await streams.query().where("stream_id", '=', req.body.id)
        if (stream.length <= 0) return res.status(400).json({error: `A channel with id ${req.body.id} could not be found.`})    
        if (StreamDTVJobs[req.body.id]) StreamDTVJobs[req.body.id].send({quit: true, stream_id: req.body.id})
        
        if (stream[0].type === "dtv") {
            const TMP_DVR = DVR_STREAMS
            for (k in TMP_DVR) {
                if (k.startsWith(`${req.body.id}/`)) {
                    DVR_PROC[DVR_STREAMS[k]].send({quit: true, abort: true})

                    delete DVR_PROC[DVR_STREAMS[k]]
                    delete DVR_STREAMS[k]
                }
            }
        } else if (DVR_PROC[DVR_STREAMS[`${req.body.id}`]]) {
            DVR_PROC[DVR_STREAMS[`${req.body.id}`]].send({quit: true, abort: true})

            delete DVR_PROC[DVR_STREAMS[`${req.body.id}`]]
            delete DVR_STREAMS[`${req.body.id}`]
        }

        await streams.query().delete().where("stream_id", '=', req.body.id)
        await dvr.query().delete().where("stream_id", '=', req.body.id)

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
                        passthrough: req.body.passthrough !== undefined ? req.body.passthrough : false
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
                        additional_params: req.body.additional_params
                    }
                })
                return res.status(200).json({status: "ok", id: random_id})                        
            case "dtv":
                if (!req.body.name || req.body.tuner === undefined || !req.body.frequency || !req.body.channels) return res.status(400).json({error: "A stream name, tuner id, frequency, and channels must be specified"}) 
                await streams.query().insert({
                    stream_id: random_id,
                    name: req.body.name,
                    type: req.body.type,
                    params: {
                        tuner: req.body.tuner,
                        frequency: req.body.frequency,
                        channels: req.body.channels,
                        system: req.body.system ? req.body.system : "DVB-T2",
                        additional_params: req.body.additional_params
                    }
                })
                return res.status(200).json({status: "ok", id: random_id})                                    
            default:
                return res.status(400).json({error: "Invalid channel input type"})
        }
    });

    /*
    streams.query().insert({
        stream_id: "updatetest",
        name: "a",
        type: "rtmp",
        active: true,
        params: {
            rtmp_key: "12345"
        }
    }).then(() => {
        streams.query().where("stream_id", "=", "updatetest").then((d) => {
            console.log(d[0])
            streams.query().patch({
                stream_id: "updatetest2",
                name: "a2",
                type: "rtmp",
                active: true,
                params: {
                    rtmp_key: "12345"
                }
            }).where("stream_id", "=", "updatetest").then(() => {
                streams.query().where("stream_id", "=", "updatetest2").then((d) => {
                    console.log(d[0])                
                })
            })
        })
    })
    */

    app.post("/api/edit", async (req, res) => {
        if (!req.body.type || !req.body.id) return res.status(400).json({error: "A channel id and stream type must be specified"})    
        const stream = await streams.query().where("stream_id", '=', req.body.id)
        if (stream.length <= 0) return res.status(400).json({error: `A channel with id ${req.body.id} could not be found.`})

        if (StreamDTVJobs[req.body.id]) StreamDTVJobs[req.body.id].send({quit: true, stream_id: req.body.id})
        
        if (stream[0].type === "dtv") {
            const TMP_DVR = DVR_STREAMS
            for (k in TMP_DVR) {
                if (k.startsWith(`${req.body.id}/`)) {
                    DVR_PROC[DVR_STREAMS[k]].send({quit: true, abort: true})

                    delete DVR_PROC[DVR_STREAMS[k]]
                    delete DVR_STREAMS[k]
                }
            }
        } else if (DVR_PROC[DVR_STREAMS[`${req.body.id}`]]) {
            DVR_PROC[DVR_STREAMS[`${req.body.id}`]].send({quit: true, abort: true})

            delete DVR_PROC[DVR_STREAMS[`${req.body.id}`]]
            delete DVR_STREAMS[`${req.body.id}`]
        }

        switch (req.body.type) {
            case "rtmp":
                if (!req.body.name) return res.status(400).json({error: "A stream name must be specified"}) 
                let rtmp_params = JSON.parse(stream[0].params)
                rtmp_params.passthrough = req.body.passthrough !== undefined ? req.body.passthrough : false

                await streams.query().patch({                
                    name: req.body.name,
                    type: req.body.type,
                    params: JSON.stringify(rtmp_params)
                }).where("stream_id", '=', req.body.id)
                return res.status(200).json({status: "ok"})            
            case "dvb2ip":
                if (!req.body.name || !req.body.source_id || !req.body.source_address) return res.status(400).json({error: "A stream name, channel source id, and source address must be specified"}) 
                await streams.query().patch({
                    name: req.body.name,
                    type: req.body.type,
                    params: JSON.stringify({
                        src: req.body.source_address,
                        src_id: req.body.source_id,
                        additional_params: req.body.additional_params
                    })
                }).where("stream_id", '=', req.body.id)

                if (stream[0].active) addDTVJobs(req.body.id, req.body.type, {
                    src: req.body.source_address,
                    src_id: req.body.source_id,
                    additional_params: req.body.additional_params
                })
                return res.status(200).json({status: "ok"})                        
            case "dtv":
                if (!req.body.name || req.body.tuner === undefined || !req.body.frequency || !req.body.channels) return res.status(400).json({error: "A stream name, tuner id, frequency, and channels must be specified"}) 
                await streams.query().patch({                
                    name: req.body.name,
                    type: req.body.type,
                    params: JSON.stringify({
                        tuner: req.body.tuner,
                        frequency: req.body.frequency,
                        channels: req.body.channels,
                        system: req.body.system ? req.body.system : "DVB-T2",
                        additional_params: req.body.additional_params
                    })
                }).where("stream_id", '=', req.body.id)

                if (stream[0].active) addDTVJobs(req.body.id, req.body.type, {
                    tuner: req.body.tuner,
                    frequency: req.body.frequency,
                    channels: req.body.channels,
                    system: req.body.system ? req.body.system : "DVB-T2",
                    additional_params: req.body.additional_params
                })
                return res.status(200).json({status: "ok"})                                    
            default:
                return res.status(400).json({error: "Invalid channel input type"})
        }
    });

    app.post("/api/get_channels_by_frequency", async (req, res) => {
        if (req.body.tuner === undefined || req.body.frequency === undefined || req.body.bandwidth === undefined || req.body.system_type === undefined) return res.status(400).json({"error": "A tuner, frequency, system type, and bandwidth parameters were required."})
        //if (req.body.system_type === "ISDB-T" && req.body.isdb_type === undefined) req.res.status(400).json({error: "The system type must be specified for ISDB-T streams"})
        try {
            var dtv_chunk = null
            var found = false

            for (let b = 0; b<5; b++) {
                try {
                    dtv_chunk = await check_output('tsp', `-I dvb --signal-timeout 2 --guard-interval auto --receive-timeout 10 --adapter ${req.body.tuner} --delivery-system ${req.body.system_type} --frequency ${req.body.frequency*1e6} ${req.body.system_type !== "ATSC" ? `--bandwidth ${req.body.bandwidth*1e6} ` : ''}--transmission-mode auto --spectral-inversion off`.split(" "), 128)
                    found = true
                    break;
                } catch (e) {}
            }

            if (!found) throw new Error("no channels were found at this frequency")
            const probe_streams = JSON.parse((await check_output(config.ffmpeg.replace(/mpeg/g, "probe"), "-loglevel quiet -print_format json -show_error -probesize 32M -show_format -show_programs -".split(" "), 0, dtv_chunk)).toString("utf-8")).programs

            var channels_temp = []
            for (let i = 0; i<probe_streams.length; i++) {
                var program = probe_streams[i];
                var program_streams = [];
                var is_hd = false;

                for (let j = 0; j<program.streams.length; j++) {
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

                channels_temp.push({name:program.tags ? program.tags.service_name.replace(/(HD$)/g, "") : `CH${program.program_id}_${program.pmt_pid}_${program.pcr_pid}`, provider:program.tags ? program.tags.service_provider : "",channel_id:program.program_id,channel_pid:[program.pmt_pid,program.pcr_pid],is_hd, streams:program_streams})
            }
            return res.status(200).json({channels: channels_temp})
        } catch (e) {
            return res.status(200).json({channels: []})
        }
    });

    app.get("/api/tuners", async (req, res) => {
    const tuners = (await check_output("tslsdvb")).toString("ascii").replace(/\r/g, "").split("\n")
    var tuner = [];
    
    for (let i = 0; i<tuners.length; i++) {
        if (tuners[i]) tuner.push(tuners[i])
    }

    return res.status(200).json({
        status: "ok",
        tuners: tuner
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
            region_id: geo_params.region_id,
            dtv_area: geo_params.dtv_area,
            is_geoblock: config.dtv_geoblock
        })
    })

    app.post("/api/get_channel_info", async (req, res) => {
        if (!req.body.id) return res.status(400).json({error: "A channel id must be specified."})
        const stream = await streams.query().select(["name", "type", "params"]).where("stream_id", '=', req.body.id)
        if (stream.length <= 0) return res.status(400).json({error: `A channel with id ${req.body.id} could not be found.`})

        stream[0].params = JSON.parse(stream[0].params)

        return res.status(200).json(stream[0])
    })

    const getDistance = (lat1, lon1, lat2, lon2, unit) => {
        if ((lat1 == lat2) && (lon1 == lon2)) {
            return 0;
        }
        else {
            var radlat1 = Math.PI * lat1/180;
            var radlat2 = Math.PI * lat2/180;
            var theta = lon1-lon2;
            var radtheta = Math.PI * theta/180;
            var dist = Math.sin(radlat1) * Math.sin(radlat2) + Math.cos(radlat1) * Math.cos(radlat2) * Math.cos(radtheta);
            if (dist > 1) {
                dist = 1;
            }
            dist = Math.acos(dist);
            dist = dist * 180/Math.PI;
            dist = dist * 60 * 1.1515;
            if (unit=="K") { dist = dist * 1.609344 }
            if (unit=="N") { dist = dist * 0.8684 }
            return dist;
        }
    }

    const dtvRegions = require("./dtv_areas.json")

    const getRegion = (lat, lng) => {
        var min_dist = null
        var min_region = null

        for (let i = 0; i<dtvRegions.length; i++) {
            const dtvRegion = dtvRegions[i]
            const dist = getDistance(lat, lng, dtvRegion.lat, dtvRegion.lng, "K")
            if (min_dist === null || dist<min_dist) {
                min_dist = dist
                min_region = dtvRegion.area
            }
        }

        return min_region
    }

    const PORT = proc.env["PORT"] ? proc.env["PORT"] : config.port
    const workersCount = require('os').cpus().length

    check_output("tsp", ["--version"]).then(()=>{
        check_output(config.ffmpeg, ["-version"]).then(()=>{
            app.listen(PORT, "127.0.0.1", async () => {
                rtmp_server.run()
                const geoip_res = await axios.get("https://dtvtools.ucomsite.my.id/geoip/json")
                const geoip_data = geoip_res.data

                geo_params = {
                    country: geoip_data.country,
                    region_id: null,
                    dtv_area: null
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
                                    geo_params.dtv_area = getRegion(geoip_data.ll[0], geoip_data.ll[1])
                                    break
                                }
                            }
                            break
                        default:
                            geo_params.region_id = `${n_res.address["ISO3166-2-lvl4"]}/${n_res.address.city.toUpperCase()}`
                            geo_params.dtv_area = n_res.address.city
                            break
                    }
                }

                for (let i = 0; i < workersCount; i++) {
                    cluster.fork({cluster_id: i+1, geo_params: JSON.stringify(geo_params)});
                }

                console.log(`Live on port ${PORT}`)
            })
        }).catch(()=>{
            check_output(path.join(__dirname, "/bin/ffmpeg"), ["-version"]).then(()=>{
                app.listen(PORT, "127.0.0.1", async () => {
                    rtmp_server.run()
                    const geoip_res = await axios.get("https://dtvtools.ucomsite.my.id/geoip/json")
                    const geoip_data = geoip_res.data

                    geo_params = {
                        country: geoip_data.country,
                        region_id: null,
                        dtv_area: null
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
                                        geo_params.dtv_area = getRegion(geoip_data.ll[0], geoip_data.ll[1])
                                        break
                                    }
                                }
                                break
                            default:
                                geo_params.region_id = `${n_res.address["ISO3166-2-lvl4"]}/${n_res.address.city.toUpperCase()}`
                                geo_params.dtv_area = n_res.address.city
                                break
                        }
                    }

                    for (let i = 0; i < workersCount; i++) {
                        cluster.fork({cluster_id: i+1, geo_params: JSON.stringify(geo_params)});
                    }     

                    console.log(`Live on port ${PORT}`)
                })
            }).catch(()=>{
                console.error("FFmpeg is not available. Please download FFmpeg files at https://ffmpeg.org and put into the \"bin\" folder.")
                proc.exit(1)
            })
        })
    }).catch(()=>{
        console.error("TSDuck is not installed. You can install TSDuck at https://tsduck.io")
        proc.exit(1)
    })
}