exports.up = function(knex) {
    return knex.schema.createTable('roles', function(table) {
        table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
        table.uuid('client_id').references('id').inTable('clients').onDelete('CASCADE');
        table.string('name').unique().notNullable();
        table.string('description')
        table.boolean('is_system').defaultTo(false);
        table.timestamp('created_at').defaultTo(knex.fn.now());
        table.timestamp('updated_at').defaultTo(knex.fn.now());
        table.index(['client_id']);
    });
};

exports.down = function(knex) {
    return knex.schema.dropTable('roles');
};