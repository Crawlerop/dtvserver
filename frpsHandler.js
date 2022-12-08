const express = require("express")

const crypto = require("crypto")
const app = express()
app.use(express.json())
const proxy = require("express-http-proxy")

var sub_domains = {}

app.get("/tv/:inst/:stream/:path", (req, res, next) => {
    if (sub_domains[req.params.inst] === undefined) return res.status(503).json({"error": "Backend is not available"})
    next()
}, proxy('localhost:62310', {
    proxyReqOptDecorator: function(proxyReqOpts, srcReq) {
        proxyReqOpts.headers['Host'] = sub_domains[srcReq.params.inst];
        return proxyReqOpts;
    },
    proxyReqPathResolver: function (req) {
        return `/play/${req.params.stream}/${req.params.path}`
      }
}))

app.post("/open", async (req, res) => {
    sub_domains[req.body.content.proxy_name] = crypto.randomBytes(128).toString("hex")
    console.log(sub_domains[req.body.content.proxy_name])
    console.log(req.body.content.proxy_name)

    return res.status(200).json({
        reject: false,
        unchange: false,
        content: {
            proxy_name: req.body.content.proxy_name,
            proxy_type: 'http',
            custom_domains: [sub_domains[req.body.content.proxy_name]]
        }
    })
})

app.post("/close", async (req, res) => {
    delete sub_domains[req.body.content.proxy_name]

    return res.status(200).json({
        "reject": false,
        "unchange": true
    })
})

app.listen(51450)