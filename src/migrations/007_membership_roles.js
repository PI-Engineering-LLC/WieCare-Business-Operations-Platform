
exports.up = async function(knex) {
  await knex.schema.createTable('membership_roles', (table) => {
    table.uuid('membership_id').notNullable().references('id').inTable('client_memberships').onDelete('CASCADE');
    table.uuid('role_id').notNullable().references('id').inTable('roles').onDelete('CASCADE');
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
    table.primary(['membership_id', 'role_id']);
    table.index(['membership_id']); // FK index
    table.index(['role_id']);       // FK index
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('membership_roles');
};