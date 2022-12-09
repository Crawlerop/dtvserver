const express = require("express")

const crypto = require("crypto")
const app = express()
app.use(express.json())
const axios = require("axios")
const redis = require("redis")
const proc = require("process")
//const snake_case = require("snake-case")

const redis_client = redis.createClient()

/*
var sub_domains = {}
var proxy_names = {}
*/
const get = (url) => {
    return async (req, res) => {
        try {
            const req_url = url.replace(/\(stream\)/g, req.params.stream).replace(/\(path\)/g, req.params.path)

            const req_p = await axios.get(req_url, {
                headers: {
                    Host: req.subdomain_to_use
                },
                validateStatus: () => {
                    return true
                },
                responseType: 'stream'
            })

            res.statusCode = req_p.status

            for (i = 0; i<req_p.data.rawHeaders.length; i += 2) {
                if (req_p.data.rawHeaders[i].toLowerCase() !== "connection") res.header(req_p.data.rawHeaders[i], req_p.data.rawHeaders[i+1])
            }
            req_p.data.pipe(res)
        } catch (e) {
            return res.status(500).json(e)
        }
    }
}

const loadSubDomain = async (req, res, next) => {
    req.subdomain_to_use = await redis_client.get(`tunnel_domain_${req.params.inst}`)
    if (req.subdomain_to_use === null) return res.status(503).json({"error": "This server is not available"})
    next()
}

/*
app.get("/tv/:inst/manifest.json", loadSubDomain, proxy('localhost:62310', {
    proxyReqOptDecorator: function(proxyReqOpts, req) {
        proxyReqOpts.headers['Host'] = req.subdomain_to_use;
        return proxyReqOpts;
    },
    proxyReqPathResolver: function () {
        return `/manifest.json`
    }
}))

app.get("/tv/:inst/:stream/:path", loadSubDomain, proxy('localhost:62310', {
    proxyReqOptDecorator: function(proxyReqOpts, req) {
        proxyReqOpts.headers['Host'] = req.subdomain_to_use;
        return proxyReqOpts;
    },
    proxyReqPathResolver: function (req) {
        return `/play/${req.params.stream}/${req.params.path}`
      }
}))
*/

app.get("/tv/:inst/manifest.json", loadSubDomain, get('http://localhost:62310/manifest.json'))
app.get("/tv/:inst/:stream/:path", loadSubDomain, get(`http://localhost:62310/play/(stream)/(path)`))
app.get("/tv/:inst/streams.json", loadSubDomain, get('http://localhost:62310/api/streams'))

app.post("/login", async (req, res) => {
    if (!req.body.content.user) return res.status(200).json({
        reject: true,
        reject_reason: "a token is required"
    })

    return res.status(200).json({
        "reject": false,
        "unchange": true
    })
})

app.post("/open", async (req, res) => {    
    if (!req.body.content.user.user) return res.status(200).json({
        reject: true,
        reject_reason: "a token is required"
    })

    const sd_hash = crypto.randomBytes(128).toString("hex")

    await redis_client.set(`tunnel_domain_${req.body.content.user.user}`, sd_hash)
    await redis_client.set(`tunnel_name_${req.body.content.user.user}`, req.body.content.proxy_name)

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
            custom_domains: [sd_hash]
        }
    })
})

app.post("/close", async (req, res) => {    
    if ((await redis_client.get(`tunnel_name_${req.body.content.user.user}`)) === req.body.content.proxy_name) {
        await redis_client.del(`tunnel_domain_${req.body.content.user.user}`)
        await redis_client.del(`tunnel_name_${req.body.content.user.user}`)
    }

    return res.status(200).json({
        "reject": false,
        "unchange": true
    })
})

const PORT = proc.env["PORT"] ? proc.env["PORT"] : 51450

redis_client.connect().then(() => {
    app.listen(PORT)
})