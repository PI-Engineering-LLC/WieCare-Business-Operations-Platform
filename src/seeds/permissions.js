require('dotenv').config();
const db = require('../db'); // Use the direct db import

const seedPermissions = async () => {
    try {
        await db.raw('SELECT 1');
        console.log('✓ Database connection verified for permissions seeding.');

        await db('permissions').del(); // Use db instead of knex

        await db('permissions').insert([ // Use db instead of knex
            { resource: 'client', action: 'users.view' },
            { resource: 'client', action: 'users.invite' },
            { resource: 'client', action: 'users.edit' },
            { resource: 'platform', action: 'users.view' },
            { resource: 'warranty', action: 'view' },
            { resource: 'warranty', action: 'manage' },
            { resource: 'warranty', action: 'edit' },
            { resource: 'settings', action: 'manage' },
            { resource: 'roles', action: 'manage' },
            { resource: 'permissions', action: 'manage' },
        ])
        .onConflict(['resource', 'action'])
        .ignore();

        console.log('Permissions seeding completed.');
        process.exit(0);

    } catch (err) {
        console.error("Error during permissions seeding:", err);
        process.exit(1);
    } finally {
        await db.destroy();
        console.log('Database connection pool destroyed after permissions seeding.');
    }
};

seedPermissions();
module.exports = seedPermissions;
