const cp = require("child_process")
const args = require("process").argv
const config = require("../../config.json")

var app;

process.stdin.on("close", () => {
    process.exit(0)
})

const startProcess = () => {
    process.stdin.read()
    app = cp.spawn(config.ffmpeg, ["-loglevel", "error", "-copyts", "-i", "-", "-map", "0:v:0", "-map", "0:a:0", "-c", "copy", "-copyinkf", "-f", "mpegts", args[2]], {stdio: "inherit"})

    app.on("exit", () => {        
        process.stdin.read()
        setTimeout(()=>process.stdin.read(), 1000)
        setTimeout(startProcess, 2000)
    })        
}

startProcess()
