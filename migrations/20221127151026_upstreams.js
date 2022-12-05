/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
 exports.up = function(knex) {
    return knex.schema
    .createTable('streams', (table) => {
      table.increments('id').primary()

      table.string("stream_id").notNullable()
      table.string("name").notNullable()
      table.string("type").notNullable()
      table.boolean("active").defaultTo(false)
      table.jsonb("params").notNullable()
    })
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
    return knex.schema
    .dropTableIfExists('streams')
};
