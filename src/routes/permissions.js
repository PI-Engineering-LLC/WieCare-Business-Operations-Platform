
const router = require('express').Router();
const db = require('../db');
const requireAuth = require('../middleware/auth');
const loadContext = require('../middleware/loadContext');
const adminOnly = require('../middleware/adminOnly'); // Use adminOnly for global permissions management
const asyncHandler = require('../middleware/asyncHandler');
const auditMiddleware = require('../middleware/auditMiddleware');
const permissionCache = require('../lib/permissionsCache'); // Import cache instance

// POST /api/permissions
router.post(
  '/',
  requireAuth,
  loadContext,
  adminOnly, // Only internal/platform admins should create new global permissions
  auditMiddleware({ action: 'permission.created', resourceType: 'permission' }),
  asyncHandler(async (req, res) => {
    const { resource, action, description } = req.body; // Expect resource and action

    if (!resource || !action) {
      return res.status(400).json({ error: 'Resource and action are required to create a permission.' });
    }

    const [permission] = await db('permissions')
      .insert({ resource, action, description, created_at: new Date(), updated_at: new Date() })
      .returning('*');

    // --- Cache Invalidation ---
    permissionCache.flushAll(); // New permission could potentially affect any role, thus all users
    console.log(`Flushed ALL permission cache entries due to new permission '${resource}:${action}' being created.`);

    res.status(201).json(permission);
  })
);

// GET /api/permissions
router.get('/', requireAuth, loadContext, adminOnly, // Only internal/platform admins should list all global permissions
  asyncHandler(async (req, res) => {
    let q = db('permissions').orderBy(['resource', 'action']);

    if (req.query.id) {
      const permission = await q.where({ id: req.query.id }).first();
      if (!permission) return res.status(404).json({ error: 'Permission not found' });
      return res.json(permission);
    }
    // Filter by resource or action if needed
    if (req.query.resource) q.whereILike('resource', `%${req.query.resource}%`);
    if (req.query.action) q.whereILike('action', `%${req.query.action}%`);

    const permissions = await q;
    res.json(permissions);
  })
);

// PATCH /api/permissions/:id  (admin only)
router.patch('/:id', requireAuth,loadContext, adminOnly,
  auditMiddleware({action: 'permissions.updated', resourceType:'permissions'}),
  asyncHandler( async (req, res) => {
    const { resource, action, description } = req.body;
    const updates = { updated_at: new Date() };
    if (resource) updates.resource = resource;
    if (action) updates.action = action;
    if (description) updates.description = description;

    const [permission] = await db('permissions').where({ id: req.params.id }).update(updates).returning('*');
    if (!permission) return res.status(404).json({ error: 'Permission not found' });

    // --- Cache Invalidation ---
    permissionCache.flushAll(); // A change to a permission affects all roles/users that have it
    console.log(`Flushed ALL permission cache entries due to permission ${req.params.id} being updated.`);

    res.json(permission);
}));

// DELETE /api/permissions/:id (admin only)
router.delete('/:id', requireAuth, loadContext, adminOnly,
  auditMiddleware({action: 'permission.deleted', resourceType:'permission'}),
  asyncHandler(async (req, res) => {
    const permission_id_to_delete = req.params.id;
    const permission = await db('permissions').where({ id: permission_id_to_delete }).first();
    if (!permission) return res.status(404).json({ error: 'Permission not found.' });

    // Check if permission is in use by any role
    const inUse = await db('role_permissions').where({ permission_id: permission_id_to_delete }).first();
    if (inUse) {
        return res.status(409).json({ error: 'Permission is currently assigned to roles. Unassign before deleting.' });
    }

    const deletedCount = await db('permissions').where({ id: permission_id_to_delete }).del();
    if (deletedCount === 0) return res.status(404).json({ error: 'Permission not found' });

    // --- Cache Invalidation ---
    permissionCache.flushAll(); // Deleting a permission affects all roles/users that had it
    console.log(`Flushed ALL permission cache entries due to permission ${permission_id_to_delete} being deleted.`);

    res.json({ message: 'Permission deleted successfully.' });
}));


module.exports = router;