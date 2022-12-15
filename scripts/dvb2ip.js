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

var is_quit = false
const QuitSignal = new events.EventEmitter()
const RunSignal = new events.EventEmitter()

const QuitCheck = () => {
    if (is_quit) {
        QuitSignal.emit("quit")
    }
}

const USE_TSDUCK = true

setInterval(QuitCheck, 2000);

RunSignal.once("run", (params) => {    
    const src_url = `http://${params.src}:8999/stream=${params.src_id}.ts`

    check_output(params.ffmpeg.replace(/mpeg/g, "probe"), [..."-probesize 8M -loglevel quiet -print_format json -show_error -show_format -show_streams".split(" "), src_url]).then((o) => {
        const probe_streams = JSON.parse(o).streams
        if (probe_streams.length <= 0) {
            process.send({retry: true, stream_id: params.stream_id, type: params.type, params: {
                src: params.src,
                src_id: params.src_id,
                additional_params: params.additional_params
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

        const current_rendition = is_hd ? (params.multiple_renditions ? params.renditions : [params.renditions[0]]) : [params.renditions[1]]
        //console.log(current_rendition)

        if (USE_TSDUCK) {
            ffmp_args.genSingle("-", current_rendition, program_streams, params.output_path, params.hls_settings, -1, -1, params.additional_params).then((e) => {
                // "-loglevel", "quiet", 
                const args = ["-loglevel", "quiet", "-re", "-y"].concat(e)
                
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
                const tsduck = cp.spawn("tsp --realtime")
                const ffmp = cp.spawn(params.ffmpeg, args)                

                ffmp.on("close", () => {
                    if (!is_quit) {
                        process.send({retry: true, stream_id: params.stream_id, type: params.type, params: {
                            src: params.src,
                            src_id: params.src_id,
                            additional_params: params.additional_params
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
                ffmp.stderr.pipe(process.stderr)
            }).catch((e) => {
                console.trace(e)
                process.send({retry: true, stream_id: params.stream_id, type: params.type, params: {
                    src: params.src,
                    src_id: params.src_id,
                    additional_params: params.additional_params
                }})
                process.exit(1)
            })
        } else (
            ffmp_args.genSingle(src_url, current_rendition, program_streams, params.output_path, params.hls_settings, -1, -1, params.additional_params).then((e) => {
                // "-loglevel", "quiet", 
                const args = ["-loglevel", "quiet", "-reconnect", "1", "-reconnect_at_eof", "1", "-reconnect_streamed", "1", "-reconnect_on_network_error", "1", "-re", "-y"].concat(e)
                
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
                            additional_params: params.additional_params
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
                            ffmp.stdin.destroy()
                        } catch {}
                    })
                })                

                ffmp.stderr.pipe(process.stderr)
            }).catch((e) => {
                console.trace(e)
                process.send({retry: true, stream_id: params.stream_id, type: params.type, params: {
                    src: params.src,
                    src_id: params.src_id,
                    additional_params: params.additional_params
                }})
                process.exit(1)
            })
        )
    }).catch((e) => {
        process.send({retry: true, stream_id: params.stream_id, type: params.type, params: {
            src: params.src,
            src_id: params.src_id,
            additional_params: params.additional_params
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