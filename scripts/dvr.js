const process = require("process")
const events = require("events")

const DVRSignal = new events.EventEmitter()
var is_quit;

process.on('message', (params) => {
    if (params.quit) {
        console.log("process received quit signal")
        is_quit = true
    } else {
        //console.log(params)
        DVRSignal.emit("dvr", params)
    }
});