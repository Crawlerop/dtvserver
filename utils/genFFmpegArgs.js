const check_output = require("./check_output")
const glob = require("glob")
const config = require("../config.json")
const COPYTS_ASYNC = true

const _globAsync = (pattern) => {
    return new Promise((res, rej) => {
        glob(pattern,(err, list) => {
            if (err) return rej(err)
            return res(list)
        })
    })
}

const NV_HW_DECODER = config.nvenc_use_nvdec
const VSYNC_MODE = config.vsync
const ASYNC_MODE = config.async
const HW_FRAMES = config.use_cuvid ? "0" : "8"
const HW_SURFACES = "8"
const COPY_TS = config.use_copyts

module.exports = {
    genSingle: async (source, renditions, stream, output, hls_settings, video_id=-1, audio_id=-1, audio_filters="", escape_filters=false, watermark="", NVDEC_USE_SCALE=config.nvdec_use_scale, want_nvdec=true) => {
        const WIDESCREEN = (640/360)
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

        if (renditions[0].hwaccel !== "none") {
            args.push("-threads")
            args.push("1")
        }

        /*
        args.push("-use_wallclock_as_timestamps")
        args.push("1")
        */
        
        args.push("-nostdin")

        let fps = video.fps
        if (fps > 30) fps /= 2

        if (watermark) {
            var filter_complex = ""
            var temp_args = []
            for (var i =0; i<renditions.length; i++) {
                temp_args = []

                const rendition = renditions[i]
                var supports_watermark = false

                if (!is_start && rendition.hwaccel && HW_FRAMES > 0) {
                    args.push("-extra_hw_frames")
                    args.push(HW_FRAMES)
                }

                if (rendition.hwaccel == "vaapi") {
                    const INTERP_ALGO_TO_VAAPI = {
                        0: 0,
                        1: 256,
                        2: 512,
                        3: 768
                    }

                    if (!is_start) {
                        is_start = true            
                        const render_devices = await _globAsync("/dev/dri/render*")
                                    
                        for (var j =0; j<render_devices.length; j++) {
                            try {
                                const va_check = await check_output('vainfo', ['-a', '--display', 'drm', '--device', render_devices[j]])

                                if (va_check.includes('VAEntrypointEncSlice')) {
                                    dri_to_use = render_devices[j]
                                    try {
                                        await check_output(config.ffmpeg, ['-loglevel', 'error', '-hwaccel', 'vaapi', '-vaapi_device', `${render_devices[j]}`, '-f', 'lavfi', '-i', 'testsrc', '-f', 'lavfi', '-i', 'testsrc', '-filter_complex', '[0:v]format=nv12,hwupload[a];[1:v]format=nv12,hwupload[b];[a][b]overlay_vaapi', '-vcodec', 'h264_vaapi', '-f', 'null', '-frames', '1', '-'])
                                        supports_overlay = true
                                    } catch (e) {}
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
                        args.push("nv12")
                        /*
                        if (video.codec === "h264") {
                            args.push(`-c:v:${i}`)
                            args.push("h264_vaapi")
                        } else if (video.codec === "mpeg2video") {
                            args.push(`-c:v:${i}`)
                            args.push("h264_vaapi")
                        }
                        */

                        if (COPY_TS) {
                            args.push("-copyts")
                            args.push("-frame_drop_threshold")
                            args.push("0")

                            //args.push("-r")
                            //args.push(video.fps)
                            if (COPYTS_ASYNC) {                                
                                args.push("-vsync")
                                args.push("0")
                            }
                            //args.push("-start_at_zero")
                        } else if (!config.disable_sync) {
                            if (VSYNC_MODE == 1) {
                                args.push("-r")
                                args.push(video.fps)
                            }

                            args.push("-async")
                            args.push(ASYNC_MODE.replace(/\(fps\)/g, Math.round(video.fps)).replace(/\(sample_rate\)/g, Math.round(audio.sample_rate)))

                            args.push("-vsync")
                            args.push(VSYNC_MODE)
                        }

                        /*
                        args.push("-r")
                        args.push('1')
                        */

                        args.push("-i")
                        args.push(source)

                        if (!supports_watermark) {
                            args.push("-stream_loop")
                            args.push("-1")
                        }

                        args.push("-i")
                        args.push(watermark)

                        if (video_id != -1) {
                            filter_complex += `[0:v:#${video_id}]`
                        } else {
                            filter_complex += `[0:v:0]`
                        }  

                        if (supports_watermark) {
                            filter_complex += `format=yuv420p|vaapi,hwupload,deinterlace_vaapi,scale_vaapi=${Math.floor(video.height*WIDESCREEN)}:${video.height}:mode=256[a];[1:v:0]format=yuva420p|vaapi,hwupload[b];[a][b]overlay_vaapi=x=16:y=H-h-16,`
                        } else {
                            filter_complex += `format=yuv420p,yadif,scale=${Math.floor(video.height*WIDESCREEN)}:${video.height}:flags=neighbor[a];[1:v:0]format=yuva420p[b];[a][b]overlay=shortest=1:x=16:y=H-h-16,format=nv12|vaapi,hwupload,`
                        }

                        filter_complex += `fps=${fps}${COPY_TS ? "" : ":start_time=0:round=near"},split=${renditions.length}`
                        for (let p = 0; p<renditions.length; p++) {
                            filter_complex += `[temp${p}]` 
                        }
                        filter_complex += ";"

                        for (let p = 0; p<renditions.length; p++) {
                            filter_complex += `[temp${p}]scale_vaapi=${Math.min(Math.floor(video.height*WIDESCREEN), renditions[p].width)}:${Math.min(video.height, renditions[p].height)}:mode=${INTERP_ALGO_TO_VAAPI[renditions[p].interp_algo]},setsar=1[out${p}];` 
                        }

                        if (audio) {
                            if (audio_id != -1) {
                                filter_complex += `[0:a:#${audio_id}]`
                            } else {
                                filter_complex += "[0:a:0]"
                            }

                            if (audio_filters) {
                                filter_complex += audio_filters
                            } else {
                                filter_complex += 'anull'
                            }
    
                            filter_complex += `,asplit=${renditions.length}`
                            for (let p = 0; p<renditions.length; p++) {
                                filter_complex += `[audio${p}]`
                            }
                        } else {
                            filter_complex = filter_complex.slice(0,-1)
                        }

                        args.push("-filter_complex")
                        if (escape_filters) {
                            args.push(`"${filter_complex}"`)
                        } else {
                            args.push(filter_complex)
                        }
                    }
                    // console.log(filter_complex)
                
                    temp_args.push("-map")
                    temp_args.push(`[out${i}]`)
                    
                    if (audio) {
                        temp_args.push("-map")
                        temp_args.push(`[audio${i}]`)
                    }

                    if (audio) {
                        stream_map += `v:${i},a:${i},name:${(i+1).toString().padStart(2, "0")} `
                    } else {
                        stream_map += `v:${i},name:${(i+1).toString().padStart(2, "0")} `
                    } 

                    temp_args.push(`-map_metadata`)
                    temp_args.push("-1")
                    temp_args.push(`-c:v:${i}`)
                    temp_args.push("h264_vaapi")

                    /*
                    args.push(`-filter:v:${i}`)
                    if (escape_filters) {
                        args.push(`"format=nv12|vaapi,hwupload,deinterlace_vaapi,scale_vaapi=${rendition.width}:${rendition.height}:mode=${INTERP_ALGO_TO_VAAPI[rendition.interp_algo]},setsar=1"`)
                    } else {
                        args.push(`format=nv12|vaapi,hwupload,deinterlace_vaapi,scale_vaapi=${rendition.width}:${rendition.height}:mode=${INTERP_ALGO_TO_VAAPI[rendition.interp_algo]},setsar=1`)
                    }
                    */

                    temp_args.push(`-compression_level:v:${i}`)
                    temp_args.push(rendition.speed)

                    temp_args.push(`-rc_mode:v:${i}`)
                    temp_args.push('2')
                } else if (rendition.hwaccel == "nvenc") {
                    if (!is_start) {
                        is_start = true

                        if (NV_HW_DECODER && want_nvdec) {
                            args.push("-hwaccel")
                            args.push("cuda")
                            args.push("-hwaccel_output_format")
                            args.push("nv12")

                            if (video.fps == fps && config.use_cuvid) {
                                if (video.codec === "h264") { // 1080i
                                    args.push(`-c:v`)
                                    args.push("h264_cuvid")
                                } else if (video.codec === "mpeg4") {
                                    args.push(`-c:v`)
                                    args.push("mpeg4_cuvid")
                                } else if (video.codec === "mpeg2video") { // 576i
                                    args.push(`-c:v`)
                                    args.push("mpeg2_cuvid")
                                } else if (video.codec === "mpeg1video") {
                                    args.push(`-c:v`)
                                    args.push("mpeg1_cuvid")
                                } else if (video.codec === "hevc") { // 2160p
                                    args.push(`-c:v`)
                                    args.push("hevc_cuvid")
                                }                            

                                if (NVDEC_USE_SCALE) {
                                    args.push("-resize")
                                    args.push(`${rendition.width}x${rendition.height}`)
                                }

                                args.push("-surfaces")
                                args.push(HW_SURFACES)
                                args.push("-deint")
                                args.push("1")
                                args.push("-drop_second_field")
                                args.push("1")
                            } else {
                                NVDEC_USE_SCALE = false
                            }
                        }

                        if (COPY_TS) {
                            args.push("-copyts")
                            args.push("-frame_drop_threshold")
                            args.push("0")

                            //args.push("-r")
                            //args.push(video.fps)
                            if (COPYTS_ASYNC) {
                                args.push("-vsync")
                                args.push("0")
                            }
                        } else if (!config.disable_sync) {
                            if (VSYNC_MODE == 1) {
                                args.push("-r")
                                args.push(video.fps)
                            }

                            args.push("-async")
                            args.push(ASYNC_MODE.replace(/\(fps\)/g, Math.round(video.fps)).replace(/\(sample_rate\)/g, Math.round(audio.sample_rate)))

                            args.push("-vsync")
                            args.push(VSYNC_MODE)
                        }

                        /*
                        args.push("-r")
                        args.push('1')
                        */

                        args.push("-i")
                        args.push(source)

                        args.push("-stream_loop")
                        args.push("-1")

                        args.push("-i")
                        args.push(watermark)

                        if (video_id != -1) {
                            filter_complex += `[0:v:#${video_id}]`
                        } else {
                            filter_complex += `[0:v:0]`
                        }  

                        filter_complex += `format=yuv420p,hwupload_cuda,yadif_cuda,scale_cuda=${Math.floor(video.height*WIDESCREEN)}:${video.height}:interp_algo=1[a];[1:v:0]format=yuva420p,hwupload_cuda[b];[a][b]overlay_cuda=shortest=1:x=16:y=H-h-16,`

                        filter_complex += `fps=${fps}${COPY_TS ? "" : ":start_time=0:round=near"},split=${renditions.length}`
                        for (let p = 0; p<renditions.length; p++) {
                            filter_complex += `[temp${p}]` 
                        }
                        filter_complex += ";"

                        for (let p = 0; p<renditions.length; p++) {
                            filter_complex += `[temp${p}]scale_cuda=${Math.min(Math.floor(video.height*WIDESCREEN), renditions[p].width)}:${Math.min(video.height, renditions[p].height)}:interp_algo=${renditions[p].interp_algo},setsar=1[out${p}];`  
                        }

                        if (audio) {
                            if (audio_id != -1) {
                                filter_complex += `[0:a:#${audio_id}]`
                            } else {
                                filter_complex += "[0:a:0]"
                            }

                            if (audio_filters) {
                                filter_complex += audio_filters
                            } else {
                                filter_complex += 'anull'
                            }
    
                            filter_complex += `,asplit=${renditions.length}`
                            for (let p = 0; p<renditions.length; p++) {
                                filter_complex += `[audio${p}]`
                            }
                        } else {
                            filter_complex = filter_complex.slice(0,-1)
                        }

                        args.push("-filter_complex")
                        if (escape_filters) {
                            args.push(`"${filter_complex}"`)
                        } else {
                            args.push(filter_complex)
                        }
                    }
                    // console.log(filter_complex)

                    temp_args.push("-map")
                    temp_args.push(`[out${i}]`)
                    
                    if (audio) {
                        temp_args.push("-map")
                        temp_args.push(`[audio${i}]`)
                    }
                    
                    if (audio) {
                        stream_map += `v:${i},a:${i},name:${(i+1).toString().padStart(2, "0")} `
                    } else {
                        stream_map += `v:${i},name:${(i+1).toString().padStart(2, "0")} `
                    }            

                    temp_args.push(`-map_metadata`)
                    temp_args.push("-1")
                    temp_args.push(`-c:v:${i}`)
                    temp_args.push("h264_nvenc")
                    /*
                    args.push(`-filter:v:${i}`)
                    if (escape_filters) {
                        args.push(`"hwupload_cuda,yadif_cuda,scale_cuda=${rendition.width}:${rendition.height}:interp_algo=${rendition.interp_algo},setsar=1"`)
                    } else {
                        args.push(`hwupload_cuda,yadif_cuda,scale_cuda=${rendition.width}:${rendition.height}:interp_algo=${rendition.interp_algo},setsar=1`)
                    }
                    */
                    temp_args.push(`-preset:v:${i}`)
                    temp_args.push(`p${rendition.speed}`)

                    temp_args.push(`-rc:v:${i}`)
                    temp_args.push("cbr")

                    /*
                    temp_args.push(`-tune:v:${i}`)
                    temp_args.push("ll")
                    */
                } else {
                    throw new Error("hwaccel not implemented yet")
                }
                
                args = args.concat(temp_args)
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

                /*
                if (fps != video.fps) {
                    args.push(`-r:v:${i}`)
                    args.push(`${fps}`)
                }
                */

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
                    if (rendition.bandwidth) {
                        args.push(`-cutoff:a:${i}`)
                        args.push(eval(rendition.bandwidth.replace(/\(ar\)/g, audio.sample_rate)))
                    }

                    /*
                    if (audio_filters) {
                        // console.log(audio_filters)
                        args.push(`-filter:a:${i}`)
                        if (escape_filters) {
                            args.push(`"${audio_filters}"`)
                        } else {
                            args.push(audio_filters)
                        }
                    }
                    */
                }
            }
        } else {
            for (var i =0; i<renditions.length; i++) {
                const rendition = renditions[i]

                if (!is_start && rendition.hwaccel && HW_FRAMES > 0) {
                    args.push("-extra_hw_frames")
                    args.push(HW_FRAMES)
                }

                if (rendition.hwaccel == "vaapi") {
                    const INTERP_ALGO_TO_VAAPI = {
                        0: 0,
                        1: 256,
                        2: 512,
                        3: 768
                    }

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
                        args.push("nv12")
                        /*
                        if (video.codec === "h264") {
                            args.push(`-c:v:${i}`)
                            args.push("h264_vaapi")
                        } else if (video.codec === "mpeg2video") {
                            args.push(`-c:v:${i}`)
                            args.push("h264_vaapi")
                        }
                        */

                        if (COPY_TS) {
                            args.push("-copyts")
                            args.push("-frame_drop_threshold")
                            args.push("0")

                            //args.push("-r")
                            //args.push(video.fps)
                            if (COPYTS_ASYNC) {
                                args.push("-vsync")
                                args.push("0")
                            }
                        } else if (!config.disable_sync) {
                            if (VSYNC_MODE == 1) {
                                args.push("-r")
                                args.push(video.fps)
                            }

                            args.push("-async")
                            args.push(ASYNC_MODE.replace(/\(fps\)/g, Math.round(video.fps)).replace(/\(sample_rate\)/g, Math.round(audio.sample_rate)))

                            args.push("-vsync")
                            args.push(VSYNC_MODE)
                        }                      
    
                        /*
                        args.push("-r")
                        args.push('1')
                        */

                        args.push("-i")
                        args.push(source)

                        var filter_complex = ""

                        if (video_id != -1) {
                            filter_complex += `[0:v:#${video_id}]`
                        } else {
                            filter_complex += "[0:v:0]"
                        }
                        
                        filter_complex += `format=nv12|vaapi,hwupload,deinterlace_vaapi,split=${renditions.length}`
                        for (let rend_id = 0; rend_id<renditions.length; rend_id++) {
                            filter_complex += `[a${rend_id}]`
                        }

                        filter_complex += ";"

                        for (let rend_id = 0; rend_id<renditions.length; rend_id++) {
                            filter_complex += `[a${rend_id}]`
                            if (renditions[rend_id].height !== video.height || video.interlace !== 'progressive') {
                                filter_complex += `scale_vaapi=${Math.min(Math.floor(video.height*WIDESCREEN), renditions[rend_id].width)}:${Math.min(video.height, renditions[rend_id].height)}:mode=${INTERP_ALGO_TO_VAAPI[renditions[rend_id].interp_algo]},setsar=1,fps=${fps}${COPY_TS ? "" : ":start_time=0:round=near"}[p${rend_id}]`
                            } else {
                                filter_complex += `setsar=1,fps=${fps}${COPY_TS ? "" : ":start_time=0:round=near"}[p${rend_id}]`
                            }
                            if (rend_id < renditions.length-1) filter_complex += ";"
                        }

                        //console.log(filter_complex)
                        args.push("-filter_complex")
                        if (escape_filters) {
                            args.push(`"${filter_complex}"`)
                        } else {
                            args.push(filter_complex)
                        }
                    }
                
                    args.push("-map")
                    /*
                    if (video_id != -1) {
                        args.push(`0:v:#${video_id}`)
                    } else {
                        args.push("0:v:0")
                    } 
                    */
                    args.push(`[p${i}]`)
                    
                    if (audio) {
                        args.push("-map")
                        if (audio_id != -1) {
                            args.push(`0:a:#${audio_id}`)
                        } else {
                            args.push("0:a:0")
                        }
                    }
                    if (audio) {
                        stream_map += `v:${i},a:${i},name:${(i+1).toString().padStart(2, "0")} `
                    } else {
                        stream_map += `v:${i},name:${(i+1).toString().padStart(2, "0")} `
                    } 
    
                    args.push(`-map_metadata`)
                    args.push("-1")
                    args.push(`-c:v:${i}`)
                    args.push("h264_vaapi")
                    /*
                    args.push(`-filter:v:${i}`)
                    if (escape_filters) {
                        args.push(`"format=nv12|vaapi,hwupload,deinterlace_vaapi,scale_vaapi=${Math.min(Math.floor(video.height*WIDESCREEN), rendition.width)}:${Math.min(video.height, rendition.height)}:mode=${INTERP_ALGO_TO_VAAPI[rendition.interp_algo]},setsar=1,fps=${fps}"`)
                    } else {
                        args.push(`format=nv12|vaapi,hwupload,deinterlace_vaapi,scale_vaapi=${Math.min(Math.floor(video.height*WIDESCREEN), rendition.width)}:${Math.min(video.height, rendition.height)}:mode=${INTERP_ALGO_TO_VAAPI[rendition.interp_algo]},setsar=1,fps=${fps}`)
                    }
                    */
                    args.push(`-compression_level:v:${i}`)
                    args.push(rendition.speed)

                    args.push(`-rc_mode:v:${i}`)
                    args.push('2')
                } else if (rendition.hwaccel == "nvenc") {
                    if (!is_start) {
                        is_start = true

                        if (NV_HW_DECODER && want_nvdec) {
                            args.push("-hwaccel")
                            args.push("cuda")
                            args.push("-hwaccel_output_format")
                            args.push("cuda")
        
                            if (video.fps == fps && config.use_cuvid) {
                                if (video.codec === "h264") { // 1080i
                                    args.push(`-c:v`)
                                    args.push("h264_cuvid")
                                } else if (video.codec === "mpeg4") {
                                    args.push(`-c:v`)
                                    args.push("mpeg4_cuvid")
                                } else if (video.codec === "mpeg2video") { // 576i
                                    args.push(`-c:v`)
                                    args.push("mpeg2_cuvid")
                                } else if (video.codec === "mpeg1video") {
                                    args.push(`-c:v`)
                                    args.push("mpeg1_cuvid")
                                } else if (video.codec === "hevc") { // 2160p
                                    args.push(`-c:v`)
                                    args.push("hevc_cuvid")
                                }                        

                                if (NVDEC_USE_SCALE) {
                                    args.push("-resize")
                                    args.push(`${rendition.width}x${rendition.height}`)
                                }

                                args.push("-surfaces")
                                args.push(HW_SURFACES)
                                args.push("-deint")
                                args.push("1")
                                args.push("-drop_second_field")
                                args.push("1")
                            } else {
                                NVDEC_USE_SCALE = false
                            }
                        }
    
                        if (COPY_TS) {
                            args.push("-copyts")
                            args.push("-frame_drop_threshold")
                            args.push("0")

                            //args.push("-r")
                            //args.push(video.fps)
                            if (COPYTS_ASYNC) {
                                args.push("-vsync")
                                args.push("0")
                            }
                        } else if (!config.disable_sync) {
                            if (VSYNC_MODE == 1) {
                                args.push("-r")
                                args.push(video.fps)
                            }

                            args.push("-async")
                            args.push(ASYNC_MODE.replace(/\(fps\)/g, Math.round(video.fps)).replace(/\(sample_rate\)/g, Math.round(audio.sample_rate)))

                            args.push("-vsync")
                            args.push(VSYNC_MODE)
                        }
    
                        /*
                        args.push("-r")
                        args.push('1')
                        */

                        args.push("-i")
                        args.push(source)

                        var filter_complex = ""

                        if (video_id != -1) {
                            filter_complex += `[0:v:#${video_id}]`
                        } else {
                            filter_complex += "[0:v:0]"
                        }
                        
                        if (!(NV_HW_DECODER && want_nvdec)) {
                            filter_complex += `hwupload_cuda,yadif_cuda,split=${renditions.length}`
                            for (let rend_id = 0; rend_id<renditions.length; rend_id++) {
                                filter_complex += `[a${rend_id}]`
                            }

                            filter_complex += ";"

                            for (let rend_id = 0; rend_id<renditions.length; rend_id++) {
                                filter_complex += `[a${rend_id}]`
                                if (renditions[rend_id].height !== video.height || video.interlace !== 'progressive') {
                                    filter_complex += `scale_cuda=${Math.min(Math.floor(video.height*WIDESCREEN), renditions[rend_id].width)}:${Math.min(video.height, renditions[rend_id].height)}:interp_algo=${renditions[rend_id].interp_algo},setsar=1,fps=${fps}${COPY_TS ? "" : ":start_time=0:round=near"}[p${rend_id}]`
                                } else {
                                    filter_complex += `scale_cuda=${video.width}:${video.height}:interp_algo=${renditions[rend_id].interp_algo},setsar=1,fps=${fps}${COPY_TS ? "" : ":start_time=0:round=near"}[p${rend_id}]`
                                }
                                if (rend_id < renditions.length-1) filter_complex += ";"
                            }
                        } else {
                            filter_complex += `setsar=1${!(video.fps == fps && config.use_cuvid) ? ",yadif_cuda" : ""},fps=${fps}${COPY_TS ? "" : ":start_time=0:round=near"},split=${renditions.length}`
                            for (let rend_id = 0; rend_id<renditions.length; rend_id++) {
                                filter_complex += `[a${rend_id}]`
                            }

                            filter_complex += ";"

                            for (let rend_id = 0; rend_id<renditions.length; rend_id++) {
                                filter_complex += `[a${rend_id}]`
                                //if (renditions[rend_id].height !== video.height || video.interlace !== 'progressive') {
                                if (!NVDEC_USE_SCALE || !(video.fps == fps && config.use_cuvid) || rend_id > 0) {
                                    filter_complex += `scale_cuda=${Math.min(Math.floor(video.height*WIDESCREEN), renditions[rend_id].width)}:${Math.min(video.height, renditions[rend_id].height)}:interp_algo=${renditions[rend_id].interp_algo}[p${rend_id}]`
                                } else {
                                    //filter_complex += `setsar=1,fps=${fps}[p${rend_id}]`
                                    filter_complex += `null[p${rend_id}]` // incase of resolution change, there's no way to autoscale.
                                }
                                if (rend_id < renditions.length-1) filter_complex += ";"
                            }
                        }

                        //console.log(filter_complex)
                        args.push("-filter_complex")
                        if (escape_filters) {
                            args.push(`"${filter_complex}"`)
                        } else {
                            args.push(filter_complex)
                        }
                    }
                    
                    args.push("-map")
                    /*
                    if (video_id != -1) {
                        args.push(`0:v:#${video_id}`)
                    } else {
                        args.push("0:v:0")
                    } 
                    */  
                    
                    args.push(`[p${i}]`)
                    
                    if (audio) {
                        args.push("-map")
                        if (audio_id != -1) {
                            args.push(`0:a:#${audio_id}`)
                        } else {
                            args.push("0:a:0")
                        }
                    }
                    if (audio) {
                        stream_map += `v:${i},a:${i},name:${(i+1).toString().padStart(2, "0")} `
                    } else {
                        stream_map += `v:${i},name:${(i+1).toString().padStart(2, "0")} `
                    }            
    
                    args.push(`-map_metadata`)
                    args.push("-1")

                    /* Disable autoscale */
                    // args.push(`-autoscale:v:${i}`)
                    // args.push("0")
                    
                    args.push(`-c:v:${i}`)
                    args.push("h264_nvenc")

                    /*
                    if (rendition.height !== video.height || video.interlace !== 'progressive') {
                        args.push(`-filter:v:${i}`)
                        if (escape_filters) {
                            args.push(`"hwupload_cuda,yadif_cuda,scale_cuda=${Math.min(Math.floor(video.height*WIDESCREEN), rendition.width)}:${Math.min(video.height, rendition.height)}:interp_algo=${rendition.interp_algo},setsar=1,fps=${fps}"`)
                        } else {
                            args.push(`hwupload_cuda,yadif_cuda,scale_cuda=${Math.min(Math.floor(video.height*WIDESCREEN), rendition.width)}:${Math.min(video.height, rendition.height)}:interp_algo=${rendition.interp_algo},setsar=1,fps=${fps}`)
                        }
                    } else {
                        args.push(`-filter:v:${i}`)
                        if (escape_filters) {
                            args.push(`"setsar=1,fps=${fps}"`)
                        } else {
                            args.push(`setsar=1,fps=${fps}`)
                        }
                    }
                    */

                    args.push(`-preset:v:${i}`)
                    args.push(`p${rendition.speed}`)
    
                    args.push(`-rc:v:${i}`)
                    args.push("cbr")

                    if (config.ll_mode) {
                        args.push(`-tune:v:${i}`)
                        args.push("ull")
                        
                        args.push(`-delay:v:${i}`)
                        args.push("0")
                    }

                    args.push(`-b_ref_mode:v:${i}`)
                    args.push("middle")

                    args.push("-a53cc")
                    args.push("false")

                    args.push(`-surfaces:v:${i}`)
                    args.push(HW_SURFACES)

                    if (config.lookahead > 0) {
                        args.push(`-rc-lookahead:v:${i}`)
                        args.push(`${config.lookahead}`)
                    }
                    
                } else if (rendition.hwaccel == "none") {
                    if (!is_start) {
                        is_start = true
                            
                        if (COPY_TS) {
                            args.push("-copyts")
                            args.push("-frame_drop_threshold")
                            args.push("0")

                            //args.push("-r")
                            //args.push(video.fps)
                            if (COPYTS_ASYNC) {
                                args.push("-vsync")
                                args.push("0")
                            }
                        } else if (!config.disable_sync) {
                            if (VSYNC_MODE == 1) {
                                args.push("-r")
                                args.push(video.fps)
                            }

                            args.push("-async")
                            args.push(ASYNC_MODE.replace(/\(fps\)/g, Math.round(video.fps)).replace(/\(sample_rate\)/g, Math.round(audio.sample_rate)))

                            args.push("-vsync")
                            args.push(VSYNC_MODE)
                        }
    
                        /*
                        args.push("-r")
                        args.push('1')
                        */

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
                        stream_map += `v:${i},a:${i},name:${(i+1).toString().padStart(2, "0")} `
                    } else {
                        stream_map += `v:${i},name:${(i+1).toString().padStart(2, "0")} `
                    }            
    
                    args.push(`-map_metadata`)
                    args.push("-1")
                    args.push(`-c:v:${i}`)
                    args.push("libx264")

                    const INTERP_ALGO_TO_SCALE = {
                        1: "neighbor",
                        2: "bilinear",
                        3: "bicubic",
                        4: "lanczos"
                    }

                    const interp_algo = INTERP_ALGO_TO_SCALE[rendition.interp_algo]

                    args.push(`-filter:v:${i}`)
                    if (escape_filters) {
                        args.push(`"yadif,scale=${Math.min(Math.floor(video.height*WIDESCREEN), rendition.width)}:${Math.min(video.height, rendition.height)}:flags=${interp_algo},setsar=1,fps=${fps}${COPY_TS ? "" : ":start_time=0:round=near"}"`)
                    } else {
                        args.push(`yadif,scale=${Math.min(Math.floor(video.height*WIDESCREEN), rendition.width)}:${Math.min(video.height, rendition.height)}:flags=${interp_algo},setsar=1,fps=${fps}${COPY_TS ? "" : ":start_time=0:round=near"}`)
                    }
                    

                    args.push(`-preset:v:${i}`)
                    args.push(`${rendition.speed}`)
    
                    args.push(`-x264-params`)
                    args.push("nal-hrd=cbr")
    
                    /*
                    args.push(`-tune:v:${i}`)
                    args.push("ll")
                    */
                } else {
                    throw new Error("hwaccel not implemented yet")
                }
                
                args.push(`-profile:v:${i}`)
                args.push(rendition.profile)
                args.push(`-b:v:${i}`)
                args.push(rendition.video_bitrate)
                args.push(`-minrate:v:${i}`)
                args.push(rendition.video_bitrate)
                args.push(`-maxrate:v:${i}`)
                args.push(rendition.video_bitrate)
                args.push(`-bufsize:v:${i}`)
                args.push(rendition.bufsize)
                args.push(`-bf:v:${i}`)
                args.push(rendition.bf)
                args.push(`-flags:v:${i}`)
                args.push("+cgop")
    
                /*
                if (fps != video.fps) {
                    args.push(`-r:v:${i}`)
                    args.push(`${fps}`)
                }
                */
    
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
                    if (rendition.bandwidth) {
                        args.push(`-cutoff:a:${i}`)
                        args.push(eval(rendition.bandwidth.replace(/\(ar\)/g, audio.sample_rate)))
                    }
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
        }

        args.push("-var_stream_map")

        if (escape_filters) {
            args.push(`"${stream_map}"`)
        } else {
            args.push(stream_map)
        }

        args.push("-muxdelay")
        args.push("0")
        args.push("-muxpreload")
        args.push("0")

        if (!config.disable_sync) {
            args.push("-avoid_negative_ts")
            args.push("make_zero")
        }

        args.push("-hls_time")
        args.push(hls_settings.duration)
        args.push("-hls_list_size")
        args.push(hls_settings.list_size)
        args.push("-hls_delete_threshold")
        args.push(hls_settings.unreferenced_segments)

        args.push("-master_pl_name")
        args.push("index.m3u8")
        
        args.push("-master_pl_publish_rate")
        args.push(5)
        
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

    genSinglePass: async (source, output, hls_settings, escape_filters) => {
        var args = [];
        const COPYTS_PASS = true

        args.push("-threads")
        args.push("1")

        if (COPYTS_PASS) {
            args.push("-copyts")
            args.push("-frame_drop_threshold")
            args.push("0")
        }
        //args.push("-start_at_zero")

        args.push("-nostdin")

        args.push("-i")
        args.push(source)

        args.push(`-map_metadata`)
        args.push("-1")

        args.push(`-map`)
        args.push("0:v?")

        args.push(`-map`)
        args.push("0:a?")

        args.push(`-c:v`)
        args.push("copy")

        args.push(`-c:a`)
        args.push("copy")

        const stream_map = 'v:0,a:0,name:01'
        args.push("-var_stream_map")

        if (escape_filters) {
            args.push(`"${stream_map}"`)
        } else {
            args.push(stream_map)
        }

        args.push("-muxdelay")
        args.push("0")
        args.push("-muxpreload")
        args.push("0")

        if (COPYTS_PASS) {
            args.push("-avoid_negative_ts")
            args.push("make_zero")
        }

        args.push("-hls_time")
        args.push(hls_settings.duration)
        args.push("-hls_list_size")
        args.push(hls_settings.list_size)
        args.push("-hls_delete_threshold")
        args.push(hls_settings.unreferenced_segments)

        args.push("-master_pl_name")
        args.push("index.m3u8")
        
        args.push("-master_pl_publish_rate")
        args.push(5)
        
        args.push("-hls_flags")
        args.push("+delete_segments+omit_endlist+append_list+discont_start+program_date_time+second_level_segment_index+temp_file+split_by_time")
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
