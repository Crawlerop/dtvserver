const cp = require("child_process")
const args = require("process").argv

const startProcess = () => {
    //process.stderr.write(args.slice(3).join(" ")+"\n")
    const app = cp.spawn(args[2], args.slice(3))

    app.on("exit", () => {
        startProcess()
    })

    process.stdin.pipe(app.stdin)
    app.stderr.pipe(process.stderr)
    app.stdout.pipe(process.stdout)
}

startProcess()