const ws = require("ws")
const proc = require("process")
const fd = require("fs/promises")

const BLOCK_SIZE = 64*1024

proc.on("message", async(d) => {
    const seg_fd = await fd.open(d.path)
    const ws_conn = new ws.WebSocket(`${d.dtv_protocol}://${d.dtv_forward_host}/ws/file`)
    /*
    ws_conn.on("close", () => {
        
    })
    */
    ws_conn.on("open", async () => {
        try {
            let r = await seg_fd.read(Buffer.alloc(BLOCK_SIZE), 0, BLOCK_SIZE)
            const getChunk = async () => {
                if (r.bytesRead > 0) {
                    ws_conn.send(Buffer.concat([Buffer.from(d.request_id, "hex"), r.buffer.subarray(0,r.bytesRead)]))
                    r = await seg_fd.read(Buffer.alloc(BLOCK_SIZE), 0, BLOCK_SIZE)
                } else {
                    seg_fd.close()
                    ws_conn.close()
                }
            }
            proc.nextTick(getChunk)

            ws_conn.on("message", (p) => {
                const data = JSON.parse(p)
                if (data.status == "OK" && data.request_id == d.request_id) {
                    setTimeout(() => proc.nextTick(getChunk), 75)
                    //proc.nextTick(getChunk)
                }
            })
        } catch (e) {
            ws_conn.close()
        }
    })
})
