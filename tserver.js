const express = require("express");
const websocket = require("ws");
const path = require('path');
const proc = require('process')
const ev = require("events")
const crypto = require("crypto")
var cors = require('cors')

const ev_dtv = new ev.EventEmitter()

var app = express();
app = require('express-ws')(app).app;

app.ws("/ws/dtv", 
    /**
     * zeroes
     * @param {websocket.WebSocket} ws 
     * @param {express.Request} req
     */
    (ws, req) => {
        if (!req.query.token) return;

        ev_dtv.on("manifest", (payload) => {
            const m = JSON.parse(payload)
            ws.send("\x00"+JSON.stringify({"type": "manifest", "path": m.path, "id": m.channel, "request_id": m.sid}))
        })

        ev_dtv.on("segment", (payload) => {
            const m = JSON.parse(payload)
            ws.send("\x00"+JSON.stringify({"type": "segment", "path": m.path, "id": m.channel, "request_id": m.sid}))
        })

        ev_dtv.on("chunk", (sid) => {
            ws.send("\x00"+JSON.stringify({"type": "chunk", "request_id": sid}))
        })

        ws.on("message", (e) => {                                               
            if (e[0] == 0) {
                const m = JSON.parse(e.subarray(1).toString("utf-8"))
                if (m.type == "ping") {
                    ws.send("\x00"+JSON.stringify({type: "pong"}))
                } else {
                    ev_dtv.emit("response", m.request_id, e.subarray(1).toString("utf-8"), e[0])
                }
            } else if (e[0] == 1) {
                ev_dtv.emit("response", e.subarray(1,129).toString("hex"), e.subarray(129), e[0])
            }
        });
    }
)

var EL = {}

app.ws("/ws/file", 
    /**
     * zeroes
     * @param {websocket.WebSocket} ws 
     * @param {express.Request} req
     */
    (ws) => {

        /*
        const s_id = req.query.sid
        if (!s_id) return ws.close()
        if (EL[s_id] === undefined) return ws.close()
        */

        /*
        ws.on("close", () => {
            console.log("closed")
        })
        */
        

        ev_dtv.on("file_chunk_sent", (sid) => {
            ws.send(JSON.stringify({"status": "OK", "request_id": sid}))
        })

        ws.on("message", (e) => {                                           
            const s_id = e.subarray(0,128).toString("hex")
            if (EL[s_id] === undefined) return ws.close()
            EL[s_id].emit("chunk", e.subarray(128))
        });
    }
)

const wait_for_response = (sid) => {
    return new Promise((res) => {
        const timeout = setTimeout(() => {
            return res()
        }, 10000)
        ev_dtv.once("response", (request_id, msg, type) => {                     
            if (request_id == sid) {
                if (type == 0) {
                    return res(JSON.parse(msg))
                } else {
                    return res(msg)
                }
            }
        })
        
    })
}

const wait_for_response_file = (sid) => {
    return new Promise((res) => {
        const timeout = setTimeout(() => {
            return res()
        }, 10000)
        EL[sid].once("chunk", (msg) => {                     
            return res(msg)
        })
    })
}

app.get("/api/tv/:channel/:manifest.m3u8", cors(), async (req, res) => {
    const request_id = crypto.randomBytes(128).toString("hex")
    ev_dtv.emit("manifest", JSON.stringify({path: req.params.manifest, channel: req.params.channel, sid: request_id}))
    const init_response = await wait_for_response(request_id)

    if (!init_response) {
        return res.status(503).header("Retry-After", "5").json({error: "Upstream server is not available."})
    } else if (init_response.status == "error") {
        let status_code = 500
        switch (init_response.type) {
            case "notfound":
                status_code = 404
                break
        }
        return res.status(status_code).json({error: init_response.error})
    }

    return res.status(200).header("Content-Type", "application/x-mpegurl").end(init_response.manifest)
})

app.get("/api/tv/:channel/:segment.ts", cors(), async (req, res) => {
    const request_id = crypto.randomBytes(128).toString("hex")
    ev_dtv.emit("segment", JSON.stringify({path: req.params.segment, channel: req.params.channel, sid: request_id}))
    EL[request_id] = new ev.EventEmitter()
    const init_response = await wait_for_response(request_id)

    if (!init_response) {
        delete EL[request_id]
        return res.status(503).header("Retry-After", "5").json({error: "Upstream server is not available."})
    } else if (init_response.status == "error") {
        let status_code = 500
        switch (init_response.type) {
            case "notfound":
                status_code = 404
                break
        }

        delete EL[request_id]
        return res.status(status_code).json({error: init_response.error})
    }

    res.statusCode = 200
    res.header("Content-Type", "video/MP2T")
    res.header("Content-Length", init_response.size)

    let size_required = init_response.size

    while (size_required > 0) {
        //console.log("waiting for it at " +request_id)
        const chunk = await wait_for_response_file(request_id)
        //console.log("waited for it at " + request_id)
        if (!chunk || chunk.length <= 0) {
            console.log("empty chunk for "+request_id)
            res.end()
            break
        }

        size_required -= chunk.length
        //console.log(size_required+" for "+request_id)

        ev_dtv.emit("file_chunk_sent", request_id)
        //setTimeout(() => ev_dtv.emit("file_chunk_sent", request_id), 500)

        if (size_required <= 0) {
            res.end(chunk)
            break;
        } else {
            res.write(chunk)
        }
    }            
    delete EL[request_id]

    //console.log("finish send data for "+request_id)
})

const PORT = proc.env["PORT"] ? proc.env["PORT"] : 62541
app.listen(PORT)