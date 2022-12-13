const cp = require("child_process")
const args = require("process").argv

process.stdin.on("close", () => {
    process.exit(0)
})

const startProcess = () => {
    //process.stderr.write(args.slice(3).join(" ")+"\n")
    const app = cp.spawn(args[3], args.slice(4))

    app.on("exit", () => {
        process.stderr.write(`Restart transcode stream for channel ${args[2]}\n`)
        startProcess()
    })

    app.stdin.on("error", ()=>{})

    process.stdin.pipe(app.stdin)
    app.stderr.pipe(process.stderr)
    app.stdout.pipe(process.stdout)
}

startProcess()