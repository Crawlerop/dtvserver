const cp = require("child_process")
const config = require("./config.json")
const path = require("path")

const cur_proc = cp.fork(path.join(__dirname, "/scripts/dtv.js"))
cur_proc.on("message", (e) => {
    console.log(e)
})

cur_proc.send({ffmpeg: config.ffmpeg, tuner: 0, frequency: 610, channels: [
    {
        name: "Service 2",
        id: "test2",
        is_hd: false,
        video: {
            width: 720,
            height: 576,
            fps: 25,
            id: 0xcd
        },
        audio: {
            sample_rate: 48000,
            channels: 2,
            id: 0x131
        }
    },
    {
        name: "Service 2",
        id: "test3",
        is_hd: false,
        video: {
            width: 720,
            height: 576,
            fps: 25,
            id: 0xcd
        },
        audio: {
            sample_rate: 48000,
            channels: 2,
            id: 0x131
        }
    }
], output_path: config.streams_path.replace(/\(pathname\)/g, __dirname), renditions: config.renditions, multiple_renditions: config.multiple_renditions, hls_settings: config.hls_settings, dtv_use_fork: config.dtv_use_fork})