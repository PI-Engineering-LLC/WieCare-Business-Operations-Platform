const db = require('../db');

/**
 * Resolve all permissions for a user in a specific client context.
 * Returns Set of "resource:action" strings.
 */
async function resolvePermissions(userId, clientId = null) {
  const user = await db('users').where({ id: userId }).first();
  if (!user) return new Set();

  // ─── Super Admin: ALL permissions ───
  if (user.platform_role === 'super_admin') {
    const allPerms = await db('permissions').select('resource', 'action');
    return new Set(allPerms.map(p => `${p.resource}:${p.action}`));
  }

  // ─── Internal Admin: nearly all permissions ───
  // This logic is specific to your application's definition of internal_admin
  if (user.platform_role === 'internal_admin') {
    const allPerms = await db('permissions')
      .whereNot('action', 'delete')              // admins can't hard-delete (example restriction)
      .select('resource', 'action');
    const canDelete = await db('permissions')
      .whereIn('resource', ['offers', 'documents']) // Specific resources they can delete
      .where('action', 'delete')
      .select('resource', 'action');
    return new Set([
      ...allPerms.map(p => `${p.resource}:${p.action}`),
      ...canDelete.map(p => `${p.resource}:${p.action}`),
    ]);
  }

  const permissions = new Set();

  if (clientId) {
    // --- REVISED JOIN FOR CLIENT-SCOPED PERMISSIONS ---
    const clientRolePerms = await db('client_memberships as cm')
      .join('membership_roles as mr', 'mr.membership_id', 'cm.id')
      .join('roles as r', 'r.id', 'mr.role_id')
      .join('role_permissions as rp', 'rp.role_id', 'r.id')
      .join('permissions as p', 'p.id', 'rp.permission_id')
      .where({ 'cm.user_id': userId, 'cm.client_id': clientId, 'cm.is_active': true })
      .select('p.resource', 'p.action');

    clientRolePerms.forEach(p => permissions.add(`${p.resource}:${p.action}`));
  }

  // Add platform-wide roles if any user has platform-level roles
  // (e.g., a "viewer" role that is not tied to a specific client_membership)
  // This depends on whether you have roles directly linked to users without memberships
  // Example: if a user can have a global 'platform_viewer' role
  if (user.platform_role && user.platform_role !== 'user') { // Assuming 'user' is default and has no special permissions
    const platformRoles = await db('roles')
        .where({name: user.platform_role, tenant_id: null}) // Assuming platform roles are not client-scoped
        .first();
    if (platformRoles) {
        const platformPermissions = await db('role_permissions as rp')
            .join('permissions as p', 'p.id', 'rp.permission_id')
            .where('rp.role_id', platformRoles.id)
            .select('p.resource', 'p.action');
        platformPermissions.forEach(p => permissions.add(`${p.resource}:${p.action}`));
    }
  }


  return permissions;
}

/**
 * Check if user has a specific permission
 */
async function hasPermission(userId, clientId, resource, action) {
  const perms = await resolvePermissions(userId, clientId);
  return perms.has(`${resource}:${action}`);
}

/**
 * Check if user is internal (super_admin or internal_admin)
 */
function isInternalUser(user) {
  return ['super_admin', 'internal_admin', 'internal_user'].includes(user.platform_role);
}

module.exports = { resolvePermissions, hasPermission, isInternalUser };