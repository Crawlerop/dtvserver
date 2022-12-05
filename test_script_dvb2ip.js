const cp = require("child_process")
const config = require("./config.json")
const path = require("path")

const cur_proc = cp.fork(path.join(__dirname, "/scripts/dvb2ip.js"))
cur_proc.on("message", (e) => {
    console.log(e)
})

cur_proc.send({ffmpeg: config.ffmpeg, src: "192.168.0.100", src_id: "106", output_path: config.streams_path.replace(/\(pathname\)/g, __dirname)+"/test/", renditions: config.renditions, multiple_renditions: config.multiple_renditions, hls_settings: config.hls_settings})