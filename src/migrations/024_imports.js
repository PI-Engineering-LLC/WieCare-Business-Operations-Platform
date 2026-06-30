
exports.up = async function(knex) {
  await knex.schema.createTable('imports', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('client_id').references('id').inTable('clients').onDelete('SET NULL');
    table.string('file_url').notNullable();
    table.string('status').defaultTo('pending'); // pending | processing | completed | failed
    table.integer('total_rows').defaultTo(0);
    table.integer('processed_rows').defaultTo(0);
    table.integer('failed_rows').defaultTo(0);
    table.jsonb('errors').defaultTo('[]');
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('imports');
};