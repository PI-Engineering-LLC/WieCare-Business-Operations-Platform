exports.up = (knex) => knex.schema.createTable('departments', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('name').notNullable();
    t.string('code')
    t.string('logo_url');
    t.boolean('allows_online_payment').defaultTo(true);
    t.string('wire_transfer_instructions');
    t.string('contact_name');
    t.string('contact_email');
    t.string('contact_phone');
    t.string('address');
    t.string('city');
    t.string('state');
    t.string('zip_code');
    t.string('country');
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.timestamp('updated_at').defaultTo(knex.fn.now());
  });
  exports.down = (knex) => knex.schema.dropTable('departments');