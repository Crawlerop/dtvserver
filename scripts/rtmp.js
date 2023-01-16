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

ExecSignal.on("exec", (args) => {
    const ffmp = cp.spawn(passed_params.ffmpeg, args)

    ffmp.on("exit", () => {
        if (!is_quit) {
            ExecSignal.emit("exec", args)
        } else {
            try {
                fs.rmSync(passed_params.output_path, {force: true, recursive: true})
            } catch (e) {
                console.trace(e)
            }
            console.log("rtmp shut down gracefully")
            process.exit(0)
        }
    })
    ffmp.stderr.pipe(process.stderr)
})

RunSignal.once("run", async (params) => {  
    passed_params = params
    const rtmp_url = `rtmp://localhost:${params.rtmp_port}/live/${params.rtmp_id}?token=${params.rtmp_token_id}`;  
    try {
        if (params.passthrough) {
            const ffmp_arg = ["-loglevel", "quiet", "-y", "-rw_timeout", "10000000"].concat(await ffmp_args.genSinglePass(rtmp_url, params.output_path, params.hls_settings))

            ExecSignal.emit("exec", ffmp_arg)
        } else {
            const probe_data = await check_output(params.ffmpeg.replace(/mpeg/g, "probe"), [..."-probesize 2M -loglevel quiet -print_format json -show_error -show_format -show_streams".split(" "), rtmp_url])

            const probe_streams = JSON.parse(probe_data).streams
            if (probe_streams.length <= 0) {
                process.send({retry: false, stream_id: params.stream_id})
                process.exit(1)
            }
            var is_hd = false;
            var program_streams = []
            
            for (var j = 0; j<probe_streams.length; j++) {
                var stream = probe_streams[j];
                if (stream.codec_type == "video") {
                    if (stream.height >= 720) is_hd = true
                    program_streams.push({
                        type: "video", 
                        width: stream.width, 
                        height: stream.height,
                        fps: eval(stream.avg_frame_rate),
                        interlace: stream.field_order,
                        id: stream.id,
                        codec: stream.codec_name
                    })
                } else if (stream.codec_type == "audio" && eval(stream.sample_rate) > 0) {
                    program_streams.push({
                        type: "audio", 
                        sample_rate: eval(stream.sample_rate),
                        channels: stream.channels,
                        bitrate: eval(stream.bit_rate) / 1000,
                        id: stream.id,
                        codec: stream.codec_name
                    })
                }
            }
            
            //console.log(program_streams)
            //console.log(is_hd)

            const current_rendition = is_hd ? (params.multiple_renditions ? params.renditions_hd : [params.renditions_hd[0]]) : (params.multiple_renditions ? params.renditions_sd : [params.renditions_sd[0]])
            const ffmp_arg = ["-loglevel", "quiet", "-y", "-rw_timeout", "10000000", "-probesize", "32", "-analyzeduration", "0"].concat(await ffmp_args.genSingle(rtmp_url, current_rendition, program_streams, params.output_path, params.hls_settings))

            ExecSignal.emit("exec", ffmp_arg)
        }
    } catch (e) {
        process.send({retry: false, stream_id: params.stream_id})
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