var UPnPControlPoint = require('node-upnp-control-point');
var x2js = require("xml2js");

module.exports = (ip) => {return new Promise((res, rej) => {
    var mediaServerCP = new UPnPControlPoint(`http://${ip}:8998/dvb2ip.xml`);    
    mediaServerCP.invokeActionParsed("Browse", {ObjectID: "1", BrowseFlag: "BrowseDirectChildren", Filter: "*", StartingIndex: 0}, 'urn:schemas-upnp-org:service:ContentDirectory:1', function(err, m) {
        if (err) return rej(err);

        const channels = []
        const p = new x2js.Parser()
        p.parseStringPromise(m.BrowseResponse.Result).then((x) => {    
            for (var i = 0; i<x['DIDL-Lite']['item'].length; i++) {
                const name = x['DIDL-Lite']['item'][i]['dc:title'][0].slice(x['DIDL-Lite']['item'][i]['dc:title'][0].indexOf(". ")+2)
                const stream_regex = (new RegExp('([\s\S]*)\/stream=([0-9]*).ts', 'g')).exec(x['DIDL-Lite']['item'][i]['res'][0]["_"])
                const stream_id = parseInt(stream_regex[2])
                channels.push({name,stream_id})
            }
        })

        return res(channels);
    });    
})}

/*
module.exports("192.168.0.106").then((a) => {
    console.log(a)
}).catch((e) => {
    
})
*/