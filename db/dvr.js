const {Model} = require("objection");

class DVR extends Model {
    static get tableName() {
        return 'dvr';
    }    
}

module.exports = DVR