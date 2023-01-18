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

const TSP_BUFFER_SIZE = 48
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
    const src_url = `http://${params.src}:8999/stream=${params.src_id}.ts`
    var ad_param = {};

    if (params.additional_params) {
        ad_param = JSON.parse(params.additional_params)
    }   

    check_output(params.ffmpeg.replace(/mpeg/g, "probe"), [..."-probesize 48M -loglevel quiet -print_format json -show_error -show_format -show_streams".split(" "), src_url]).then((o) => {
        const probe_streams = JSON.parse(o).streams
        if (probe_streams.length <= 0) {
            process.send({retry: true, stream_id: params.stream_id, type: params.type, params: {
                src: params.src,
                src_id: params.src_id,
                additional_params: params.additional_params,
                name: params.name
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

        if (USE_TSDUCK) {
            ffmp_args.genSingle("-", current_rendition, program_streams, params.output_path, params.hls_settings, -1, -1, ad_param.audio_params, false, params.watermark).then((e) => {
                // "-loglevel", "quiet", 
                const args = ["-loglevel", "repeat+level+error", "-probesize", "32", "-analyzeduration", "0", "-y"].concat(e)
                
                //throw new Error("e")
                //console.log(args)
                //process.exit(1)

                /*
                    Multiple processes have to be used because we're mostly dealing with out of sync TS packets from a DVB2IP device.

                    pipe = "obtain TS packets as raw from HTTP"
                    tssync = "normalize TS packets"
                    tsp = "prevents FFmpeg from complaining"
                    ffmp = "output the normalized packets to the transcoder"
                */

                pipe = cp.spawn(params.ffmpeg, ["-raw_packet_size", "188", "-loglevel", "quiet", "-reconnect", "1", "-reconnect_at_eof", "1", "-reconnect_streamed", "1", "-reconnect_on_network_error", "1", "-f", "data", "-i", src_url, "-c", "copy", "-map", "0:0", "-f", "data", "-"])
                const tssync = cp.spawn("tsresync", ["-c", "-"])
                const tsduck = cp.spawn("tsp", ["--buffer-size-mb",TSP_BUFFER_SIZE])
                const ffmp = cp.spawn(params.ffmpeg, args)                

                ffmp.on("close", () => {
                    if (!is_quit) {
                        process.send({retry: true, stream_id: params.stream_id, type: params.type, params: {
                            src: params.src,
                            src_id: params.src_id,
                            additional_params: params.additional_params,
                            name: params.name
                        }})
                        process.exit(1)
                    } else {
                        try {
                            fs.rmSync(params.output_path, {force: true, recursive: true})
                        } catch (e) {
                            console.trace(e)
                        }
                        console.log("dvb2ip shut down gracefully")
                        process.exit(0)
                    }
                })

                pipe.stdout.on("error", (e) => {
                    
                })

                ffmp.stdin.on("error", (e) => {

                })

                tssync.stdin.on("error", (e) => {

                })

                tssync.stdout.on("error", (e) => {

                })

                tsduck.stdin.on("error", (e) => {

                })

                tsduck.stdout.on("error", (e) => {
                    
                })

                QuitSignal.once("quit", () => {
                    process.nextTick(() => {
                        try {
                            ffmp.stdin.destroy()
                        } catch {}
                    })
                })                

                pipe.stdout.pipe(tssync.stdin)                
                tssync.stdout.pipe(tsduck.stdin)
                tsduck.stdout.pipe(ffmp.stdin)

                tsduck.stderr.pipe(process.stderr)
                tssync.stderr.pipe(process.stderr)
                pipe.stderr.pipe(process.stderr)
                //ffmp.stderr.pipe(process.stderr)

                ffmp.stderr.on("data", (d) => {
                    const lines = d.toString().split(os.EOL)
                    for (let ln = 0; ln<lines.length; ln++) {
                        if (lines[ln].length > 0) process.stderr.write(`${params.name}: ${lines[ln]}${os.EOL}`)
                    }
                })
            }).catch((e) => {
                console.trace(e)
                process.send({retry: true, stream_id: params.stream_id, type: params.type, params: {
                    src: params.src,
                    src_id: params.src_id,
                    additional_params: params.additional_params,
                    name: params.name
                }})
                process.exit(1)
            })
        } else (
            ffmp_args.genSingle(src_url, current_rendition, program_streams, params.output_path, params.hls_settings, -1, -1, ad_param.audio_params, false, params.watermark).then((e) => {
                // "-loglevel", "quiet", 
                const args = ["-loglevel", "repeat+level+error", "-reconnect", "1", "-reconnect_at_eof", "1", "-reconnect_streamed", "1", "-reconnect_on_network_error", "1", "-y"].concat(e)
                
                //throw new Error("e")
                //console.log(args)
                //process.exit(1)

                /*
                    Multiple processes have to be used because we're mostly dealing with out of sync TS packets from a DVB2IP device.

                    pipe = "obtain TS packets as raw from HTTP"
                    tssync = "normalize TS packets"
                    tsp = "prevents FFmpeg from complaining"
                    ffmp = "output the normalized packets to the transcoder"
                */
                
                const ffmp = cp.spawn(params.ffmpeg, args)                

                ffmp.on("close", () => {
                    if (!is_quit) {
                        process.send({retry: true, stream_id: params.stream_id, type: params.type, params: {
                            src: params.src,
                            src_id: params.src_id,
                            additional_params: params.additional_params,
                            name: params.name
                        }})
                        process.exit(1)
                    } else {
                        try {
                            fs.rmSync(params.output_path, {force: true, recursive: true})
                        } catch (e) {
                            console.trace(e)
                        }
                        console.log("dvb2ip shut down gracefully")
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
                        if (lines[ln].length > 0) process.stderr.write(`${params.name}: ${lines[ln]}${os.EOL}`)
                    }
                })

                //ffmp.stderr.pipe(process.stderr)
            }).catch((e) => {
                console.trace(e)
                process.send({retry: true, stream_id: params.stream_id, type: params.type, params: {
                    src: params.src,
                    src_id: params.src_id,
                    additional_params: params.additional_params,
                    name: params.name
                }})
                process.exit(1)
            })
        )
    }).catch((e) => {
        process.send({retry: true, stream_id: params.stream_id, type: params.type, params: {
            src: params.src,
            src_id: params.src_id,
            additional_params: params.additional_params,
            name: params.name
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
