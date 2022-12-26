const process = require("process")
const events = require("events")
const m3u8 = require("m3u8")
const fs = require("fs")
const fs_p = require("fs/promises")
const config = require("../config.json")
const path = require("path")
const os = require("os")

const DVRSignal = new events.EventEmitter()
const QuitSignal = new events.EventEmitter()
var is_quit = false;

var abort_recording = false;

const QuitCheck = () => {
    if (is_quit) {
        QuitSignal.emit("quit")
    }
}

setInterval(QuitCheck, 2000);

const GetM3U8 = (p) => {
    return new Promise((res, rej) => {
        const rs = fs.createReadStream(p)
        const m3u = m3u8.createStream()

        rs.on("error", rej)
        rs.pipe(m3u)

        m3u.on("m3u", res)
    })
}

var HLS_PL = {}
//var HLS_META = []

const UpdateHLSStreams = async (p,d) => {
    if (is_quit) {
        for (let i = 0; i<d.length; i++) {
            await fs_p.appendFile(path.join(config.dvr_path.replace(/\(pathname\)/g, __dirname), HLS_PL[d[i]].target+"/"+d[i]), `#EXT-X-ENDLIST${os.EOL}`)
        }

        if (abort_recording) {
            try {
                await fs_p.rm(path.join(config.dvr_path.replace(/\(pathname\)/g, __dirname), HLS_PL[d[i]].target), {force: true, recursive: true})
            } catch (e) {

            }
        }

        console.log("dvr shut down gracefully")
        process.exit(0)
    }

    try {
        for (let i = 0; i<d.length; i++) {
            const m = await GetM3U8(p+`/${d[i]}`);
            //console.log(HLS_PL[d[i]])
            //if (HLS_PL[d])
            var playlist_to_fetch = [];

            if (HLS_PL[d[i]].is_start) {
                for (let j = 0; j<m.items.PlaylistItem.length; j++) {
                    const pl = m.items.PlaylistItem[j]
                    HLS_PL[d[i]].cache.push(pl)                
                }

                //console.log(m)
                //console.log(path.join(config.dvr_path.replace(/\(pathname\)/g, __dirname), HLS_PL[d[i]].target+"/"+d[i]))
                await fs_p.appendFile(path.join(config.dvr_path.replace(/\(pathname\)/g, __dirname), HLS_PL[d[i]].target+"/"+d[i]), `#EXTM3U${os.EOL}#EXT-X-VERSION:3${os.EOL}#EXT-X-TARGETDURATION:${m.properties.targetDuration}${os.EOL}#EXT-X-MEDIA-SEQUENCE:0${os.EOL}#EXT-X-PLAYLIST-TYPE:VOD${os.EOL}`)
                playlist_to_fetch.push(HLS_PL[d[i]].cache.slice(-1)[0])
                HLS_PL[d[i]].is_start = false
            } else {
                HLS_PL[d[i]].cache = HLS_PL[d[i]].cache.filter((x) => {
                    for (let j = 0; j<m.items.PlaylistItem.length; j++) {
                        const pl = m.items.PlaylistItem[j]
                        if (pl.properties.uri === x.properties.uri) return true
                    }
                    return false;
                })

                for (let j = 0; j<m.items.PlaylistItem.length; j++) {
                    const pl = m.items.PlaylistItem[j]

                    var match = false;
                    for (let sr = 0; sr<HLS_PL[d[i]].cache.length; sr++) {
                        if (pl.properties.uri === HLS_PL[d[i]].cache[sr].properties.uri) {
                            match = true
                            break
                        }
                    }

                    if (!match) {
                        playlist_to_fetch.push(pl)       
                        HLS_PL[d[i]].cache.push(pl)       
                    }
                }
            }

            //console.log(HLS_PL[d[i]].cache)
            //console.log(playlist_to_fetch)

            for (let j = 0; j<playlist_to_fetch.length; j++) {
                //console.log(path.join(config.dvr_path.replace(/\(pathname\)/g, __dirname), HLS_PL[d[i]].target+"/"+playlist_to_fetch[j]))
                await fs_p.copyFile(p+"/"+playlist_to_fetch[j].properties.uri, path.join(config.dvr_path.replace(/\(pathname\)/g, __dirname), HLS_PL[d[i]].target+"/"+playlist_to_fetch[j].properties.uri))
                await fs_p.appendFile(path.join(config.dvr_path.replace(/\(pathname\)/g, __dirname), HLS_PL[d[i]].target+"/"+d[i]), `#EXTINF:${playlist_to_fetch[j].properties.duration}${os.EOL}${playlist_to_fetch[j].properties.uri}${os.EOL}`)
            }
        }
    } catch (e) {
        console.trace(e)
    }

    setTimeout(async () => await UpdateHLSStreams(p,d), config.hls_settings.duration * 1000)
} 

const UpdateFeed = async (p,t) => {
    //console.log(p)
    if (!fs.existsSync(p)) {
        setTimeout(async () => await UpdateFeed(p,t), config.hls_settings.duration * 1000)
    }

    try {
        const m = await GetM3U8(p+"/index.m3u8");
        if (m) {
            var renditions = [];

            for (let i = 0; i<m.items.StreamItem.length; i++) {
                const rendition = m.items.StreamItem[i]
                //HLS_META.push(rendition)
                //console.log(path.join(config.dvr_path.replace(/\(pathname\)/g, __dirname), t+"/index.m3u8"))
                await fs_p.copyFile(p+"/index.m3u8", path.join(config.dvr_path.replace(/\(pathname\)/g, __dirname), t+"/index.m3u8"))
                HLS_PL[rendition.properties.uri] = {is_start: true, cache: [], target: t}

                renditions.push(rendition.properties.uri)
            }
            await UpdateHLSStreams(p,renditions)
        } else {
            setTimeout(async () => await UpdateFeed(p,t), config.hls_settings.duration * 1000)
        }
    } catch (e) {
        //console.trace(e)
        setTimeout(async () => await UpdateFeed(p,t), config.hls_settings.duration * 1000)
    }
}

DVRSignal.once("dvr", async (p) => {
    /*
    QuitSignal.on("quit", () => {
        console.log("dvr shut down gracefully")
        process.exit(0)
    })
    */
    
    const cur_path = path.join(config.streams_path.replace(/\(pathname\)/g, __dirname), `/${p.stream_id}/${p.channel !== -1 ? `${p.channel}/` : ''}`)

    /*
    if (!fs.existsSync(cur_path))
    fs.createReadStream()
    */
    //console.log(cur_path)
    //console.log(p)
    await UpdateFeed(cur_path, p.target)
})

process.on('message', (params) => {
    if (params.quit) {
        console.log("process received quit signal")
        is_quit = true
        abort_recording = params.abort_recording
    } else {
        //console.log(params)
        DVRSignal.emit("dvr", params)
    }
});