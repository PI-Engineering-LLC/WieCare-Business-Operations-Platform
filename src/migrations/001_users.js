exports.up = (knex) => knex.schema.createTable('users', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('email').unique().notNullable();
    t.string('password_hash');
    t.string('google_id').unique();
    t.string('full_name');
    t.string('phone');
    t.string('job_title');
    t.string('avatar_storage_key');
    t.string('platform_role').defaultTo(null);           // 'super_admin' | 'platform_admin' | 'internal_admin' | 'internal_user'| null for customer users
    t.string('status').defaultTo('active');
    t.boolean('is_verified').defaultTo(false);
    t.boolean('mfa_enabled').defaultTo(false);
    t.string('mfa_secret');
    t.jsonb('mfa_backup_codes').defaultTo('[]');
    t.boolean('force_password_reset').defaultTo(false);
    // Notification preferences (stored as booleans)
    t.boolean('notif_invoice').defaultTo(true);
    t.boolean('notif_maintenance').defaultTo(true);
    t.boolean('notif_training').defaultTo(true);
    t.boolean('notif_order').defaultTo(true);
    t.boolean('notif_email').defaultTo(true);
    t.timestamp('deleted_at');
    t.timestamp('last_login_at');
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.timestamp('updated_at').defaultTo(knex.fn.now());
  });
  exports.down = (knex) => knex.schema.dropTable('users');