const process = require("process")
const cp = require("child_process")
const check_output = require("../utils/check_output")
const events = require("events")
const ffmp_args = require("../utils/genFFmpegArgs")
const fs = require("fs")
const fs_p = require("fs/promises")
const path = require("path")
const os = require("os")

//var passed_params = {}
//var is_ready = false

/*
process.on("uncaughtException", (e) => {
    process.emit({retry: true, ...passed_params})
    throw new e;
})
*/

var pipe = null;
var passed_params = null;

var is_quit = false
const QuitSignal = new events.EventEmitter()
const RunSignal = new events.EventEmitter()
const ExecSignal = new events.EventEmitter()

const ffmpeg_params = []
const ffmpeg = []
const ch_names = []

const QuitCheck = () => {
    if (is_quit) {
        QuitSignal.emit("quit")
    }
}

const RESTART_EACH_STREAMS = true
const REPEAT_DETECT_STALLS = true

setInterval(QuitCheck, 2000);

process.on('SIGINT', () => {
  //console.log('Received SIGINT. Press Control-D to exit.');
    process.send({retry: true, stream_id: passed_params.stream_id, type: passed_params.type, params: {
        tuner: passed_params.tuner,
        frequency: passed_params.frequency,
        channels: passed_params.channels,
        system: passed_params.system,
        additional_params: passed_params.additional_params
    }})

    process.kill(process.pid, "SIGKILL")
});

ExecSignal.once("exec", (args, folders) => {    
    /*
    if (!passed_params.dtv_use_fork) {
        console.log(args)
        process.exit(0)
    }    
    */

    const tsduck = cp.spawn("tsp", args)

    tsduck.on("exit", () => {
        if (!is_quit) {
            //console.log(again)
            process.send({retry: true, stream_id: passed_params.stream_id, type: passed_params.type, params: {
                tuner: passed_params.tuner,
                frequency: passed_params.frequency,
                channels: passed_params.channels,
                system: passed_params.system,
                additional_params: passed_params.additional_params
            }})
            process.exit(1)
        } else {
            for (let i = 0; i<folders.length; i++) {
                try {
                    fs.rmSync(folders[i], {force: true, recursive: true})
                } catch (e) {
                    console.trace(e)
                }
            }
            try {
                fs.rmSync(passed_params.output_path, {force: true, recursive: true})
            } catch (e) {
                console.trace(e)
            }
            console.log("dtv shut down gracefully")
            process.exit(0)
        }
    })

    QuitSignal.once("quit", () => {
        process.nextTick(() => {
            try {
                tsduck.kill("SIGINT")
            } catch {}
        })
    })

    if (!passed_params.dtv_use_fork) {        
        for (let i = 0; i<ffmpeg_params.length; i++) {        
            try {
                const p = cp.spawn("node", [path.join(__dirname, "/cmds/repeat_cp.js")])                                
                p.stdin.write(JSON.stringify({
                    name: ch_names[i],
                    cmd_proc: passed_params.ffmpeg,
                    cmd_args: ffmpeg_params[i]
                }))                
                p.stdout.pipe(process.stdout)
                p.stderr.pipe(process.stderr)                                
                ffmpeg.push(p)   
            } catch (e) {
                console.trace(e)
            }     
        }  
    }  
    

    tsduck.stdout.on("data", (d) => {
        console.log(`${passed_params.frequency}-${passed_params.tuner}:${os.EOL}${d}`)
    })

    //tsduck.stdout.pipe(process.stdout)
    tsduck.stderr.pipe(process.stderr)
})

//const DEMUX_BUFFER = 188000
//const DEMUX_BUFFER = 4*1024*1024
//const DEMUX_FORK_BUFFER = 16
//const DEMUX_BUFFER = 0

