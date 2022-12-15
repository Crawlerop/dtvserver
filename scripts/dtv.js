const process = require("process")
const cp = require("child_process")
const check_output = require("../utils/check_output")
const events = require("events")
const ffmp_args = require("../utils/genFFmpegArgs")
const fs = require("fs")
const fs_p = require("fs/promises")
const path = require("path")

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
                tsduck.stdout.pipe(p.stdin)
                p.stdin.on("error", ()=>{})
                ffmpeg.push(p)   
            } catch (e) {
                console.trace(e)
            }     
        }  
    }  

    tsduck.stdout.on("error", ()=>{})

    /*
    tsduck.stdout.on("data", (d) => {
        process.send(d.to)
    })
    */

    tsduck.stderr.pipe(process.stderr)
})

RunSignal.once("run", async (params) => {    
   try {
    passed_params = params    
    var tsp_args = `--buffer-size-mb 64 --max-flushed-packets 7 --max-output-packets 7 --max-input-packets 7 --realtime -I dvb --signal-timeout 10 --guard-interval auto --receive-timeout 10000 --adapter ${params.tuner} --delivery-system DVB-T2 --frequency ${params.frequency}000000 --transmission-mode auto --spectral-inversion off`.split(" ")
    //var tsp_args = `--realtime -I dvb --signal-timeout 10 --guard-interval auto --receive-timeout 10000 --adapter ${params.tuner} --delivery-system DVB-T2 --frequency ${params.frequency}000000 --transmission-mode auto --spectral-inversion off`.split(" ")
    var folders = []
    var ad_param;

    if (params.additional_params) {
        ad_param = JSON.parse(params.additional_params)
    }    

    for (let i = 0; i<params.channels.length; i++) {
        const channel = params.channels[i]
        const current_rendition = channel.is_hd ? (params.multiple_renditions ? params.renditions : [params.renditions[0]]) : [params.renditions[1]]
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

        const tsp_fork_prm = ["-re", "-y", "-loglevel", current_rendition[0].hwaccel === "nvenc" ? "error": "quiet"].concat(await ffmp_args.genSingle("-", current_rendition, streams, out_folder, params.hls_settings, channel.video.id, channel.audio ? channel.audio.id : 1, audio_filters, passed_params.dtv_use_fork ? true : false))
        
        if (passed_params.dtv_use_fork) {
            tsp_args.push("-P")
            tsp_args.push("fork")    
                        
            tsp_args.push("--buffered-packets")
            tsp_args.push("1000")            
            
            tsp_args.push(`node ${path.join(__dirname, "/cmds")}/repeat.js "${channel.name}" ${params.ffmpeg} -progress - -nostats ${tsp_fork_prm.join(" ")}`)
        } else {
            ffmpeg_params.push(tsp_fork_prm)
            ch_names.push(channel.name)
        }
    }

    if (passed_params.dtv_use_fork) {
        tsp_args.push("-O") 
        tsp_args.push("drop")
    }

    // console.log(tsp_args)
    // console.log(folders)

    ExecSignal.emit("exec", tsp_args, folders)
   } catch (e) {
    process.send({retry: true, stream_id: params.stream_id, type: params.type, params: {
        tuner: params.tuner,
        frequency: params.frequency,
        channels: params.channels,
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