/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  //t.uuid('client_id').notNullable().references('id').inTable('clients').onDelete('CASCADE');;
//   return knex.schema.alterTable('training_sessions', function(table) {
//     table.uuid('client_id').notNullable().references('id').inTable('clients').onDelete('CASCADE');
// });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
    // return knex.schema.alterTable('training_sessions', function(table) {
    //     table.dropColumn('client_id');
    // });
};
