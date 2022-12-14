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

RunSignal.once("run", async (params) => {    
   try {
    passed_params = params    
    //var tsp_args = `--buffer-size-mb 32 --realtime -I dvb --signal-timeout 10 --guard-interval auto --receive-timeout 10000 --adapter ${params.tuner} --delivery-system DVB-T2 --frequency ${params.frequency}000000 --transmission-mode auto --spectral-inversion off`.split(" ")
    //var tsp_args = `--buffer-size-mb 512 --max-flushed-packets 7 --max-output-packets 7 --max-input-packets 7 --realtime -I dvb --signal-timeout 10 --guard-interval auto --receive-timeout 10000 --adapter ${params.tuner} --delivery-system DVB-T2 --frequency ${params.frequency}000000 --transmission-mode auto --spectral-inversion off`.split(" ")
    //var tsp_args = `--buffer-size-mb ${params.buffer_size} --receive-timeout 10000 --realtime -I dvb --signal-timeout 10 --guard-interval auto --adapter ${params.tuner} --delivery-system DVB-T2 --frequency ${params.frequency}000000 --transmission-mode auto --spectral-inversion off`.split(" ")
    var tsp_args = `--buffer-size-mb ${params.buffer_size} --receive-timeout 10000 --realtime -I dvb --signal-timeout 10 --guard-interval auto --adapter ${params.tuner} --delivery-system ${params.system} --demux-buffer-size ${8*1024} --frequency ${params.frequency*1e6} --transmission-mode auto --spectral-inversion off`.split(" ")
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
        const channel = params.channels[i]
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

        const tsp_fork_prm = ["-y", "-loglevel", "repeat+level+error", "-probesize", "12M"].concat(await ffmp_args.genSingle(params.dtv_use_fork ? "-" : `unix:${LS_SOCKET}`, current_rendition, streams, out_folder, params.hls_settings, channel.video.id, channel.audio ? channel.audio.id : -1, audio_filters, passed_params.dtv_use_fork ? true : false, used_watermark))
        
        if (passed_params.dtv_use_fork) {
            tsp_args.push("-P")
            tsp_args.push("fork")    

            /*
            tsp_args.push("--buffered-packets")
            tsp_args.push("10000")           
            */
            
            if (RESTART_EACH_STREAMS) {
                //tsp_args.push(`node ${path.join(__dirname, "/cmds")}/repeat.js "${channel.name}" ${params.ffmpeg} -progress - -nostats ${tsp_fork_prm.join(" ")}`)
                //tsp_args.push(`tsp -P zap ${channel.id} | node ${path.join(__dirname, "/cmds")}/repeat2.js "${channel.name}" '${params.ffmpeg} ${tsp_fork_prm.join(" ")}'`)
                //console.log(`${params.ffmpeg} ${tsp_fork_prm.join(" ")}`)
                if (!REPEAT_DETECT_STALLS) {
                    tsp_args.push(`tsp -P zap ${channel.id} | node ${path.join(__dirname, "/cmds")}/repeat2.js "${channel.name}" '${params.ffmpeg} ${tsp_fork_prm.join(" ")}'`)
                } else {
                    tsp_args.push(`tsp -P zap ${channel.id} | node ${path.join(__dirname, "/cmds")}/repeat4.js "${channel.name}" ${channel.video.fps >= 30 ? (channel.video.fps / 2) : channel.video.fps} ${params.ffmpeg} -stats_period 2 -progress - -nostats ${tsp_fork_prm.join(" ")}`)
                }
                //tsp_args.push(`python ${path.join(__dirname, "/cmds")}/repeat.py "${channel.name}" '${params.ffmpeg} ${tsp_fork_prm.join(" ")}'`)
            } else {
                //tsp_args.push(`${params.ffmpeg} ${tsp_fork_prm.join(" ")}`)
                //tsp_args.push(`tsp -P zap ${channel.id} | ${params.ffmpeg} ${tsp_fork_prm.join(" ")}`)
                tsp_args.push(`${params.ffmpeg} ${tsp_fork_prm.join(" ")}`)
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
