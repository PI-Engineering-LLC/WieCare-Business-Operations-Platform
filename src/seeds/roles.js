
require('dotenv').config();
const db = require('../db');

const seedRoles = async () => {
    try {
        await db.raw('SELECT 1');
        console.log('✓ Database connection verified for roles seeding.');

        // Clean up existing data for a fresh seed
        await db('membership_roles').del(); // Use db instead of knex
        await db('role_permissions').del();
        await db('roles').del();
        await db('permissions').del();

        // --- Insert Permissions using resource/action ---
        const initialPermissions = [
            { resource: 'client', action: 'users.view' },
            { resource: 'client', action: 'users.invite' },
            { resource: 'client', action: 'users.edit' },
            { resource: 'platform', action: 'users.view' },
            { resource: 'warranty', action: 'view' },
            { resource: 'warranty', action: 'manage' },
            { resource: 'warranty', action: 'edit' },
            { resource: 'settings', action: 'manage' },
            { resource: 'roles', action: 'manage' },
        ];

        await db('permissions') // Use db instead of knex
            .insert(initialPermissions)
            .onConflict(['resource', 'action'])
            .ignore();

        const permissions = await db('permissions').select('id', 'resource', 'action'); // Use db
        const permissionMap = new Map(permissions.map(p => [`${p.resource}:${p.action}`, p.id]));

        // --- Insert Roles ---
        const [clientAdmin] = await db('roles') // Use db
            .insert({ name: 'client_admin', is_system: true })
            .onConflict('name')
            .ignore()
            .returning('*');

        const [generalUser] = await db('roles') // Use db
            .insert({ name: 'general_user', is_system: true })
            .onConflict('name')
            .ignore()
            .returning('*');

        const [platformAdmin] = await db('roles') // Use db
            .insert({ name: 'platform_admin', is_system: true })
            .onConflict('name')
            .ignore()
            .returning('*');

        const [superAdmin] = await db('roles') // Use db
            .insert({ name: 'super_admin', is_system: true })
            .onConflict('name')
            .ignore()
            .returning('*');

        // --- Assign Permissions to Roles ---
        const rolePermissionsToInsert = [];

        // Client Admin permissions
        if (clientAdmin) {
            rolePermissionsToInsert.push(
                { role_id: clientAdmin.id, permission_id: permissionMap.get('client:users.view') },
                { role_id: clientAdmin.id, permission_id: permissionMap.get('client:users.invite') },
                { role_id: clientAdmin.id, permission_id: permissionMap.get('client:users.edit') },
                { role_id: clientAdmin.id, permission_id: permissionMap.get('warranty:view') },
                { role_id: clientAdmin.id, permission_id: permissionMap.get('warranty:manage') },
                { role_id: clientAdmin.id, permission_id: permissionMap.get('settings:manage') }
            );
        }

        // General User permissions
        if (generalUser) {
            rolePermissionsToInsert.push(
                { role_id: generalUser.id, permission_id: permissionMap.get('client:users.view') },
                { role_id: generalUser.id, permission_id: permissionMap.get('warranty:view') }
            );
        }

        // Platform Admin permissions
        if (platformAdmin) {
            rolePermissionsToInsert.push(
                { role_id: platformAdmin.id, permission_id: permissionMap.get('platform:users.view') },
                { role_id: platformAdmin.id, permission_id: permissionMap.get('roles:manage') },
                { role_id: platformAdmin.id, permission_id: permissionMap.get('settings:manage') }
            );
        }
        // Super Admin permissions
        if (superAdmin) {
            permissions.forEach(p => {
                rolePermissionsToInsert.push({ role_id: superAdmin.id, permission_id: p.id });
            });
        }

        const validRolePermissions = rolePermissionsToInsert.filter(rp => rp.permission_id);

        if (validRolePermissions.length > 0) {
            await db('role_permissions') // Use db
                .insert(validRolePermissions)
                .onConflict(['role_id', 'permission_id'])
                .ignore();
        }

        console.log('Roles seeding completed.');
        process.exit(0);

    } catch (err) {
        console.error("Error during roles seeding:", err);
        process.exit(1);
    } finally {
        await db.destroy();
        console.log('Database connection pool destroyed after roles seeding.');
    }
};

seedRoles();
module.exports = seedRoles;
