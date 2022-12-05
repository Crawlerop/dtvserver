// Based on: https://github.com/akamai/EdgeAuth-Token-Node

'use strict'
const crypto = require('crypto')

class EdgeAuthVerify {
    constructor(options) {
        this.options = options
        
        if (!this.options.key) {
            throw new Error('key must be provided to generate a token.')
        }

        if (this.options.algorithm === undefined) {
            this.options.algorithm = 'sha256'
        }        

        if (this.options.escapeEarly === undefined) {
            this.options.escapeEarly = false
        }

        if (!this.options.fieldDelimiter) {
            this.options.fieldDelimiter = '~'
        }

        if (!this.options.aclDelimiter) {
            this.options.aclDelimiter = '!'
        }
    }

    _escapeEarly(text) {
        if (this.options.escapeEarly) {
            text = encodeURIComponent(text)
                .replace(/[~'*]/g, 
                    function(c) {
                        return '%' + c.charCodeAt(0).toString(16)
                    }
                )
            var pattern = /%../g
            text = text.replace(pattern, function(match) {
                return match.toLowerCase()
            })
        } 
        return text
    }

    _generateTokenHash(token, path, isUrl) {        
        var hashSource = []        
    
        hashSource = token.split(`${this.options.fieldDelimiter}hmac`)[0].split(this.options.fieldDelimiter)

        if (isUrl) {
            hashSource.push("url=" + this._escapeEarly(path))
        }

        if (this.options.salt) {
            hashSource.push("salt=" + this.options.salt)
        }

        this.options.algorithm = this.options.algorithm.toString().toLowerCase()        
        if (!(this.options.algorithm == 'sha256' || this.options.algorithm == 'sha1' || this.options.algorithm == 'md5')) {
            throw new Error('altorithm should be sha256 or sha1 or md5')
        }

        var hmac = crypto.createHmac(
            this.options.algorithm, 
            Buffer.from(this.options.key, 'hex')
        )

        hmac.update(hashSource.join(this.options.fieldDelimiter))        
                
        return hmac.digest("hex")
    }

    _unpackToken(token) {
        var keys = {}
        var token_params = token.split(this.options.fieldDelimiter)

        for (var i = 0; i<token_params.length; i++) {
            keys[token_params[i].slice(0, token_params[i].indexOf("="))] = token_params[i].slice(token_params[i].indexOf("=")+1)
        }

        return keys
    }

    verifyACLToken(url, token, st, et, ip) {
        if (!url) {
            throw new Error('You must provide url')
        }
        
        if (!token) {
            throw new Error("A token is required");
        }

        const hash = this._generateTokenHash(token, undefined, false)
        const token_data = this._unpackToken(token)

        if (!crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(token_data.hmac, "hex"))) return null;

        const current_time = parseInt(Date.now() / 1000);

        if (token_data.ip && (!ip || ip != token_data.ip)) return null
        if (token_data.st && (!st || current_time < st)) return null
        if (token_data.exp && (!et || current_time >= et)) return null
        if (token_data.acl) {
            if (!url) return null;
            const acl_tested = token_data.acl.split(this.options.aclDelimiter)
            var validACL = false

            for (var i = 0; i<acl_tested.length; i++) {
                const acl_regex = new RegExp(acl_tested[i].replace(/\*/g, '([^]*)'), 'g')                
                if (acl_regex.exec(url)) {   
                    validACL = true
                    break
                }
            }

            if (!validACL) return null;
        }
        
        return token_data

    }

    verifyURLToken(url, token, st, et, ip) {
        if (!url) {
            throw new Error('You must provide url')
        }

        if (!token) {
            throw new Error("A token is required");
        }

        const hash = this._generateTokenHash(token, url, true)
        const token_data = this._unpackToken(token)
        
        if (!crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(token_data.hmac, "hex"))) return null;

        const current_time = parseInt(Date.now() / 1000);

        if (token_data.ip && (!ip || ip != token_data.ip)) return null
        if (token_data.st && (!st || current_time < st)) return null
        if (token_data.exp && (!et || current_time >= et)) return null

        return token_data
    }
}

/*  
console.log((new EdgeAuthVerify({key: "12345"})).verifyACLToken("/path/tos/123", "exp=1669651222~acl=/path/tos/*~hmac=8ba6d01c925c8089aa2097b341946e6b7086e596a9f5d7c4799b953c77ee6717", null, 1669651222))
console.log((new EdgeAuthVerify({key: "12345"})).verifyACLToken("/path/tosss/", "exp=1669651222~acl=/path/tos/*~hmac=8ba6d01c925c8089aa2097b341946e6b7086e596a9f5d7c4799b953c77ee6717", null, 1669651222))
console.log((new EdgeAuthVerify({key: "12345"})).verifyURLToken("/path/tos/a", "exp=1669650905~hmac=36b34e38f200d172395bd9d89d5cb5f66b28e522cc38a50490573c90d4e0b38b", null, 1669651222))
console.log((new EdgeAuthVerify({key: "12345"})).verifyURLToken("/path/tos/abb", "exp=1669650905~hmac=36b34e38f200d172395bd9d89d5cb5f66b28e522cc38a50490573c90d4e0b38b", null, 1669651222))
*/
module.exports = EdgeAuthVerify