/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
    // return knex.schema.alterTable('clients', function(table) {
    //     table.integer('invite_limit').notNullable().defaultTo(5);
    // });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
    // return knex.schema.alterTable('clients', function(table) {
    //     table.dropColumn('invite_limit');
    // });
};
