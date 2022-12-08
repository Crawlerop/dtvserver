const express = require("express");
const websocket = require("ws");
const express_sd = require("express-slow-down")
const fastify = require("fastify")
const fastify_cors = require("@fastify/cors")
const path = require('path');
const proc = require('process')
const ev = require("events")
const crypto = require("crypto")
const woe = require('wait-for-event')
var cors = require('cors');
const { EventEmitter } = require("stream");
const cluster = require('cluster');
const { response } = require("express");

const workersCount = require('os').cpus().length;
//const workersCount = 64;

const USE_WORKERS = true

if (cluster.isMaster && USE_WORKERS) {
    console.log(`Master ${process.pid} is running`);

    const PORT = proc.env["PORT"] ? proc.env["PORT"] : 62541
    var app = express();
    app = require('express-ws')(app).app;

  
    // Fork workers.
    for (let i = 0; i < workersCount; i++) {
        cluster.fork({cluster_id: i+1, PORT: PORT+1});
    }

    const ev_dtv = new ev.EventEmitter()

    const workers = {}

    cluster.on("fork", (w) => {
        workers[w.process.pid] = w
        w.process.on("message", (p) => {
            if (p.type == "manifest") {
                ev_dtv.emit("manifest", JSON.stringify({worker_id: w.process.pid, ...p.data}))
            } else if (p.type == "segment") {
                ev_dtv.emit("segment", JSON.stringify({worker_id: w.process.pid, ...p.data}))
            } else if (p.type == "chunk") {
                ev_dtv.emit("chunk", JSON.stringify({worker_id: w.process.pid, ...p.data}))
            } else if (p.type == "chunk_response") {
                ev_dtv.emit("file_chunk_sent", p.request_id, p.worker_id)
            }
        })
    })

    app.listen(PORT)

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
                ws.send("\x00"+JSON.stringify({"type": "manifest", "path": m.path, "id": m.channel, "request_id": m.sid, "worker_id": m.worker_id}))
            })

            ev_dtv.on("segment", (payload) => {
                const m = JSON.parse(payload)
                ws.send("\x00"+JSON.stringify({"type": "segment", "path": m.path, "id": m.channel, "request_id": m.sid, "worker_id": m.worker_id}))
            })

            ev_dtv.on("chunk", (payload) => {
                const m = JSON.parse(payload)
                ws.send("\x00"+JSON.stringify({"type": "chunk", "request_id": m.sid, "worker_id": m.worker_id}))
            })

            ws.on("message", (e) => {                                    
                if (e[0] == 0) {
                    const m = JSON.parse(e.subarray(1).toString("utf-8"))
                    if (m.type == "ping") {
                        ws.send("\x00"+JSON.stringify({type: "pong"}))
                    } else {                      
                        workers[m.worker_id].process.send({type: "response", data: e.subarray(1).toString("utf-8"), coding: e[0], request_id: m.request_id})
                    }
                } else if (e[0] == 1) {
                    const sid = e.subarray(1,129).toString("hex")
                    const w_id = e.readBigUInt64LE(129)
                    
                    workers[w_id].process.send({type: "response", data: e.subarray(129+8), coding: e[0], request_id: sid})
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
            
            ws.on("open", () => {
                process.send({})
            })

            ev_dtv.on("file_chunk_sent", (sid, wid) => {
                ws.send(JSON.stringify({"status": "OK", "request_id": sid, "worker_id": wid}))
            })

            ws.on("message", (e) => {                                           
                const s_id = e.subarray(0,128).toString("hex")
                const w_id = e.readBigUInt64LE(128)
                
                workers[w_id].process.send({type: "file_response", data: e.subarray(128+8), request_id: s_id})
            });
        }
    )

    // This event is firs when worker died
    cluster.on('exit', (worker, code, signal) => {
      console.log(`worker ${worker.process.pid} died`);
    });
} else {
    const app = fastify.fastify()
    var EP = {}
    var PR = {}

    var PSR = {}
    var PSS = {}
    var PSF = {}

    var XID = 0

    // var EL = {}

    app.register(fastify_cors)

    process.on('message', (p) => {
        //console.log(p.type)
        try {
            if (p.type == "response") {
                EP[p.request_id].emit("response", p.data, p.coding)
            } else if (p.type == "file_response") {
                // EL[p.request_id].emit("chunk", Buffer.from(p.data))
                if (PR[p.request_id] !== undefined && PSR[p.request_id] !== undefined) {
                    if (PSR[p.request_id] > 0) {
                        let chunk = Buffer.from(p.data)

                        if (!PSF[p.request_id]) {
                            if (PSS[p.request_id] !== undefined) console.log(`${PSS[p.request_id]} sent it's first data`)
                            PSF[p.request_id] = true
                        }

                        if (!chunk || chunk.length <= 0) {
                            console.log("empty chunk for "+p.request_id)
                            PR[p.request_id].raw.end()
                            
                            if (PSS[p.request_id] !== undefined) {
                                console.log(`${PSS[p.request_id]} finished it's request`)
                                delete PSS[p.request_id]
                            }

                            delete PR[p.request_id]
                            delete PSR[p.request_id]
                            delete PSF[p.request_id]
                            return
                        }
    
                        PSR[p.request_id] -= chunk.length
    
                        if (PSR[p.request_id] <= 0) {
                            PR[p.request_id].raw.end(chunk)
                        } else {
                            PR[p.request_id].raw.write(chunk)
                        }

                        proc.send({type: "chunk_response", request_id: p.request_id, work_id: proc.pid})
                    }
                    
                    if (PSR[p.request_id] <= 0 || PR[p.request_id].raw.closed) {
                        if (PSS[p.request_id] !== undefined) {
                            console.log(`${PSS[p.request_id]} finished it's request`)
                            delete PSS[p.request_id]
                        }

                        delete PR[p.request_id]
                        delete PSR[p.request_id]
                        delete PSF[p.request_id]
                    }    
                }
            }
        } catch (e) {

        }
    })

    const wait_for_response = (sid) => {
        return new Promise((res) => {
            const timeout = setTimeout(() => {
                return res()
            }, 10000)

            /*
            woe.waitFor("response", EP[sid], [(msg, type) => {  
                if (type == 0) {
                    return res(JSON.parse(msg))
                } else {
                    return res(msg)
                }
            }])
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

    /*
    const wait_for_response_file = (sid) => {
        return new Promise((res) => {
            const timeout = setTimeout(() => {
                return res()
            }, 10000)

            EL[sid].once("chunk", (msg) => {                     
                return res(msg)
            })

            /*
            woe.waitFor("chunk", EL[sid], (msg) => {                     
                return res(msg)
            })
            */
           /*
        })
    }
    */

    app.get("/api/tv/:channel/:manifest.m3u8", async (req, res) => {
        const request_id = crypto.randomBytes(128).toString("hex")
        EP[request_id] = new EventEmitter()
        proc.send({type: "manifest", data: {path: req.params.manifest, channel: req.params.channel, sid: request_id}})
        const init_response = await wait_for_response(request_id)

        if (!init_response) {
            delete EP[request_id]
            return res.status(503).header("Retry-After", "5").send({error: "Upstream server is not available."})
        } else if (init_response.status == "error") {
            let status_code = 500
            switch (init_response.type) {
                case "notfound":
                    status_code = 404
                    break
            }
            delete EP[request_id]
            return res.status(status_code).send({error: init_response.error})
        }

        delete EP[request_id]

        if (req.query.step) console.log(`${req.query.step} request was accepted @ ${proc.pid} in ${proc.env["cluster_id"]}`)
        return res.status(200).header("Content-Type", "application/x-mpegurl").send(init_response.manifest)
    })

    app.get("/api/tv/:channel/:segment.ts", async (req, res) => {
        const request_id = crypto.randomBytes(128).toString("hex")
        proc.send({type: "segment", data: {path: req.params.segment, channel: req.params.channel, sid: request_id}})
        EP[request_id] = new ev.EventEmitter()
        //EL[request_id] = new ev.EventEmitter()
        const init_response = await wait_for_response(request_id)

        if (!init_response) {
            //delete EL[request_id]
            delete EP[request_id]
            return res.status(503).header("Retry-After", "5").send({error: "Upstream server is not available."})
        } else if (init_response.status == "error") {
            let status_code = 500
            switch (init_response.type) {
                case "notfound":
                    status_code = 404
                    break
            }

            //delete EL[request_id]
            delete EP[request_id]
            return res.status(status_code).send({error: init_response.error})
        }

        delete EP[request_id]
        const RID = XID++;

        if (req.query.step) {
            console.log(`${req.query.step} request was accepted @ ${proc.pid} in ${proc.env["cluster_id"]}`)
        } else {
            console.log(`${RID} request was accepted @ ${proc.pid} in ${proc.env["cluster_id"]}`)
        }
        
        res.raw.statusCode = 200
        res.raw.setHeader("Content-Type", "video/MP2T")
        res.raw.setHeader("Content-Length", init_response.size)
        res.raw.setHeader('Access-Control-Allow-Origin', '*')

        res.raw.writeHead(200)

        /*
        let size_required = init_response.size

        let first = false

        PR
        */

        PR[request_id] = res
        PSR[request_id] = init_response.size
        PSF[request_id] = false

        if (req.query.step) {
            PSS[request_id] = req.query.step
        } else {
            PSS[request_id] = `${RID} @ ${proc.pid}`
        }

        /*
        EL[request_id].on("chunk", async (chunk) => {
            try {
                if (size_required > 0) {
                    //console.log("waiting for it at " +request_id)
                    // const chunk = await wait_for_response_file(request_id)
                    //console.log(chunk)
                    //console.log("waited for it at " + request_id)
                    if (!chunk || chunk.length <= 0) {
                        console.log("empty chunk for "+request_id)
                        res.raw.end()
                        
                        delete EL[request_id]
                        delete EP[request_id]
                        if (req.query.step) console.log(`${req.query.step} finished it's request @ ${proc.pid} in ${proc.env["cluster_id"]}`)
                        return
                    }

                    if (!first) {
                        if (req.query.step) console.log(`${req.query.step} sent it's first data @ ${proc.pid} in ${proc.env["cluster_id"]}`)
                        first = true
                    }

                    size_required -= chunk.length
                    //console.log(size_required+" for "+request_id)

                    proc.send({type: "chunk_response", request_id, work_id: proc.pid})
                    //setTimeout(() => ev_dtv.emit("file_chunk_sent", request_id), 500)

                    if (size_required <= 0) {
                        res.raw.end(chunk)
                    } else {
                        res.raw.write(chunk)
                    }
                } else {
                    delete EL[request_id]
                    delete EP[request_id]
                    if (req.query.step) console.log(`${req.query.step} finished it's request @ ${proc.pid} in ${proc.env["cluster_id"]}`)
                }    
            } catch (e) {
                console.trace(e)
                res.raw.end()
                        
                delete EL[request_id]
                delete EP[request_id]
                if (req.query.step) console.log(`${req.query.step} finished it's request @ ${proc.pid} in ${proc.env["cluster_id"]}`)
            }     
        })
        */

        //console.log("finish send data for "+request_id)
    })

    /*
    app.use((req, res, next) => {
        res.header("X-Worker-ID", process.pid)
        next()
    })
    */

    app.listen({port: process.env["PORT"]}, (err, port) => {
        if (USE_WORKERS) console.log(err ? err : `worker ${process.pid} is running`);
    })
}