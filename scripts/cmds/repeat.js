const cp = require("child_process")
const args = require("process").argv

const startProcess = () => {
    //process.stderr.write(args.slice(3).join(" ")+"\n")
    const app = cp.spawn(args[2], args.slice(3))

    app.on("close", () => {
        startProcess()
    })

    app.stderr.pipe(process.stderr)
}

startProcess()