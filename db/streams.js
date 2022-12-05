const {Model} = require("objection");

class Streams extends Model {
    static get tableName() {
        return 'streams';
    }    
}

module.exports = Streams