const check_output = require("./check_output")
const glob = require("glob")

const _globAsync = (pattern) => {
    return new Promise((res, rej) => {
        glob(pattern,(err, list) => {
            if (err) return rej(err)
            return res(list)
        })
    })
}

module.exports = {
    genSingle: async (source, renditions, stream, output, hls_settings, video_id=-1, audio_id=-1, audio_filters="", escape_filters=false) => {
        var args = [];

        var video = null;
        var audio = null;

        for (var i =0; i<stream.length; i++) {
            if (!video && stream[i].type == "video") {
                video = stream[i]
            } else if (!audio && stream[i].type == "audio") {
                audio = stream[i]
            }
            if (video && audio) break
        }
            
        var dri_to_use = ""
        var is_start = false
        var stream_map = ""

        args.push("-threads")
        args.push("4")

        for (var i =0; i<renditions.length; i++) {
            const rendition = renditions[i]
                
            if (rendition.hwaccel == "vaapi") {
                if (!is_start) {
                    is_start = true            
                    const render_devices = await _globAsync("/dev/dri/render*")
                                
                    for (var j =0; j<render_devices.length; j++) {
                        try {
                            const va_check = await check_output('vainfo', ['-a', '--display', 'drm', '--device', render_devices[j]])

                            if (va_check.includes('VAEntrypointEncSlice')) {
                                dri_to_use = render_devices[j]
                                break
                            }
                        } catch {

                        }
                    }

                    if (!dri_to_use) throw new Error("vaapi is not available");                                        

                    args.push("-hwaccel")
                    args.push("vaapi")
                    args.push("-hwaccel_device")
                    args.push(dri_to_use)
                    args.push("-hwaccel_output_format")
                    args.push("vaapi")
                    /*
                    if (video.codec === "h264") {
                        args.push(`-c:v:${i}`)
                        args.push("h264_vaapi")
                    } else if (video.codec === "mpeg2video") {
                        args.push(`-c:v:${i}`)
                        args.push("h264_vaapi")
                    }
                    */
                    args.push("-i")
                    args.push(source)
                }

                const INTERP_ALGO_TO_VAAPI = {
                    0: 0,
                    1: 256,
                    2: 512,
                    3: 768
                }
            
                args.push("-map")
                if (video_id != -1) {
                    args.push(`0:v:#${video_id}`)
                } else {
                    args.push("0:v:0")
                }                
                if (audio) {
                    args.push("-map")
                    if (audio_id != -1) {
                        args.push(`0:a:#${audio_id}`)
                    } else {
                        args.push("0:a:0")
                    }
                }
                if (audio) {
                    stream_map += `v:${i},a:${i},name:${(i+1).toString().padStart(2, "0")}`
                } else {
                    stream_map += `v:${i},name:${(i+1).toString().padStart(2, "0")}`
                } 

                args.push(`-map_metadata`)
                args.push("-1")
                args.push(`-c:v:${i}`)
                args.push("h264_vaapi")
                args.push(`-filter:v:${i}`)
                if (escape_filters) {
                    args.push(`"format=nv12|vaapi,hwupload,deinterlace_vaapi,scale_vaapi=${rendition.width}:${rendition.height}:mode=${INTERP_ALGO_TO_VAAPI[rendition.interp_algo]},setsar=1"`)
                } else {
                    args.push(`format=nv12|vaapi,hwupload,deinterlace_vaapi,scale_vaapi=${rendition.width}:${rendition.height}:mode=${INTERP_ALGO_TO_VAAPI[rendition.interp_algo]},setsar=1`)
                }
                args.push(`-compression_level:v:${i}`)
                args.push(rendition.speed)
            } else if (rendition.hwaccel == "nvenc") {
                if (!is_start) {
                    is_start = true
                    args.push("-hwaccel")
                    args.push("cuda")
                    args.push("-hwaccel_output_format")
                    args.push("cuda")

                    if (video.codec === "h264") {
                        args.push(`-c:v:${i}`)
                        args.push("h264_cuvid")
                    } else if (video.codec === "mpeg4") {
                        args.push(`-c:v:${i}`)
                        args.push("mpeg4_cuvid")
                    } else if (video.codec === "mpeg2video") {
                        args.push(`-c:v:${i}`)
                        args.push("mpeg2_cuvid")
                    } else if (video.codec === "mpeg1video") {
                        args.push(`-c:v:${i}`)
                        args.push("mpeg1_cuvid")
                    }

                    args.push("-i")
                    args.push(source)
                }

                args.push("-map")
                if (video_id != -1) {
                    args.push(`0:v:#${video_id}`)
                } else {
                    args.push("0:v:0")
                }                
                if (audio) {
                    args.push("-map")
                    if (audio_id != -1) {
                        args.push(`0:a:#${audio_id}`)
                    } else {
                        args.push("0:a:0")
                    }
                }
                if (audio) {
                    stream_map += `v:${i},a:${i},name:${(i+1).toString().padStart(2, "0")}`
                } else {
                    stream_map += `v:${i},name:${(i+1).toString().padStart(2, "0")}`
                }            

                args.push(`-map_metadata`)
                args.push("-1")
                args.push(`-c:v:${i}`)
                args.push("h264_nvenc")
                args.push(`-filter:v:${i}`)
                if (escape_filters) {
                    args.push(`"format=yuv420p|cuda,hwupload,yadif_cuda,scale_cuda=${rendition.width}:${rendition.height}:interp_algo=${rendition.interp_algo},setsar=1"`)
                } else {
                    args.push(`format=yuv420p|cuda,hwupload,yadif_cuda,scale_cuda=${rendition.width}:${rendition.height}:interp_algo=${rendition.interp_algo},setsar=1`)
                }
                args.push(`-preset:v:${i}`)
                args.push(`p${rendition.speed}`)
            }
            
            args.push(`-profile:v:${i}`)
            args.push(rendition.profile)
            args.push(`-b:v:${i}`)
            args.push(rendition.video_bitrate)
            args.push(`-maxrate:v:${i}`)
            args.push(rendition.video_bitrate)
            args.push(`-bufsize:v:${i}`)
            args.push(rendition.bufsize)
            args.push(`-bf:v:${i}`)
            args.push(rendition.bf)
            args.push(`-flags:v:${i}`)

            let fps = video.fps
            if (fps >= 30) fps /= 2

            if (fps != video.fps) {
                args.push("-r")
                args.push(fps)
            }

            args.push("+cgop")
            args.push(`-g:v:${i}`)
            args.push(Math.round(fps*2))
            args.push(`-keyint_min:v:${i}`)
            args.push(Math.round(fps*2))
            if (audio) {
                args.push(`-c:a:${i}`)
                args.push(rendition.audio_codec)
                if (rendition.audio_codec === "aac") {
                    args.push(`-aac_coder:a:${i}`)
                    args.push("twoloop")
                }
                args.push(`-b:a:${i}`)
                args.push(rendition.audio_bitrate)
                args.push(`-profile:a:${i}`)
                args.push("aac_"+rendition.audio_profile)
                if (audio_filters) {
                    // console.log(audio_filters)
                    args.push(`-filter:a:${i}`)
                    if (escape_filters) {
                        args.push(`"${audio_filters}"`)
                    } else {
                        args.push(audio_filters)
                    }
                }
            }
        }

        args.push("-var_stream_map")
        args.push(stream_map)

        args.push("-hls_time")
        args.push(hls_settings.duration)
        args.push("-hls_list_size")
        args.push(hls_settings.list_size)
        args.push("-hls_delete_threshold")
        args.push(hls_settings.unreferenced_segments)

        args.push("-master_pl_name")
        args.push("index.m3u8")
        /*
        args.push("-master_pl_publish_rate")
        args.push(10)
        */
        args.push("-hls_flags")
        args.push("+delete_segments+omit_endlist+append_list+discont_start+program_date_time+second_level_segment_index+temp_file")
        args.push("-strftime")
        args.push(1)
        args.push("-hls_segment_filename")
        args.push(output+"/%Y%m%dT%H%M%S-%v-%%01d.ts")
        args.push(output+"%v.m3u8")

        return args
        // main -b:v 600k -maxrate:v 600k -bufsize:v 1M
    },

    genMultiple: async (sources, renditions, streams, output, hls_settings) => {
        /*
        var args = [];

        var video = null;
        var audio = null;

        for (var i =0; i<stream.length; i++) {
            if (!video && stream[i].type == "video") {
                video = stream[i]
            } else if (!audio && stream[i].type == "audio") {
                audio = stream[i]
            }
            if (video && audio) break
        }
            
        var dri_to_use = ""
        var is_start = false
        var stream_map = ""

        for (var i =0; i<renditions.length; i++) {
            const rendition = renditions[i]
                
            if (rendition.hwaccel == "vaapi") {
                if (!is_start) {
                    is_start = true            
                    const render_devices = await _globAsync("/dev/dri/render*")
                                
                    for (var j =0; j<render_devices.length; j++) {
                        try {
                            const va_check = await check_output('vainfo', ['-a', '--display', 'drm', '--device', render_devices[j]])

                            if (va_check.includes('VAEntrypointEncSlice')) {
                                dri_to_use = render_devices[j]
                                break
                            }
                        } catch {

                        }
                    }

                    if (!dri_to_use) throw new Error("vaapi is not available");                                        

                    args.push("-hwaccel")
                    args.push("vaapi")
                    args.push("-hwaccel_device")
                    args.push(dri_to_use)
                    args.push("-hwaccel_output_format")
                    args.push("vaapi")
                    args.push("-i")
                    args.push(source)
                }

                const INTERP_ALGO_TO_VAAPI = {
                    0: 0,
                    1: 256,
                    2: 512,
                    3: 768
                }

                args.push("-map")
                args.push("0:v:0")
                if (audio) {
                    args.push("-map")
                    args.push("0:a:0")
                }
                if (audio) {
                    stream_map += `v:${i},a:${i},name:${(i+1).toString().padStart(2, "0")}`
                } else {
                    stream_map += `v:${i},name:${(i+1).toString().padStart(2, "0")}`
                } 

                args.push(`-c:v:${i}`)
                args.push("h264_vaapi")
                args.push(`-filter:v:${i}`)
                args.push(`format=nv12|vaapi,hwupload,deinterlace_vaapi,scale_vaapi=${rendition.width}:${rendition.height}:mode=${INTERP_ALGO_TO_VAAPI[rendition.interp_algo]},setsar=1`)
                args.push(`-compression_level:v:${i}`)
                args.push(rendition.speed)
            } else if (rendition.hwaccel == "nvenc") {
                if (!is_start) {
                    is_start = true
                    args.push("-hwaccel")
                    args.push("cuda")
                    args.push("-hwaccel_output_format")
                    args.push("cuda")
                    args.push("-i")
                    args.push(source)
                }

                args.push("-map")
                args.push("0:v:0")
                if (audio) {
                    args.push("-map")
                    args.push("0:a:0")
                }
                if (audio) {
                    stream_map += `v:${i},a:${i},name:${(i+1).toString().padStart(2, "0")}`
                } else {
                    stream_map += `v:${i},name:${(i+1).toString().padStart(2, "0")}`
                }            

                args.push(`-c:v:${i}`)
                args.push("h264_nvenc")
                args.push(`-filter:v:${i}`)
                args.push(`hwupload,yadif_cuda,scale_cuda=${rendition.width}:${rendition.height}:interp_algo=${rendition.interp_algo},setsar=1`)
                args.push(`-preset:v:${i}`)
                args.push(`p${rendition.speed}`)
            }
            
            args.push(`-profile:v:${i}`)
            args.push(rendition.profile)
            args.push(`-b:v:${i}`)
            args.push(rendition.video_bitrate)
            args.push(`-maxrate:v:${i}`)
            args.push(rendition.video_bitrate)
            args.push(`-bufsize:v:${i}`)
            args.push(rendition.bufsize)
            args.push(`-bf:v:${i}`)
            args.push(rendition.bf)
            args.push(`-flags:v:${i}`)
            args.push("+cgop")
            args.push(`-g:v:${i}`)
            args.push(Math.round(video.fps*2))
            args.push(`-keyint_min:v:${i}`)
            args.push(Math.round(video.fps*2))
            if (audio) {
                args.push(`-c:a:${i}`)
                args.push(rendition.audio_codec)
                args.push(`-b:a:${i}`)
                args.push(rendition.audio_bitrate)
                args.push(`-profile:a:${i}`)
                args.push("aac_"+rendition.audio_profile)
            }
        }

        args.push("-var_stream_map")
        args.push(stream_map)

        args.push("-hls_time")
        args.push(hls_settings.duration)
        args.push("-hls_list_size")
        args.push(hls_settings.list_size)
        args.push("-hls_delete_threshold")
        args.push(hls_settings.unreferenced_segments)

        args.push("-master_pl_name")
        args.push("index.m3u8")
        /*
        args.push("-master_pl_publish_rate")
        args.push(10)
        */

        /*
        args.push("-hls_flags")
        args.push("+delete_segments+omit_endlist+append_list+discont_start+program_date_time+second_level_segment_index")
        args.push("-strftime")
        args.push(1)
        args.push("-hls_segment_filename")
        args.push(output+"/%Y%m%dT%H%M%S-%v-%%01d.ts")
        args.push(output+"%v.m3u8")

        return args
        // main -b:v 600k -maxrate:v 600k -bufsize:v 1M
        */
       throw new Error("Not implemented.")
    }
}