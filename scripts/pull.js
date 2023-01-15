const process = require("process")
const cp = require("child_process")
const check_output = require("../utils/check_output")
const events = require("events")
const ffmp_args = require("../utils/genFFmpegArgs")
const fs = require("fs")
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

var is_quit = false
const QuitSignal = new events.EventEmitter()
const RunSignal = new events.EventEmitter()

const QuitCheck = () => {
    if (is_quit) {
        QuitSignal.emit("quit")
    }
}

const USE_TSDUCK = false

setInterval(QuitCheck, 2000);

RunSignal.once("run", (params) => {    
    check_output(params.ffmpeg.replace(/mpeg/g, "probe"), [..."-probesize 12M -loglevel quiet -print_format json -show_error -show_format -show_streams".split(" "), params.src]).then((o) => {
        const probe_streams = JSON.parse(o).streams
        if (probe_streams.length <= 0) {
            process.send({retry: true, stream_id: params.stream_id, type: params.type, params: {
                source: params.src,
                realtime: params.realtime
            }})
            process.exit(1)
        }
        var is_hd = false;
        var program_streams = []
        
        for (let j = 0; j<probe_streams.length; j++) {
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
        //console.log(current_rendition)
        
        ffmp_args.genSingle(params.src, current_rendition, program_streams, params.output_path, params.hls_settings, -1, -1, "", false, params.watermark).then((e) => {
            // "-loglevel", "quiet", 
            const args = (params.realtime ? ["-re", "-loglevel", "repeat+level+error", "-y"] : ["-loglevel", "repeat+level+error", "-y"]).concat(params.src.startsWith("rtsp") ? ["-rtsp_transport", "tcp", "-reconnect", "1"] : []).concat(e)

            const ffmp = cp.spawn(params.ffmpeg, args)                

            ffmp.on("close", () => {
                if (!is_quit) {
                    process.send({retry: true, stream_id: params.stream_id, type: params.type, params: {
                        source: params.src,
                        realtime: params.realtime                           
                    }})
                    process.exit(1)
                } else {
                    try {
                        fs.rmSync(params.output_path, {force: true, recursive: true})
                    } catch (e) {
                        console.trace(e)
                    }
                    console.log("pull shut down gracefully")
                    process.exit(0)
                }
            })

            ffmp.stdin.on("error", (e) => {

            })

            QuitSignal.once("quit", () => {
                process.nextTick(() => {
                    try {
                        ffmp.kill("SIGTERM")
                    } catch {}
                })
            })                

            ffmp.stderr.on("data", (d) => {
                const lines = d.toString().split(os.EOL)
                for (let ln = 0; ln<lines.length; ln++) {
                    if (lines[ln].length > 0) process.stderr.write(`${params.src}: ${lines[ln]}${os.EOL}`)
                }
            })
        }).catch((e) => {
            process.send({retry: true, stream_id: params.stream_id, type: params.type, params: {
                source: params.src,
                realtime: params.realtime
            }})
            process.exit(1)
        })        
    }).catch((e) => {        
        process.send({retry: true, stream_id: params.stream_id, type: params.type, params: {
            source: params.src,
            realtime: params.realtime
        }})
        process.exit(1)
    });    
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
