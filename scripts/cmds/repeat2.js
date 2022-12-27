const cp = require("child_process")
const args = require("process").argv

process.stdin.on("close", () => {
    process.stderr.write(`stdin is closed ${args[2]}\n`)
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
    
    
    process.stdin.read()

    
    setTimeout(() => {
        process.stdin.read()
        startProcess()
    }, 250)
    
    //app.stdout.pipe(process.stdout)
}

startProcess()