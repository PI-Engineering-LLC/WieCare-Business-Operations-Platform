exports.up = (knex) => knex.schema.createTable('quotes', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('quote_number');
    t.uuid('client_id').notNullable().references('id').inTable('clients').onDelete('CASCADE');;
    t.string('client_name');
    t.uuid('department_id').references('id').inTable('departments').onDelete('CASCADE');;
    t.enu('sending_entity', ['Wiegand Sports Gmbh', 'Wiegand Services LLC'])
    t.string('title').notNullable();
    t.text('description');
    t.uuid('maintenance_request_id').references('id').inTable('maintenance_requests').onDelete('CASCADE');;
    t.uuid('training_request_id').references('id').inTable('training_requests').onDelete('CASCADE');;
    t.string('type')
    t.jsonb('items').defaultTo('[]');
    t.decimal('subtotal', 12, 2).defaultTo(0);
    t.decimal('discount_percent', 5, 2).defaultTo(0);
    t.decimal('packing', 12, 2).defaultTo(0);
    t.decimal('export_declaration', 12, 2).defaultTo(0);
    t.decimal('tax_rate', 5, 2).defaultTo(0);
    t.decimal('tax_amount', 12, 2).defaultTo(0);
    t.decimal('total_amount', 12, 2).defaultTo(0);
    t.string('currency').defaultTo('USD');
    t.string('status').defaultTo('draft');
    t.date('valid_until');
    t.text('notes');
    t.string('pdf_storage_key');
    t.uuid('converted_to_order_id');
    t.uuid('created_by').references('id').inTable('users').onDelete('CASCADE');;
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.timestamp('updated_at').defaultTo(knex.fn.now());
  });
  exports.down = (knex) => knex.schema.dropTable('quotes');