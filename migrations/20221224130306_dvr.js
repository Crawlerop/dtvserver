/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
    return knex.schema
    .createTable('dvr', (table) => {
      table.increments('id').primary()

      table.string("stream_id").notNullable()
      table.string("channel").defaultTo(0)
      table.string("dvr_id").notNullable()
      //table.string("dvr_path").notNullable()
      table.date("created_on").notNullable()
      //table.jsonb("params").notNullable()
    })
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
    return knex.schema
    .dropTableIfExists('dvr')
};
