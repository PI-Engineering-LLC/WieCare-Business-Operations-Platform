exports.up = async (knex) => {
    await knex.schema.createTable('courses', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.string('title').notNullable();
      t.text('description');
      t.string('category').defaultTo('operations');
      t.string('thumbnail_storage_key');
      t.string('video_storage_key');
      t.integer('duration_minutes');
      t.string('difficulty_level').defaultTo('beginner');
      t.boolean('is_mandatory').defaultTo(false);
      t.integer('order_index').defaultTo(0);
      t.string('status').defaultTo('draft');
      t.timestamp('created_at').defaultTo(knex.fn.now());
      t.timestamp('updated_at').defaultTo(knex.fn.now());
    });
    await knex.schema.createTable('course_progress', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('course_id').notNullable().references('id').inTable('courses').onDelete('CASCADE');;
      t.string('course_title');
      t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');;
      t.string('user_email');
      t.uuid('client_id').references('id').inTable('clients').onDelete('CASCADE');;
      t.integer('progress_percent').defaultTo(0);
      t.integer('watch_time_seconds').defaultTo(0);
      t.string('status').defaultTo('not_started');
      t.timestamp('started_at');
      t.timestamp('completed_at');
      t.timestamp('last_watched_at');
      t.timestamp('created_at').defaultTo(knex.fn.now());
      t.timestamp('updated_at').defaultTo(knex.fn.now());
      t.unique(['course_id', 'user_id']);
    });
  };
  exports.down = async (knex) => {
    await knex.schema.dropTable('course_progress');
    await knex.schema.dropTable('courses');
  };