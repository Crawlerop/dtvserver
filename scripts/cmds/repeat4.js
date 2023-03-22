const cp = require("child_process")
const args = require("process").argv
const os = require("os")
const config = require("../../config.json")
const fs = require("fs")

process.stdin.on("close", () => {
    process.exit(0)
})

const TIMEOUT_DUR = 30000
const STREAM_TIMEOUT_DUR = 60000

var TIMEOUT_VAL = -1
var STREAM_TIMEOUT_VAL = -1

var LAST_FRAME = -1
var LAST_OUT_TIME = -1

var app;
var DO_RESTART_STALL = config.stall_do_not_restart_mux.indexOf(`${args[5]}-${args[6]}`) === -1
var RESTART_STALL = false
var SPPID = 0;

var IS_COMPLETE_STALL = false;

var FRAME_TICK = false;
var TIMESTAMP_TICK = false;

setInterval(() => {
    if (TIMEOUT_VAL !== -1 && (Date.now() > TIMEOUT_VAL)) {
        process.stderr.write(`Transcode stream was stalled for ${args[2]}${os.EOL}`)
        app.kill("SIGKILL")
    }

    if (LAST_FRAME === -1) process.stderr.write(`${args[2]} : Pending${os.EOL}`)

    if (DO_RESTART_STALL && RESTART_STALL && STREAM_TIMEOUT_VAL !== -1 && (Date.now() > STREAM_TIMEOUT_VAL)) {
        process.stderr.write(`Stream is completely stalled for ${args[2]}${os.EOL}`)
        IS_COMPLETE_STALL = true
        setTimeout(() => {
            app.kill("SIGKILL")
            setTimeout(() => {
                //setTimeout(() => {
                    process.stdin.read()
                    process.stdin.destroy()
                    process.stderr.write(`Restarting this stream...${os.EOL}`)
                    
                    //process.kill(process.ppid, "SIGINT") // Kill TSP by itself
                    process.kill(SPPID, "SIGKILL")
                    process.kill(process.ppid, "SIGKILL")
                    process.kill(process.pid, "SIGKILL") // Kill this pid by itself
                //}, 500)                
            }, 1000)
        }, 2000) 
        //process.exit(1)
    }

    try {
        process.kill(SPPID, 0)
    } catch (e) {
        IS_COMPLETE_STALL = true
        setTimeout(() => {
            app.kill("SIGKILL")
        }, 2000) 
    }
}, 2000)

const startProcess = () => {
    //process.stderr.write(args.slice(3).join(" ")+"\n")
    process.stdin.read()
    app = cp.spawn(args[8], args.slice(9), {stdio: ["inherit", "pipe", "pipe"]})

    app.on("exit", () => {
        if (!IS_COMPLETE_STALL) {
            process.stderr.write(`Restart transcode stream for channel ${args[2]}${os.EOL}`)
            LAST_FRAME = -1
            TIMEOUT_VAL = -1
            FRAME_TICK = false
            TIMESTAMP_TICK = false

            RESTART_STALL = true

            process.stdin.read()
            setTimeout(() => {
                try {
                    fs.rmSync(args[7], {force: true, recursive: true})
                    fs.mkdirSync(args[7], {recursive: true})
                } catch (e) {

                }
                setTimeout(startProcess, 500)
            })            
        }
        //startProcess()
    })

    //app.stdin.on("error", ()=>{})
    app.stdout.on("error", ()=>{})

    //process.stdin.pipe(app.stdin)
    app.stderr.on("data", (d) => {
        const lines = d.toString().split(os.EOL)
        for (let ln = 0; ln<lines.length; ln++) {
            if (lines[ln].length > 0) process.stderr.write(`${args[2]}: ${lines[ln]}${os.EOL}`)
        }
    })

    app.stdout.on("data", (d) => {
        const chunks = d.toString().split(os.EOL)
        for (let i = 0; i<chunks.length; i++) {
            if (chunks[i].length >= 0) {
                const key = chunks[i].split("=")[0]
                const val = chunks[i].split("=")[1]

                STREAM_TIMEOUT_VAL = Date.now() + STREAM_TIMEOUT_DUR
                if (key === "frame") {
                    if (parseInt(val) !== LAST_FRAME) {
                        LAST_FRAME = parseInt(val)
                        //TIMEOUT_VAL = Date.now() + TIMEOUT_DUR
                        //process.stderr.write(`Track stalled status\n`)
                        FRAME_TICK = true
                    }
                } else if (key === "out_time_us") {
                    if (Math.floor(parseInt(val) / 1e6) !== LAST_OUT_TIME) {
                        LAST_OUT_TIME = Math.floor(parseInt(val) / 1e6)
                        TIMESTAMP_TICK = true
                    }
                } else if (key === "fps") {
                    
                    if (parseFloat(val) < parseFloat(args[3])) {
                        console.log(`${args[2]} FPS: ${parseFloat(val)} < ${parseFloat(args[3])}`)
                    }
                    
                    //
                }
            }
        }

        if (TIMESTAMP_TICK && FRAME_TICK) {
            TIMEOUT_VAL = Date.now() + TIMEOUT_DUR
            TIMESTAMP_TICK = false
            FRAME_TICK = false
        }
    })
    //app.stdout.pipe(process.stdout)
}

process.stderr.write(`${args[2]} PPID: ${process.ppid}${os.EOL}`)
SPPID = parseInt(args[4])
process.stderr.write(`${args[2]} SPPID: ${SPPID}${os.EOL}`)
process.stderr.write(`${args[2]} STID: ${args[5]}-${args[6]}${os.EOL}`)
process.stderr.write(`${args[2]} RESTART STALL: ${DO_RESTART_STALL}${os.EOL}`)
process.stderr.write(`${args[2]} PATH: ${args[7]}${os.EOL}`)
startProcess()
