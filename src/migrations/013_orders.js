exports.up = async (knex) => {
    await knex.schema.createTable('orders', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.string('order_number');
      t.uuid('client_id').notNullable().references('id').inTable('clients').onDelete('CASCADE');;
      t.string('client_name');
      t.uuid('quote_id').references('id').inTable('quotes').onDelete('CASCADE');;
      t.string('title').notNullable();
      t.text('description');
      t.jsonb('items').defaultTo('[]');
      t.decimal('total_amount', 12, 2).defaultTo(0);
      t.string('currency').defaultTo('USD');
      t.string('status').defaultTo('pending');
      t.boolean('is_split').defaultTo(false);
      t.string('tracking_number');
      t.text('notes');
      t.uuid('created_by').references('id').inTable('users').onDelete('CASCADE');;
      t.timestamp('created_at').defaultTo(knex.fn.now());
      t.timestamp('updated_at').defaultTo(knex.fn.now());
    });
    await knex.schema.createTable('sub_orders', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.string('sub_order_number');
      t.uuid('parent_order_id').notNullable().references('id').inTable('orders').onDelete('CASCADE');;
      t.uuid('client_id').notNullable().references('id').inTable('clients').onDelete('CASCADE');;
      t.string('client_name');
      t.string('supplier_entity');
      t.jsonb('items').defaultTo('[]');
      t.decimal('total_amount', 12, 2).defaultTo(0);
      t.string('status').defaultTo('awaiting_invoice');
      t.uuid('invoice_id');
      t.string('tracking_number');
      t.date('estimated_delivery');
      t.text('notes');
      t.text('admin_notes');
      t.timestamp('created_at').defaultTo(knex.fn.now());
      t.timestamp('updated_at').defaultTo(knex.fn.now());
    });
  };
  exports.down = async (knex) => {
    await knex.schema.dropTable('sub_orders');
    await knex.schema.dropTable('orders');
  };