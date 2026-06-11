
exports.up = async function(knex) {
  await knex.schema.createTable('invites', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('email').notNullable();
    table.uuid('invited_by').references('id').inTable('users').onDelete('SET NULL');
    table.uuid('client_id').references('id').inTable('clients').onDelete('CASCADE');
    table.jsonb('role_ids').defaultTo('[]');
    table.string('platform_role');
    table.string('invite_type')  // platform || client
    table.string('auth_provider'); // local | google | any
    table.string('invite_token').notNullable();
    table.string('token_selector').unique().notNullable();
    table.timestamp('invite_expires_at').notNullable();
    table.timestamp('accepted_at');
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
    table.index(['invited_by']); // FK index
    table.index(['client_id']);  // FK index
    table.index(['token_selector']); // Often queried, good for performance
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('invites');
};