RunSignal.once("run", async (params) => {    
   try {
    passed_params = params    
    //var tsp_args = `--buffer-size-mb 32 --realtime -I dvb --signal-timeout 10 --guard-interval auto --receive-timeout 10000 --adapter ${params.tuner} --delivery-system DVB-T2 --frequency ${params.frequency}000000 --transmission-mode auto --spectral-inversion off`.split(" ")
    //var tsp_args = `--buffer-size-mb 512 --max-flushed-packets 7 --max-output-packets 7 --max-input-packets 7 --realtime -I dvb --signal-timeout 10 --guard-interval auto --receive-timeout 10000 --adapter ${params.tuner} --delivery-system DVB-T2 --frequency ${params.frequency}000000 --transmission-mode auto --spectral-inversion off`.split(" ")
    //var tsp_args = `--buffer-size-mb ${params.buffer_size} --receive-timeout 10000 --realtime -I dvb --signal-timeout 10 --guard-interval auto --adapter ${params.tuner} --delivery-system DVB-T2 --frequency ${params.frequency}000000 --transmission-mode auto --spectral-inversion off`.split(" ")
    //var tsp_args = `--buffer-size-mb ${params.buffer_size} --receive-timeout 10000 --realtime -I dvb --signal-timeout 10 --guard-interval auto --adapter ${params.tuner} --delivery-system ${params.system} ${DEMUX_BUFFER > 0 ? `--demux-buffer-size ${DEMUX_BUFFER} ` : ''}--frequency ${params.frequency*1e6} --transmission-mode auto --spectral-inversion off`.split(" ")
    var tsp_args = `--buffer-size-mb ${params.buffer_size} --receive-timeout 10000 --realtime -I dvb --signal-timeout 10 --guard-interval auto --adapter ${params.tuner} --delivery-system ${params.system} --frequency ${params.frequency*1e6} --transmission-mode auto --spectral-inversion off`.split(" ")
    //var tsp_args = `--buffer-size-mb 8 --realtime -I dvb --signal-timeout 10 --guard-interval auto --receive-timeout 10000 --adapter ${params.tuner} --delivery-system DVB-T2 --frequency ${params.frequency}000000 --transmission-mode auto --spectral-inversion off`.split(" ")
    //var tsp_args = `--buffer-size-mb 2 --max-flushed-packets 128 --max-output-packets 64 --max-input-packets 256 --realtime -I dvb --signal-timeout 10 --guard-interval auto --receive-timeout 10000 --adapter ${params.tuner} --delivery-system DVB-T2 --frequency ${params.frequency}000000 --transmission-mode auto --spectral-inversion off`.split(" ")
    //var tsp_args = `--realtime -I dvb --signal-timeout 10 --guard-interval auto --receive-timeout 10000 --adapter ${params.tuner} --delivery-system DVB-T2 --frequency ${params.frequency}000000 --transmission-mode auto --spectral-inversion off`.split(" ")
    var folders = []
    var ad_param;

    if (params.additional_params) {
        ad_param = JSON.parse(params.additional_params)
    }    

    /*
    if (params.dtv_use_fork) {
        tsp_args.push("-P")
        tsp_args.push("regulate")
    }
    */

    const LS_SOCKET = path.join(__dirname, `/../sock/${params.stream_id}`)

    for (let i = 0; i<params.channels.length; i++) {
        const channel = JSON.parse(JSON.stringify(params.channels[i]))
        const dtv_key = `${params.frequency}-${channel.id}`

        if (params.dtv_force_hd.indexOf(dtv_key) !== -1) {
            channel.is_hd = true
            channel.video.width = 1920
            channel.video.height = 1080        
            channel.video.fps *= 2    
        }

        const current_rendition = channel.is_hd ? (params.multiple_renditions ? params.renditions_hd : [params.renditions_hd[0]]) : (params.multiple_renditions ? params.renditions_sd : [params.renditions_sd[0]])
        const out_folder = `${params.output_path}/${channel.id}/`
        await fs_p.mkdir(out_folder, {recursive: true})
                
        folders.push(out_folder)

        var streams = [{type: "video", ...channel.video}]
        if (channel.audio) streams.push({type: "audio", ...channel.audio})

        var audio_filters = ""
        if (ad_param) {
            for (let j = 0; j<ad_param.length; j++) {
                const ad_parm = ad_param[j]
                if (ad_parm.for.indexOf(channel.video.id) !== -1 || ad_parm.for.indexOf(channel.audio.id) !== -1) {
                    // console.log(ad_param)
                    audio_filters = ad_parm.audio_filters
                }
            }
        }
        // console.log(audio_filters)

        // const tsp_fork_prm = ["-re", "-y", "-loglevel", "quiet"].concat(await ffmp_args.genSingle(params.dtv_use_fork ? "-" : `unix:${LS_SOCKET}`, current_rendition, streams, out_folder, params.hls_settings, -1, -1, audio_filters, passed_params.dtv_use_fork ? true : false))
        let used_watermark = ""

        if (params.watermark && params.watermark_ignore_streams.indexOf(`${params.stream_id}-${channel.id}`) === -1) {
            used_watermark = params.watermark.replace(/\(pathname\)/g, params.pathname)
        }

        const do_nvdec_scale = params.do_scale_exclude.indexOf(`${params.frequency}-${channel.id}`) === -1
        const do_hw_decoding = params.do_sw_decode.indexOf(`${params.frequency}-${channel.id}`) === -1

        const tsp_fork_prm = ["-y", "-loglevel", "repeat+level+error", "-probesize", "32", "-analyzeduration", "0"].concat(await ffmp_args.genSingle(params.dtv_use_fork ? "-" : `unix:${LS_SOCKET}`, current_rendition, streams, out_folder, params.hls_settings, -1, (channel.audio && params.dtv_ignore_map.indexOf(dtv_key) === -1) ? channel.audio.id : -1, audio_filters, passed_params.dtv_use_fork ? true : false, used_watermark, params.do_scale ? do_nvdec_scale : false, do_hw_decoding))
        
        if (passed_params.dtv_use_fork) {
            tsp_args.push("-P")
            tsp_args.push("fork")    

            //tsp_args.push("--nowait")

            /*
            tsp_args.push("--format")
            tsp_args.push("duck")
            */

            /*
            tsp_args.push("--buffered-packets")
            tsp_args.push("10000")           
            */                    

            if (Object.keys(params.dtv_udp_out).indexOf(dtv_key) !== -1) {
                if (params.use_protocol === "tcp") {
                    //tsp_args.push(`tsp -P zap ${channel.id} | ncat --send-only ${params.dtv_udp_out[dtv_key].split(":")[0]} ${params.dtv_udp_out[dtv_key].split(":")[1]}`)
                    //tsp_args.push(`tsp -P zap ${channel.id} | nc ${params.dtv_udp_out[dtv_key].split(":")[0]} ${params.dtv_udp_out[dtv_key].split(":")[1]}`)
                    //tsp_args.push(`tsp -P zap ${channel.id} | ${params.ffmpeg} -copyts -i - -map 0:v:0 ${channel.audio ? `-map 0:a:#${channel.audio.id} ` : ""}-vcodec copy -acodec copy -copyinkf -loglevel error -f mpegts tcp://${params.dtv_udp_out[dtv_key]}?send_buffer_size=1316`)
                    //tsp_args.push(`tsp -P zap ${channel.id} | ${params.ffmpeg} -loglevel error -f data -raw_packet_size 188 -i - -map 0:0 -f data tcp://${params.dtv_udp_out[dtv_key]}?send_buffer_size=1316`)
                    if (params.dtv_tcp_use_copy.indexOf(`${params.frequency}-${channel.id}`) !== -1) {
                        tsp_args.push(`tsp -P zap ${channel.id} | node ${path.join(__dirname, "/cmds")}/repeatc.js "tcp://${params.dtv_udp_out[dtv_key]}?send_buffer_size=188"`)
                    } else {
                        tsp_args.push(`tsp -P zap ${channel.id} | node ${path.join(__dirname, "/cmds")}/repeatp.js "tcp://${params.dtv_udp_out[dtv_key]}?send_buffer_size=188"`)
                    }
                } else if (params.use_protocol === "rtsp") {
                    tsp_args.push(`tsp -P zap ${channel.id} | ${params.ffmpeg} -copyts -i - -metadata "title=${channel.name}" -map 0:v:0 ${channel.audio ? `-map 0:a:#${channel.audio.id} ` : ""}-vcodec copy -acodec copy -copyinkf -loglevel error -f rtsp -rtsp_transport tcp rtsp://${params.dtv_udp_out[dtv_key]}/`)
                } else if (params.use_protocol === "udp") {``
                    tsp_args.push(`tsp --realtime --max-flushed-packets 7 --max-output-packets 7 --max-input-packets 7 -P zap ${channel.id} -O ip ${params.dtv_udp_out[dtv_key]}`)
                    //tsp_args.push(`tsp -P zap ${channel.id} | ${params.ffmpeg} -copyts -i - -vcodec copy -acodec copy -copyinkf -loglevel error -f mpegts udp://${params.dtv_udp_out[dtv_key]}?pkt_size=1316`)
                } else {
                    throw new Error(`Invalid output protocol: ${params.use_protocol}`)
                }
            } else {
                if (RESTART_EACH_STREAMS) {
                    //tsp_args.push(`node ${path.join(__dirname, "/cmds")}/repeat.js "${channel.name}" ${params.ffmpeg} -progress - -nostats ${tsp_fork_prm.join(" ")}`)
                    //tsp_args.push(`tsp -P zap ${channel.id} | node ${path.join(__dirname, "/cmds")}/repeat2.js "${channel.name}" '${params.ffmpeg} ${tsp_fork_prm.join(" ")}'`)
                    //console.log(`${params.ffmpeg} ${tsp_fork_prm.join(" ")}`)
                    if (!REPEAT_DETECT_STALLS) {
                        //tsp_args.push(`tsp --buffer-size-mb ${DEMUX_FORK_BUFFER} --receive-timeout 45000 --verbose -P zap ${channel.id} | node ${path.join(__dirname, "/cmds")}/repeat2.js "${channel.name}" '${params.ffmpeg} ${tsp_fork_prm.join(" ")}'`)
                        tsp_args.push(`tsp -P zap ${channel.id} | node ${path.join(__dirname, "/cmds")}/repeat2.js "${channel.name}" '${params.ffmpeg} ${tsp_fork_prm.join(" ")}'`)
                    } else {
                        //tsp_args.push(`tsp --buffer-size-mb ${DEMUX_FORK_BUFFER} --receive-timeout 45000 --verbose -P zap ${channel.id} | node ${path.join(__dirname, "/cmds")}/repeat4.js "${channel.name}" ${channel.video.fps >= 30 ? (channel.video.fps / 2) : channel.video.fps} ${params.ffmpeg} -stats_period 2 -progress - -nostats ${tsp_fork_prm.join(" ")}`)
                        tsp_args.push(`tsp -P zap ${channel.id} | node ${path.join(__dirname, "/cmds")}/repeat4.js "${channel.name}" ${channel.video.fps >= 30 ? (channel.video.fps / 2) : channel.video.fps} $PPID ${params.frequency} ${channel.id} "${out_folder}" ${params.ffmpeg} -stats_period 2 -progress - -nostats ${tsp_fork_prm.join(" ")}`)
                    }
                    //tsp_args.push(`python ${path.join(__dirname, "/cmds")}/repeat.py "${channel.name}" '${params.ffmpeg} ${tsp_fork_prm.join(" ")}'`)
                } else {
                    //tsp_args.push(`${params.ffmpeg} ${tsp_fork_prm.join(" ")}`)
                    //tsp_args.push(`tsp -P zap ${channel.id} | ${params.ffmpeg} ${tsp_fork_prm.join(" ")}`)
                    tsp_args.push(`tsp --verbose -P zap ${channel.id} | ${params.ffmpeg} ${tsp_fork_prm.join(" ")}`)
                }
            }
        } else {
            ffmpeg_params.push(tsp_fork_prm)
            ch_names.push(channel.name)
        }
    }

    if (passed_params.dtv_use_fork) {
        tsp_args.push("-O") 
        tsp_args.push("drop")
    } else {
        tsp_args.push("-P")
        tsp_args.push("regulate")

        tsp_args.push("-O")
        tsp_args.push("fork")
        
        if (fs.existsSync(LS_SOCKET)) {
            try {
                await fs_p.unlink(LS_SOCKET)
            } catch (e) {}
        }

        tsp_args.push(`ncat --send-only -U -k -m 64 -l "${LS_SOCKET}"`)
    }

    // console.log(tsp_args)
    // console.log(folders)

    ExecSignal.emit("exec", tsp_args, folders)
   } catch (e) {
    //console.trace(e)
    process.send({retry: true, stream_id: params.stream_id, type: params.type, params: {
        tuner: params.tuner,
        frequency: params.frequency,
        channels: params.channels,
        system: params.system,
        additional_params: params.additional_params
    }})
    process.exit(1)
   } 
})

process.on('message', (params) => {
    if (params.quit) {
        console.log("process received quit signal")
        is_quit = true
        process.send({retry: false, stream_id: params.stream_id})
    } else {
        //console.log(params)
        RunSignal.emit("run", params)
    }
});
