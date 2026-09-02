/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
    return knex.schema.alterTable('training_sessions', function(table) {
        table.string('time_zone').defaultTo('America/Denver');
    });
      
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
    return knex.schema.alterTable('training_sessions', function(table) {
        table.dropColumn('time_zone');
    });
};
