exports.up = function(knex) {
    return knex.schema.createTable('permissions', function(table) {
        table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
        table.string('resource');
        table.string('action');
        table.string('description')
        table.unique(['resource', 'action'])     
    });
};

exports.down = function(knex) {
    return knex.schema.dropTable('permissions');
};