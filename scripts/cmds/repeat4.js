const cp = require("child_process")
const { start } = require("repl")
const args = require("process").argv
const os = require("os")

process.stdin.on("close", () => {
    process.exit(0)
})

const TIMEOUT_DUR = 30000
var TIMEOUT_VAL = -1

var LAST_FRAME = -1
var app;

setInterval(() => {
    if (TIMEOUT_VAL !== -1 && (Date.now() > TIMEOUT_VAL)) {
        process.stderr.write(`Transcode stream was stalled for ${args[2]}\n`)
        app.kill("SIGKILL")
    }
}, 2000)

const startProcess = () => {
    //process.stderr.write(args.slice(3).join(" ")+"\n")
    app = cp.spawn(args[4], args.slice(5))

    app.on("exit", () => {
        process.stderr.write(`Restart transcode stream for channel ${args[2]}\n`)
        LAST_FRAME = -1
        TIMEOUT_VAL = -1

        setTimeout(startProcess, 2000)
        //startProcess()
    })

    app.stdin.on("error", ()=>{})
    app.stdout.on("error", ()=>{})

    process.stdin.pipe(app.stdin)
    app.stderr.on("data", (d) => {
        const lines = d.toString().split(os.EOL)
        for (let ln = 0; ln<lines.length; ln++) {
            if (lines[ln].length > 0) process.stderr.write(`${args[2]}: ${lines[ln]}${os.EOL}`)
        }
    })

    app.stdout.on("data", (d) => {
        const chunks = d.toString().replace(/\r/g, "").split("\n")
        for (let i = 0; i<chunks.length; i++) {
            if (chunks[i].length >= 0) {
                const key = chunks[i].split("=")[0]
                const val = chunks[i].split("=")[1]

                if (key === "frame") {
                    if (parseInt(val) !== LAST_FRAME) {
                        LAST_FRAME = parseInt(val)
                        TIMEOUT_VAL = Date.now() + TIMEOUT_DUR
                        //process.stderr.write(`Track stalled status\n`)
                    }
                } else if (key === "fps") {
                    if (parseFloat(val) < parseFloat(args[3])) {
                        console.log(`${args[2]} FPS: ${parseFloat(val)} < ${parseFloat(args[3])}`)
                    }
                    //
                }
            }
        }
    })
    //app.stdout.pipe(process.stdout)
}

startProcess()