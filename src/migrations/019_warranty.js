exports.up = (knex) => knex.schema.createTable('warranty_claims', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('claim_number');
    t.uuid('client_id').notNullable().references('id').inTable('clients').onDelete('CASCADE');;
    t.string('client_name');
    t.string('equipment_info').notNullable();
    t.date('purchase_date');
    t.text('issue_description').notNullable();
    t.jsonb('images').defaultTo('[]');
    t.string('status').defaultTo('pending');
    t.text('admin_notes');
    t.text('resolution');
    t.date('resolved_date');
    t.uuid('created_by').references('id').inTable('users').onDelete('CASCADE');
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.timestamp('updated_at').defaultTo(knex.fn.now());
  });
  exports.down = (knex) => knex.schema.dropTable('warranty_claims');