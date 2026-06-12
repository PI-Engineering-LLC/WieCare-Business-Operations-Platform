const router = require('express').Router();
const db = require('../db');
const requireAuth = require('../middleware/auth');
const loadContext = require('../middleware/loadContext');
const adminOnly = require('../middleware/adminOnly');
const asyncHandler = require('../middleware/asyncHandler');
const auditMiddleware = require('../middleware/auditMiddleware');
const permissionCache = require('../lib/permissionsCache'); // Import cache instance
const resolveClientContext = require('../middleware/resolveClientContext');

// POST /api/roles
router.post(
  '/',
  requireAuth,
  loadContext,
  adminOnly, // Only internal/platform admins can create roles
  auditMiddleware({ action: 'role.created', resourceType: 'role' }),
  asyncHandler(async (req, res) => {
    const { name, description, is_system = false } = req.body; // Added description and is_system

    if (!name) {
      return res.status(400).json({ error: 'Role name is required.' });
    }

    const [role] = await db('roles')
      .insert({ name, description, is_system, created_at: new Date(), updated_at: new Date() })
      .returning('*');

    // --- Cache Invalidation ---
    permissionCache.flushAll(); // A new role can affect existing users if assigned
    console.log(`Flushed ALL permission cache entries due to new role '${name}' being created.`);

    res.status(201).json(role);
  })
);

// GET /api/roles
router.get('/', requireAuth, loadContext, resolveClientContext, // Only internal/platform/client admins can list/manage roles
  asyncHandler( async (req, res) => {
  let q = db('roles')
    .leftJoin('role_permissions as rp', 'rp.role_id', 'roles.id')
    .leftJoin('permissions as p', 'p.id', 'rp.permission_id')
    .select([
      'roles.id',
      'roles.name',
      'roles.description',
      'roles.is_system',
      'roles.created_at',
      'roles.updated_at',
      db.raw('ARRAY_AGG(DISTINCT p.id) FILTER (WHERE p.id IS NOT NULL) as permission_ids'), // Aggregate permission IDs
      db.raw('ARRAY_AGG(DISTINCT CONCAT(p.resource, \':\', p.action)) FILTER (WHERE p.resource IS NOT NULL) as permissions_raw') // Aggregate resource:action strings
    ])
    .groupBy('roles.id', 'roles.name', 'roles.description', 'roles.is_system', 'roles.created_at', 'roles.updated_at')
    .orderBy('roles.name');

    if(!req.user.platform_role){
      const assignableGlobalRoleNames = ['client_admin', 'general_user'];

      const rolesClient = await db('roles')
        .whereNull('client_id') // Ensure they are global/system roles
        .whereIn('name', assignableGlobalRoleNames) // Filter by the allowed names
        .select('id', 'name', 'description') // Select relevant fields
        .orderBy('name');
        return res.json(rolesClient);
    }

  // Filter by ID if requested
  if (req.query.id) {
    const role = await q.where({ 'roles.id': req.query.id }).first();
    if (!role) return res.status(404).json({ error: 'Role not found' });
    return res.json(role);
  }

  const roles = await q;
  res.json(roles);
}));

// PUT /api/roles/:id/permissions (Set all permissions for a role)
router.put('/:id/permissions',
  requireAuth,
  loadContext,
  adminOnly, // Only internal/platform admins can manage role permissions
  auditMiddleware({action: 'role.permissions.updated', resourceType:'role'}),
  asyncHandler(async (req, res) => {
    const { permissionIds = [] } = req.body;
    const { id: role_id } = req.params;

    const role = await db('roles').where({ id: role_id }).first();
    if (!role) return res.status(404).json({ error: 'Role not found.' });

    // Validate all permission IDs exist (optional, but good practice)
    if (permissionIds.length > 0) {
      const existingPermissions = await db('permissions').whereIn('id', permissionIds).pluck('id');
      const missingPermissions = permissionIds.filter(pid => !existingPermissions.includes(pid));
      if (missingPermissions.length > 0) {
        return res.status(400).json({ error: `Invalid permission IDs: ${missingPermissions.join(', ')}` });
      }
    }

    // Replace permissions atomically
    await db.transaction(async (trx) => {
      await trx('role_permissions').where({ role_id }).delete();
      if (permissionIds.length > 0) {
        const inserts = permissionIds.map(permission_id => ({ role_id, permission_id }));
        await trx('role_permissions').insert(inserts);
      }
    });

    // --- Cache Invalidation ---
    permissionCache.flushAll(); // A change to role permissions affects all users assigned to this role
    console.log(`Flushed ALL permission cache entries due to role ${role_id} permissions being updated.`);

    res.json({ message: 'Role permissions updated.', role_id, permission_ids: permissionIds });
}));


// PATCH /api/roles/:id (Update role name/description)
router.patch('/:id',
  requireAuth,
  loadContext,
  adminOnly, // Only internal/platform admins can update roles
  auditMiddleware({action: 'role.updated', resourceType:'role'}),
  asyncHandler( async (req, res) => {
  const [role] = await db('roles').where({ id: req.params.id }).update({ ...req.body, updated_at: new Date() }).returning('*');
  if (!role) return res.status(404).json({ error: 'Role not found.' });

  // --- Cache Invalidation ---
  permissionCache.flushAll(); // A change to role name/description might affect UI or context
  console.log(`Flushed ALL permission cache entries due to role ${role.id} being updated.`);

  res.json(role);
}));

// DELETE /api/roles/:id
router.delete('/:id',
  requireAuth,
  loadContext,
  adminOnly, // Only internal/platform admins can delete roles
  auditMiddleware({action: 'role.deleted', resourceType:'role'}),
  asyncHandler(async (req, res) => {
    const role_id_to_delete = req.params.id;
    const role = await db('roles').where({ id: role_id_to_delete }).first();
    if (!role) return res.status(404).json({ error: 'Role not found.' });

    if (role.is_system) {
        return res.status(403).json({ error: 'Cannot delete system roles.' });
    }

    // Check if role is in use
    const inUse = await db('membership_roles').where({ role_id: role_id_to_delete }).first();
    if (inUse) {
        return res.status(409).json({ error: 'Role is currently assigned to users. Unassign before deleting.' });
    }

    await db('roles').where({ id: role_id_to_delete }).delete();

    // --- Cache Invalidation ---
    permissionCache.flushAll(); // Deleting a role affects all users who had it
    console.log(`Flushed ALL permission cache entries due to role ${role_id_to_delete} being deleted.`);

    res.json({ message: 'Role deleted successfully.' });
}));


module.exports = router;
