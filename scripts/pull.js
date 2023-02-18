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
    check_output(params.ffmpeg.replace(/mpeg/g, "probe"), [..."-probesize 8M -loglevel quiet -print_format json -show_error -show_format -show_streams".split(" "), params.src]).then((o) => {
        const probe_streams = JSON.parse(o).streams
        if (probe_streams.length <= 0) {
            process.send({retry: true, stream_id: params.stream_id, type: params.type, params: {
                source: params.src,
                realtime: params.realtime,
                passthrough: params.passthrough
            }})
            process.exit(1)
        }
        var is_hd = false;
        var program_streams = []

        var video;
        var audio;
        
        for (let j = 0; j<probe_streams.length; j++) {
            var stream = probe_streams[j];
            if (stream.codec_type == "video") {
                if (stream.height >= 720) is_hd = true
                video = {
                    type: "video", 
                    width: stream.width, 
                    height: stream.height,
                    fps: eval(stream.avg_frame_rate),
                    interlace: stream.field_order,
                    id: stream.id,
                    codec: stream.codec_name
                }
                program_streams.push(video)
            } else if (stream.codec_type == "audio" && eval(stream.sample_rate) > 0) {
                audio = {
                    type: "audio", 
                    sample_rate: eval(stream.sample_rate),
                    channels: stream.channels,
                    bitrate: eval(stream.bit_rate) / 1000,
                    id: stream.id,
                    codec: stream.codec_name
                }
                program_streams.push(audio)
            }
        }
        
        //console.log(program_streams)
        //console.log(is_hd)

        const current_rendition = is_hd ? (params.multiple_renditions ? params.renditions_hd : [params.renditions_hd[0]]) : (params.multiple_renditions ? params.renditions_sd : [params.renditions_sd[0]])
        //console.log(current_rendition)
        
        const PROBE = params.passthrough ? "2M" : "32"

        if (params.passthrough) {
            ffmp_args.genSinglePass(params.src, params.output_path, params.hls_settings).then((e) => {
                // "-loglevel", "quiet", 
                //const args = (params.realtime ? ["-re", "-loglevel", "repeat+level+error", "-y", "-probesize", "32", "-analyzeduration", "0"] : ["-loglevel", "repeat+level+error", "-y", "-probesize", "32", "-analyzeduration", "0"]).concat(params.src.startsWith("rtsp") ? ["-rtsp_transport", "tcp"] : params.src.startsWith("http") ? ["-rw_timeout", "30000000", "-reconnect", "1", "-reconnect_at_eof", "1", "-reconnect_streamed", "1", "-reconnect_on_network_error", "1"] : []).concat(e)
                const args = (params.realtime ? ["-re", "-loglevel", "repeat+level+error", "-y", "-probesize", PROBE, "-analyzeduration", "0", "-stats_period", "2"] : ["-loglevel", "repeat+level+error", "-y", "-probesize", PROBE, "-analyzeduration", "0", "-stats_period", "2"]).concat(params.src.startsWith("rtsp") ? ["-rtsp_transport", "tcp"] : params.src.startsWith("http") ? ["-rw_timeout", "30000000"] : params.src.endsWith(".m3u8") ? ["-live_start_index", "-1"] : []).concat(e)

                const ffmp = cp.spawn(params.ffmpeg, args)                

                ffmp.on("close", () => {
                    if (!is_quit) {
                        process.send({retry: true, stream_id: params.stream_id, type: params.type, params: {
                            source: params.src,
                            realtime: params.realtime,
                            passthrough: params.passthrough                      
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

                /*
                ffmp.stdout.on("data", (d) => {
                    const chunks = d.toString().split(os.EOL)
                    for (let i = 0; i<chunks.length; i++) {
                        if (chunks[i].length >= 0) {
                            const key = chunks[i].split("=")[0]
                            const val = chunks[i].split("=")[1]
            
                            //STREAM_TIMEOUT_VAL = Date.now() + STREAM_TIMEOUT_DUR
                            if (key === "frame") {
                                /*
                                if (parseInt(val) !== LAST_FRAME) {
                                    LAST_FRAME = parseInt(val)
                                    TIMEOUT_VAL = Date.now() + TIMEOUT_DUR
                                    //process.stderr.write(`Track stalled status\n`)
                                }
                                /
                            } else if (key === "fps") {
                                fps = video.fps <= 30 ? video.fps : video.fps / 2
                                
                                if (parseFloat(val) < parseFloat(fps)) {
                                    console.log(`${params.src} FPS: ${parseFloat(val)} < ${parseFloat(fps)}`)
                                }
                                
                                //
                            }
                        }
                    }
                })
                */

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
                    realtime: params.realtime,
                    passthrough: params.passthrough
                }})
                process.exit(1)
            })        
        } else {
            ffmp_args.genSingle(params.src, current_rendition, program_streams, params.output_path, params.hls_settings, -1, -1, "", false, params.watermark).then((e) => {
                // "-loglevel", "quiet", 
                //const args = (params.realtime ? ["-re", "-loglevel", "repeat+level+error", "-y", "-probesize", "32", "-analyzeduration", "0"] : ["-loglevel", "repeat+level+error", "-y", "-probesize", "32", "-analyzeduration", "0"]).concat(params.src.startsWith("rtsp") ? ["-rtsp_transport", "tcp"] : params.src.startsWith("http") ? ["-rw_timeout", "30000000", "-reconnect", "1", "-reconnect_at_eof", "1", "-reconnect_streamed", "1", "-reconnect_on_network_error", "1"] : []).concat(e)
                const args = (params.realtime ? ["-re", "-loglevel", "repeat+level+error", "-y", "-probesize", PROBE, "-analyzeduration", "0", "-stats_period", "2"] : ["-loglevel", "repeat+level+error", "-y", "-probesize", PROBE, "-analyzeduration", "0", "-stats_period", "2"]).concat(params.src.startsWith("rtsp") ? ["-rtsp_transport", "tcp"] : params.src.startsWith("http") ? ["-rw_timeout", "30000000"] : params.src.endsWith(".m3u8") ? ["-live_start_index", "-1"] : []).concat(e)

                const ffmp = cp.spawn(params.ffmpeg, args)                

                ffmp.on("close", () => {
                    if (!is_quit) {
                        process.send({retry: true, stream_id: params.stream_id, type: params.type, params: {
                            source: params.src,
                            realtime: params.realtime,
                            passthrough: params.passthrough                      
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

                /*
                ffmp.stdout.on("data", (d) => {
                    const chunks = d.toString().split(os.EOL)
                    for (let i = 0; i<chunks.length; i++) {
                        if (chunks[i].length >= 0) {
                            const key = chunks[i].split("=")[0]
                            const val = chunks[i].split("=")[1]
            
                            //STREAM_TIMEOUT_VAL = Date.now() + STREAM_TIMEOUT_DUR
                            if (key === "frame") {
                                /*
                                if (parseInt(val) !== LAST_FRAME) {
                                    LAST_FRAME = parseInt(val)
                                    TIMEOUT_VAL = Date.now() + TIMEOUT_DUR
                                    //process.stderr.write(`Track stalled status\n`)
                                }
                                /
                            } else if (key === "fps") {
                                fps = video.fps <= 30 ? video.fps : video.fps / 2
                                
                                if (parseFloat(val) < parseFloat(fps)) {
                                    console.log(`${params.src} FPS: ${parseFloat(val)} < ${parseFloat(fps)}`)
                                }
                                
                                //
                            }
                        }
                    }
                })
                */

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
                    realtime: params.realtime,
                    passthrough: params.passthrough
                }})
                process.exit(1)
            })        
        }
    }).catch((e) => {        
        process.send({retry: true, stream_id: params.stream_id, type: params.type, params: {
            source: params.src,
            realtime: params.realtime,
            passthrough: params.passthrough
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
