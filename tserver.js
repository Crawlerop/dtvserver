const express = require("express");
const websocket = require("ws");
const path = require('path');
const proc = require('process')
const ev = require("events")
const crypto = require("crypto")

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

        })

        ws.on("message", (e) => {
            const m = JSON.parse(e)
            if (m.type == "ping") {
                ws.send("\x00"+JSON.stringify({type: "pong"}))
            } else {
                ev_dtv.emit("response", m.request_id, e)
            }
        });
    }
)

const wait_for_response = (sid) => {
    return new Promise((res) => {
        const timeout = setTimeout(() => {
            return res()
        }, 10000)
        ev_dtv.once("response", (request_id, msg) => {
            clearTimeout(timeout)
            return res(JSON.parse(msg))
        })
        
    })
}

app.get("/api/tv/:channel/:manifest.m3u8", async (req, res) => {
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
})

app.get("/api/tv/:channel/:segment.ts", async (req, res) => {
    
})

const PORT = proc.env["PORT"] ? proc.env["PORT"] : 62541
app.listen(PORT)