exports.up = (knex) => knex.schema.createTable('notifications', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('recipient_id').references('id').inTable('users').onDelete('CASCADE');
    t.string('recipient_email');
    t.uuid('client_id').references('id').inTable('clients').onDelete('CASCADE');;
    t.string('title').notNullable();
    t.text('message').notNullable();
    t.string('type').defaultTo('info');
    t.string('category').defaultTo('general');
    t.string('link');
    t.uuid('resource_id')
    t.string('resource_type')
    t.boolean('is_read').defaultTo(false);
    t.boolean('is_email_sent').defaultTo(false);
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.timestamp('updated_at').defaultTo(knex.fn.now());
  });
  exports.down = (knex) => knex.schema.dropTable('notifications');