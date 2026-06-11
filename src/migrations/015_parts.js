exports.up = async (knex) => {
    await knex.schema.createTable('parts', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.string('part_number').unique().notNullable();
      t.string('ez_number');
      t.string('name').notNullable();
      t.text('description');
      t.string('category').defaultTo('general');
      t.decimal('unit_price', 12, 2);
      t.string('currency').defaultTo('USD');
      t.integer('stock_quantity').defaultTo(0);
      t.integer('min_stock_level').defaultTo(5);
      t.string('image_storage_key');
      t.text('specifications');
      t.boolean('is_critical').defaultTo(false);
      t.string('status').defaultTo('active');
      t.timestamp('created_at').defaultTo(knex.fn.now());
      t.timestamp('updated_at').defaultTo(knex.fn.now());
    });
    await knex.schema.createTable('part_orders', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.string('order_number');
      t.uuid('client_id').notNullable().references('id').inTable('clients').onDelete('CASCADE');;
      t.string('client_name');
      t.string('po_number');
      t.jsonb('items').defaultTo('[]');
      t.decimal('total_amount', 12, 2).defaultTo(0);
      t.string('currency').defaultTo('USD');
      t.string('status').defaultTo('pending');
      t.text('notes');
      t.text('admin_notes');
      t.date('estimated_delivery');
      t.string('tracking_number');
      t.uuid('created_by').references('id').inTable('users').onDelete('CASCADE');;
      t.timestamp('created_at').defaultTo(knex.fn.now());
      t.timestamp('updated_at').defaultTo(knex.fn.now());
    });
  };
  exports.down = async (knex) => {
    await knex.schema.dropTable('part_orders');
    await knex.schema.dropTable('parts');
  };