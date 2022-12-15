const cp = require("child_process")
const args = require("process").argv

process.stdin.on("close", () => {
    process.exit(0)
})

const startProcess = () => {
    //process.stderr.write(args.slice(3).join(" ")+"\n")
    cp.execSync(`${args[3]} ${args.slice(4).join(" ")}`, {stdio: "inherit"})

    process.stderr.write(`Restart transcode stream for channel ${args[2]}\n`)
    setTimeout(startProcess, 2000)
    //app.stdout.pipe(process.stdout)
}

startProcess()