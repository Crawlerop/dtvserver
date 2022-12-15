const cp = require("child_process")
const { start } = require("repl")
const args = require("process").argv

process.stdin.on("close", () => {
    process.exit(0)
})

const TIMEOUT_DUR = 30000
var TIMEOUT_VAL = -1

var LAST_FRAME = -1
var app;

var stream_name;

setInterval(() => {
    if (TIMEOUT_VAL !== -1 && (Date.now() > TIMEOUT_VAL)) {
        process.stderr.write(`Transcode stream was stalled for ${stream_name}\n`)
        app.kill("SIGKILL")
    }
}, 2000)

const startProcess = (cmd, args) => {
    //process.stderr.write(args.slice(3).join(" ")+"\n")    
    app = cp.spawn(cmd, args)

    app.on("exit", () => {
        process.stderr.write(`Restart transcode stream for channel ${stream_name}\n`)
        LAST_FRAME = -1
        TIMEOUT_VAL = -1

        setTimeout(() => {startProcess(cmd, args)}, 2000)
        //startProcess()
    })

    app.stdin.on("error", ()=>{})
    app.stdout.on("error", ()=>{})

    process.stdin.pipe(app.stdin)
    app.stderr.pipe(process.stderr)

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
                }
            }
        }
    })
    //app.stdout.pipe(process.stdout)
}

/*
process.once("message", (d) => {
    stream_name = d.name;
    startProcess(d.cmd_proc, d.cmd_args)
})
*/

process.stdin.once("data", (s) => {
    const d = JSON.parse(s)
    // console.log(d)
    stream_name = d.name;
    startProcess(d.cmd_proc, d.cmd_args)
})