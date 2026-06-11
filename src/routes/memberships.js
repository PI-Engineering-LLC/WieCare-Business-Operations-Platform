const router = require('express').Router();
const db = require('../db');
const requireAuth = require('../middleware/auth');
const loadContext = require('../middleware/loadContext');
const resolveClientContext = require('../middleware/resolveClientContext'); // Used for generic client context
const asyncHandler = require('../middleware/asyncHandler');
const requireRoles = require('../middleware/roles'); // Added
const permissionCache = require('../lib/permissionsCache'); // Import cache instance

// GET /api/client_memberships
router.get('/', requireAuth, loadContext, requireRoles(['client_admin', 'super_admin', 'platform_admin']),
  asyncHandler( async (req, res) => {
  let q  =  db('client_memberships as cm')
    .leftJoin('clients as c', 'c.id', 'cm.client_id') // Join to get client details
    .leftJoin('membership_roles as mr', 'mr.membership_id', 'cm.id')
    .leftJoin('roles as r', 'r.id', 'mr.role_id')
    .select([
      'cm.id', 'cm.user_id', 'cm.client_id', 'cm.is_active', 'cm.created_at', 'cm.updated_at',
      'c.company_name', 'c.coaster_name', 'c.on_hold', // Select client details
      db.raw(`
        COALESCE(
          json_agg(json_build_object('id', r.id, 'name', r.name)) FILTER (WHERE r.id IS NOT NULL),
          '[]'::jsonb
        ) as roles
      `)
    ])
    .groupBy(
      'cm.id', 'cm.user_id', 'cm.client_id', 'cm.is_active', 'cm.created_at', 'cm.updated_at',
      'c.company_name', 'c.coaster_name', 'c.on_hold'
    );

    // Filter by client_id if provided
    if (req.query.client_id) {
        q.where({ 'cm.client_id': req.query.client_id });
    }

    // Filter by membership ID if provided (for fetching a single membership)
    if (req.query.id) {
        q.where({ 'cm.id': req.query.id });
    }

    // Apply tenant isolation logic for non-admin users
    if (req.user && !req.user.isInternalAdmin && req.membership && req.membership.clientId) {
      q.where('cm.client_id', req.membership.clientId);
    }


    const result = await q;

    // Handle single result vs. list
    if (req.query.id) {
        if (!result || result.length === 0) return res.status(404).json({ error: 'Membership not found' });
        res.json(result[0]); // Return the first matching membership
    } else {
        res.json(result); // Return the list of memberships
    }
}));

// POST /api/client_memberships - Add a user to a client
router.post('/', requireAuth, loadContext, requireRoles(['super_admin', 'platform_admin', 'client_admin']), // Admin role needed to create memberships
  asyncHandler(async (req, res) => {
    const { user_id, client_id, role_ids = [] } = req.body;

    // Validate user and client exist
    const userExists = await db('users').where({ id: user_id, deleted_at: null }).first();
    if (!userExists) return res.status(404).json({ error: 'User not found.' });
    const clientExists = await db('clients').where({ id: client_id }).first();
    if (!clientExists) return res.status(404).json({ error: 'Client not found.' });

    // For client_admin, ensure they can only add users to their own client
    if (req.user && !req.user.isInternalAdmin && req.membership && req.membership.clientId !== client_id) {
        return res.status(403).json({ error: 'Forbidden: Client admins can only manage memberships in their own client.' });
    }

    const [membership] = await db('client_memberships')
      .insert({ user_id, client_id, is_active: true, created_at: new Date(), updated_at: new Date() })
      .onConflict(['user_id', 'client_id'])
      .merge({ is_active: true, updated_at: new Date() })
      .returning('*');

    if (role_ids.length > 0) {
      const inserts = role_ids.map(role_id => ({ membership_id: membership.id, role_id }));
      await db('membership_roles').insert(inserts);
    }
    permissionCache.del(`user_client_permissions:${user_id}`); // Invalidate cache for the affected user
    res.status(201).json(membership);
  })
);

// DELETE /api/client_memberships/:id - Remove a membership (and cascade roles)
router.delete('/:id', requireAuth, loadContext, requireRoles(['super_admin', 'platform_admin', 'client_admin']), // Admin role needed to delete memberships
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const membership = await db('client_memberships').where({ id }).first();
    if (!membership) return res.status(404).json({ error: 'Membership not found' });

    // For client_admin, ensure they can only delete memberships in their own client
    if (req.user && !req.user.isInternalAdmin && req.membership && req.membership.clientId !== membership.client_id) {
        return res.status(403).json({ error: 'Forbidden: Client admins can only manage memberships in their own client.' });
    }

    const deletedCount = await db('client_memberships').where({ id }).del();
    if (deletedCount === 0) return res.status(404).json({ error: 'Membership not found' });

    permissionCache.del(`user_client_permissions:${membership.user_id}`); // Invalidate cache for the affected user
    res.json({ message: 'Membership deleted successfully.' });
  })
);

module.exports = router;
// const router = require('express').Router();
// const db = require('../db');
// const requireAuth = require('../middleware/auth');
// const loadContext = require('../middleware/loadContext');
// // const clientContext = require('../middleware/clientContext'); // Redundant?
// const resolveClientContext = require('../middleware/resolveClientContext');
// // const adminOnly = require('../middleware/adminOnly'); // Redundant?
// const clientScope = require('../middleware/clientScope'); // Is this still applicable directly?
// const asyncHandler = require('../middleware/asyncHandler');
// const auditMiddleware = require('../middleware/auditMiddleware'); // Not used

// // GET /api/client_memberships
// router.get('/', requireAuth,loadContext, resolveClientContext,
//   asyncHandler( async (req, res) => {
//   let q  =  db('client_memberships as cm')
//     // If you need roles/permissions, uncomment and adjust the joins here:
//     .leftJoin('membership_roles as mr', 'mr.membership_id', 'cm.id')
//     .leftJoin('roles as r', 'r.id', 'mr.role_id')
//     // .leftJoin('role_permissions as rp', 'rp.role_id', 'r.id')
//     // .leftJoin('permissions as p', 'p.id', 'rp.permission_id')
//     .select([
//       'cm.id', 'cm.user_id', 'cm.client_id', 'cm.company_name', 'cm.coaster_name', 'cm.on_hold', 'cm.is_active', 'cm.joined_at',
//       db.raw('json_agg(DISTINCT jsonb_build_object(\'id\', r.id, \'name\', r.name)) FILTER (WHERE r.id IS NOT NULL) as roles')
//       // You would add permission selection here if needed, similar to loadContext
//     ])
//     .groupBy('cm.id', 'cm.user_id', 'cm.client_id', 'cm.company_name', 'cm.coaster_name', 'cm.on_hold', 'cm.is_active', 'cm.joined_at');


//    if (req.query.client_id) q = q.where({ 'cm.client_id': req.query.client_id });
//     q = clientScope(q, req); // Ensure clientScope is compatible with current schema

//     // If fetching a single membership by ID
//     if (req.query.id) q = q.where({ 'cm.id': req.query.id });

//     const result = await q; // If req.query.id was used, this might be an array, not single.

//     // Handle single result vs. list
//     if (req.query.id) {
//         if (!result || result.length === 0) return res.status(404).json({ error: 'Not found' });
//         res.json(result[0]); // Return the first matching membership
//     } else {
//         res.json(result); // Return the list of memberships
//     }
// }));

// module.exports = router;