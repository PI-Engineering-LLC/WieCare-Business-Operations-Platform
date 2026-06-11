
exports.up = async function(knex) {
  await knex.schema.createTable('role_permissions', (table) => {
    table.uuid('role_id').references('id').inTable('roles').onDelete('CASCADE');
    table.uuid('permission_id').references('id').inTable('permissions').onDelete('CASCADE');
    
    table.primary(['role_id', 'permission_id']);
    table.index(['role_id']);       // FK index
    table.index(['permission_id']); // FK index
  });

};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('role_permissions');
};