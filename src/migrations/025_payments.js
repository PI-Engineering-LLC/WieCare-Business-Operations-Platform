exports.up = (knex) => knex.schema.createTable('payments', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('invoice_id').references('id').inTable('invoices').onDelete('CASCADE');
    t.uuid('client_id').notNullable().references('id').inTable('clients').onDelete('CASCADE');
    t.decimal('amount', 12, 2).notNullable();
    t.string('link');
    t.jsonb('raw_response');
    t.string('currency').defaultTo('USD');
    t.string('method').notNullable();
    t.string('status').defaultTo('pending');
    t.string('transactionReferenceId');
    t.string('reference').notNullable();
    t.uuid('recorded_by').references('id').inTable('users')
    t.text('notes');
    t.specificType('paid_at', 'TIMESTAMPTZ');
    t.index(['client_id'])
    t.index(['invoice_id'])
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.timestamp('updated_at').defaultTo(knex.fn.now());
    t.check(`method IN ('ipospays','ach','credit_card','debit_card',
                    'cash','check','wire','phone','online')`, [], 'payments_method_check');
    t.check(`status IN ('pending','completed','failed','refunded', 'orphan')`, [], 'payments_status_check');
  });
  exports.down = (knex) => knex.schema.dropTable('payments');