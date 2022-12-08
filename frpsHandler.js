const express = require("express")

const crypto = require("crypto")
const app = express()
app.use(express.json())
const proxy = require("express-http-proxy")

var sub_domains = {}
var proxy_names = {}

app.get("/tv/:inst/manifest.json", (req, res, next) => {
    if (sub_domains[req.params.inst] === undefined) return res.status(503).json({"error": "This server is not available"})
    next()
}, proxy('localhost:62310', {
    proxyReqOptDecorator: function(proxyReqOpts, srcReq) {
        proxyReqOpts.headers['Host'] = sub_domains[srcReq.params.inst];
        return proxyReqOpts;
    },
    proxyReqPathResolver: function () {
        return `/manifest.json`
    }
}))

app.get("/tv/:inst/:stream/:path", (req, res, next) => {
    if (sub_domains[req.params.inst] === undefined) return res.status(503).json({"error": "This server is not available."})
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
    if (!req.body.content.user.user) return res.status(200).json({
        reject: true,
        reject_reason: "a token is required"
    })

    sub_domains[req.body.content.user.user] = crypto.randomBytes(128).toString("hex")
    proxy_names[req.body.content.user.user] = req.body.content.proxy_name
    //console.log(req.body.content.user.user)

    /*
    console.log(sub_domains[req.body.content.proxy_name])
    console.log(req.body.content.proxy_name)
    */

    return res.status(200).json({
        reject: false,
        unchange: false,
        content: {
            user: {
                user: req.body.content.user.user,
                metas: null,
                run_id: req.body.content.user.run_id
            },
            proxy_name: req.body.content.proxy_name,
            proxy_type: 'http',
            custom_domains: [sub_domains[req.body.content.user.user]]
        }
    })
})

app.post("/close", async (req, res) => {    
    if (proxy_names[req.body.content.user.user] === req.body.content.proxy_name) delete sub_domains[req.body.content.user.user]

    return res.status(200).json({
        "reject": false,
        "unchange": true
    })
})

app.listen(51450)