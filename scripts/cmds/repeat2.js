const cp = require("child_process")
const args = require("process").argv

process.stdin.on("close", () => {
    console.log("stdin is closed")
    process.exit(0)
})

const startProcess = () => {
    //process.stderr.write(args.slice(3).join(" ")+"\n")
    /*
    process.stderr.write(`${args[3]} ${args.slice(4).join(" ")}\n`)
    process.exit(0)
    */

    try {
        cp.execSync(args[3], {stdio: "inherit"})
    } catch (e) {}

    process.stderr.write(`Restart transcode stream for channel ${args[2]}\n`)
    setTimeout(startProcess, 2000)
    //app.stdout.pipe(process.stdout)
}

startProcess()