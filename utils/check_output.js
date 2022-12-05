const cp = require("child_process");
const proc = require("process");

/**
 * 
 * @param {string} cmd 
 * @param {Array<String>} args 
 * @returns {Promise<Buffer>}
 */
module.exports = (cmd, args=[], max_chunks=0, input=null, stderr=null) => {return new Promise((res, rej) => {
    const child = cp.spawn(cmd, args)
    var stdout_buf = []
    child.on("exit", (e) => {
        if (e) return rej(`Process was exited with error code ${e}`)
        return res(Buffer.concat(stdout_buf))
    })
    child.stdout.on("data", (d) => {
        stdout_buf.push(d);
        if (max_chunks > 0 && stdout_buf.length >= max_chunks) {
            child.stdout.destroy()
        }
    })
    child.on("error", (e) => {
        return rej(e)
    })
    child.stdin.on("error", (e) => {
        if (e.code != "EPIPE") {
            return rej(e);
        }
    })
    if (!stderr) child.stderr.pipe(proc.stderr)
    if (input) child.stdin.end(input)
})};
