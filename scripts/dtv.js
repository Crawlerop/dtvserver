const process = require("process")
const cp = require("child_process")
const check_output = require("../utils/check_output")
const events = require("events")
const ffmp_args = require("../utils/genFFmpegArgs")
const fs = require("fs")

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

const QuitCheck = () => {
    if (is_quit) {
        QuitSignal.emit("quit")
    }
}

setInterval(QuitCheck, 2000);

ExecSignal.once("exec", (args, folders) => {
    const tsduck = cp.spawn("tsp", args)

    tsduck.on("exit", () => {
        if (!is_quit) {
            process.send({retry: true, stream_id: passed_params.stream_id, type: passed_params.type, params: {
                tuner: passed_params.tuner,
                frequency: passed_params.frequency,
                channels: passed_params.channels,
            }})
            process.exit(1)
        } else {
            for (var i = 0; i<folders.length; i++) {
                try {
                    fs.rmSync(folders[i], {force: true, recursive: true})
                } catch (e) {
                    console.trace(e)
                }
            }
            console.log("dtv shut down gracefully")
            process.exit(0)
        }
    })
    tsduck.stderr.pipe(process.stderr)
})

RunSignal.once("run", async (params) => {    
   try {
    passed_params = params    
    var tsp_args = `-I dvb --signal-timeout 10 --guard-interval auto --receive-timeout 10 --adapter ${params.tuner} --delivery-system DVB-T2 --frequency ${params.frequency}000000 --transmission-mode auto --spectral-inversion off`.split(" ")
    var folders = []

    for (var i = 0; i<params.channels.length; i++) {
        const channel = params.channels[i]
        const current_rendition = channel.is_hd ? (params.multiple_renditions ? params.renditions : [params.renditions[0]]) : [params.renditions[1]]
        const out_folder = `${params.output_path}/${channel.id}/`
        folders.push(out_folder)

        var streams = [{type: "video", ...channel.video}]
        if (channel.audio) streams.push({type: "audio", ...channel.audio})
        const tsp_fork_prm = ["-re", "-y", "-loglevel", "error"].concat(await ffmp_args.genSingle("-", current_rendition, streams, out_folder, params.hls_settings, channel.video.id, channel.audio ? channel.audio.id : 1, true))
        tsp_args.push("-P")
        tsp_args.push("fork")        
        tsp_args.push(`tsp | ${params.ffmpeg} ${tsp_fork_prm.join(" ")}`)
    }
    tsp_args.push("-O")
    tsp_args.push("drop")

    ExecSignal.emit("exec", tsp_args, folders)
   } catch (e) {
    process.send({retry: true, stream_id: params.stream_id, type: params.type, params: {
        tuner: params.tuner,
        frequency: params.frequency,
        channels: params.channels,
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
        RunSignal.emit("run", params)
    }
});