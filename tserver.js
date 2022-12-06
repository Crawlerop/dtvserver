const express = require("express");
const websocket = require("ws");
const express_sd = require("express-slow-down")
const path = require('path');
const proc = require('process')
const ev = require("events")
const crypto = require("crypto")
var cors = require('cors');
const { EventEmitter } = require("stream");

const ev_dtv = new ev.EventEmitter()

var app = express();
app = require('express-ws')(app).app;

var EP = {}
var EL = {}

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
                    if (EP[m.request_id] === undefined) return ws.close()
                    EP[m.request_id].emit("response", e.subarray(1).toString("utf-8"), e[0])
                }
            } else if (e[0] == 1) {
                const sid = e.subarray(1,129).toString("hex")
                if (EP[sid] === undefined) return ws.close()
                EP[sid].emit("response", e.subarray(129), e[0])
            }
        });
    }
)

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
        /*
        const timeout = setTimeout(() => {
            return res()
        }, 10000)
        */
        EP[sid].once("response", (msg, type) => {                     
            if (type == 0) {
                return res(JSON.parse(msg))
            } else {
                return res(msg)
            }
        })
        
    })
}

const wait_for_response_file = (sid) => {
    return new Promise((res) => {
        /*
        const timeout = setTimeout(() => {
            return res()
        }, 10000)
        */
        EL[sid].once("chunk", (msg) => {                     
            return res(msg)
        })
    })
}

app.get("/api/tv/:channel/:manifest.m3u8", express_sd({
    windowMs: 5*1000,
    delayAfter: 500,
    delayMs: 5,
    maxDelayMs: 250
}), cors(), async (req, res) => {
    const request_id = crypto.randomBytes(128).toString("hex")
    EP[request_id] = new EventEmitter()
    ev_dtv.emit("manifest", JSON.stringify({path: req.params.manifest, channel: req.params.channel, sid: request_id}))
    const init_response = await wait_for_response(request_id)

    if (!init_response) {
        delete EP[request_id]
        return res.status(503).header("Retry-After", "5").json({error: "Upstream server is not available."})
    } else if (init_response.status == "error") {
        let status_code = 500
        switch (init_response.type) {
            case "notfound":
                status_code = 404
                break
        }
        delete EP[request_id]
        return res.status(status_code).json({error: init_response.error})
    }

    delete EP[request_id]

    if (req.query.step) console.log(`${req.query.step} request was accepted`)
    return res.status(200).header("Content-Type", "application/x-mpegurl").end(init_response.manifest)
})

app.get("/api/tv/:channel/:segment.ts", express_sd({
    windowMs: 5*1000,
    delayAfter: 150,
    delayMs: 5,
    maxDelayMs: 500
}), cors(), async (req, res) => {
    const request_id = crypto.randomBytes(128).toString("hex")
    ev_dtv.emit("segment", JSON.stringify({path: req.params.segment, channel: req.params.channel, sid: request_id}))
    EP[request_id] = new ev.EventEmitter()
    EL[request_id] = new ev.EventEmitter()
    const init_response = await wait_for_response(request_id)

    if (!init_response) {
        delete EL[request_id]
        delete EP[request_id]
        return res.status(503).header("Retry-After", "5").json({error: "Upstream server is not available."})
    } else if (init_response.status == "error") {
        let status_code = 500
        switch (init_response.type) {
            case "notfound":
                status_code = 404
                break
        }

        delete EL[request_id]
        delete EP[request_id]
        return res.status(status_code).json({error: init_response.error})
    }

    if (req.query.step) console.log(`${req.query.step} request was accepted`)
    res.statusCode = 200
    res.header("Content-Type", "video/MP2T")
    res.header("Content-Length", init_response.size)

    let size_required = init_response.size

    let first = false

    while (size_required > 0) {
        //console.log("waiting for it at " +request_id)
        const chunk = await wait_for_response_file(request_id)
        //console.log("waited for it at " + request_id)
        if (!chunk || chunk.length <= 0) {
            console.log("empty chunk for "+request_id)
            res.end()
            break
        }

        if (!first) {
            if (req.query.step) console.log(`${req.query.step} sent it's first data`)
            first = true
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
    delete EP[request_id]

    if (req.query.step) console.log(`${req.query.step} finished it's requqest`)

    //console.log("finish send data for "+request_id)
})

const PORT = proc.env["PORT"] ? proc.env["PORT"] : 62541
app.listen(PORT)