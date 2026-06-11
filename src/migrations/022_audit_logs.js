exports.up = (knex) => knex.schema.createTable('audit_logs', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('user_id').references('id').inTable('users').onDelete('SET NULL');
    table.uuid('client_id');
    table.string('action').notNullable();
    table.string('resource_type').notNullable();
    table.uuid('resource_id');
    table.jsonb('metadata');
    table.string('ip_address').notNullable();
    table.string('user_agent').notNullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());
  });


/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = (knex) => knex.schema.dropTable('audit_logs');
