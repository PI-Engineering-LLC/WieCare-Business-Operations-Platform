const router = require('express').Router();
const db = require('../db');
const requireAuth = require('../middleware/auth');
const loadContext = require('../middleware/loadContext');
const resolveClientContext = require('../middleware/resolveClientContext');
const adminOnly = require('../middleware/adminOnly');
const asyncHandler = require('../middleware/asyncHandler');
const auditMiddleware = require('../middleware/auditMiddleware');
const requireRoles = require('../middleware/roles');
const permissionCache = require('../lib/permissionsCache'); 
const sanitizeUser = require('../utils/sanitizeUser');

// GET /api/users
router.get('/', requireAuth, loadContext, requireRoles(['client_admin', 'super_admin', 'platform_admin']),
  asyncHandler( async (req, res) => {
  const { client_id, platform_role, is_active, search, page = 1, limit = 50 } = req.query;
  const offset = (page - 1) * limit;

  let baseQuery = db('users')
    .whereNull('users.deleted_at');

  if (platform_role) {
    baseQuery.where('users.platform_role', platform_role);
  }
  if (is_active !== undefined) {
    baseQuery.where('users.status', is_active === 'true' ? 'active' : 'inactive');
  }
  if (search) {
    baseQuery.where(function () {
      this.where(db.raw('users.full_name ILIKE ?', [`%${search}%`]))
          .orWhere(db.raw('users.email ILIKE ?', [`%${search}%`]));
    });
  }

  let finalQuery = baseQuery
    .select(
      'users.id',
      'users.email',
      'users.full_name',
      'users.platform_role',
      'users.last_login_at',
      'users.created_at',
      'users.avatar_storage_key',
      db.raw(`
        COALESCE(
          jsonb_agg( 
            DISTINCT jsonb_build_object( 
              'membership_id', cm.id, -- CHANGED: Renamed 'id' to 'membership_id' for consistency
              'client_id', cm.client_id,
              'client_name', c.company_name,
              'is_active', cm.is_active,
              'created_at', cm.created_at,
              'joined_at', cm.created_at, -- CHANGED: Ensure joined_at is present
              'roles', (
                SELECT (COALESCE(
                           jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'client_id', r.client_id)) FILTER (WHERE r.id IS NOT NULL), -- CHANGED: Added r.client_id
                           '[]'::jsonb
                         ))::jsonb
                FROM membership_roles AS mr_inner
                JOIN roles AS r ON mr_inner.role_id = r.id
                WHERE mr_inner.membership_id = cm.id
              )
            )
          ) FILTER (WHERE cm.id IS NOT NULL),
          '[]'::jsonb
        )::json AS memberships
      `)
    )
    .leftJoin('client_memberships as cm', 'cm.user_id', 'users.id')
    .leftJoin('clients as c', 'c.id', 'cm.client_id')
    .groupBy('users.id')
    .orderBy('users.created_at', 'desc')
    .limit(limit).offset(offset);

  if (client_id) {
    finalQuery.whereExists(function() {
      this.select('*')
        .from('client_memberships as cm_filter')
        .whereRaw('cm_filter.user_id = users.id')
        .where('cm_filter.client_id', client_id)
        .where('cm_filter.is_active', true);
    });
  }

  const countQuery = db('users')
    .whereNull('users.deleted_at')
    .modify(qb => {
        if (platform_role) qb.where('users.platform_role', platform_role);
        if (is_active !== undefined) {
          qb.where('users.status', is_active === 'true' ? 'active' : 'inactive');
        }
        if (search) {
            qb.where(function () {
                this.where(db.raw('users.full_name ILIKE ?', [`%${search}%`]))
                    .orWhere(db.raw('users.email ILIKE ?', [`%${search}%`]));
            });
        }
        if (client_id) {
            qb.whereExists(function() {
              this.select('*')
                .from('client_memberships as cm_filter')
                .whereRaw('cm_filter.user_id = users.id')
                .where('cm_filter.client_id', client_id)
                .where('cm_filter.is_active', true);
            });
        }
    })
    .countDistinct('users.id as count')
    .first();
  const [{ count }] = await Promise.all([countQuery]);

  const users = await finalQuery;

  res.json({ users, total: parseInt(count), page: parseInt(page), limit: parseInt(limit) });
}));
// GET /api/users/me
router.get('/me', requireAuth, loadContext ,asyncHandler( async (req, res) => {
  res.json(req.user);
}));
// PATCH /api/users/me
router.patch('/me', requireAuth,loadContext,
  auditMiddleware({action: 'user.updated', resourceType:'user'}),
  asyncHandler(
   async (req, res) => {
  const allowed = ['full_name', 'phone', 'job_title', 'avatar_storage_key',
                   'notif_invoice', 'notif_maintenance', 'notif_training',
                   'notif_order', 'notif_email'];
  const updates = Object.fromEntries(
    Object.entries(req.body).filter(([k]) => allowed.includes(k))
  );
  // Ensure platform_role cannot be updated here by a regular user
  if (updates.platform_role) {
      delete updates.platform_role;
  }
  const [updatedUser] = await db('users').where({ id: req.user.id }).update({ ...updates, updated_at: new Date() }).returning('*');
  res.json(sanitizeUser(updatedUser));
}));
// GET /api/users/:id - Get single user details (more granular access)
router.get('/:id', requireAuth, loadContext, requireRoles(['super_admin', 'platform_admin']),
  asyncHandler( async (req, res) => {
    const { id: userId } = req.params;

    if (req.user.platform_role !== 'super_admin' && req.user.platform_role !== 'platform_admin' && req.user.id !== userId) {
      return res.status(403).json({ error: 'You can only view your own details or require admin privileges' });
    }
  
    const user = await db('users')
      .where({ id: userId, deleted_at: null })
      .select('id', 'email', 'full_name', 'platform_role', 'status', 'avatar_storage_key', 'created_at')
      .first();
  
    if (!user) {
       return res.status(404).json({ error: 'User not found' });
    }
  
    const memberships = await db('client_memberships as tm')
      .join('clients as t', 't.id', 'tm.client_id')
      .where('tm.user_id', userId)
      .where('tm.is_active', true)
      .select(
        'tm.id as membership_id', // CHANGED: Standardized to membership_id
        't.id as client_id',
        't.company_name as client_name',
        'tm.created_at as joined_at' // CHANGED: Ensures joined_at is present
      );
  
    for (const membership of memberships) {
      const roles = await db('membership_roles as mr')
        .join('roles as r', 'r.id', 'mr.role_id')
        .where('mr.membership_id', membership.membership_id)
        .select('r.id', 'r.name', 'r.client_id'); // CHANGED: Added r.client_id
      membership.roles = roles;
    }
  
    user.memberships = memberships;
  
    res.json({ user });
  
}));

// POST /api/users/:id/clients/:clientId (Add user to client with roles)
router.post('/:id/clients/:clientId',
  requireAuth,
  loadContext,
  adminOnly,
  auditMiddleware({action: 'user.added_to_client', resourceType:'user'}),
  asyncHandler(async (req, res) => {
    const { roleIds = [] } = req.body;
    const { id: user_id, clientId: client_id } = req.params;

    const clientExists = await db('clients').where({ id: client_id }).first();
    if (!clientExists) return res.status(404).json({ error: 'Client not found.' });

    const userExists = await db('users').where({ id: user_id, deleted_at: null }).first();
    if (!userExists) return res.status(404).json({ error: 'User not found.' });

    const [membership] = await db('client_memberships')
      .insert({ user_id, client_id, is_active: true, created_at: new Date(), updated_at: new Date() })
      .onConflict(['user_id', 'client_id'])
      .merge({ is_active: true, updated_at: new Date() })
      .returning('*');

    await db('membership_roles').where({ membership_id: membership.id }).delete();
    if (roleIds.length > 0) {
      const roleInserts = roleIds.map(role_id => ({ membership_id: membership.id, role_id }));
      await db('membership_roles').insert(roleInserts);
    }

    permissionCache.del(`user_client_permissions:${user_id}`);
    console.log(`Invalidated permission cache for user ${user_id} due to adding to client ${client_id}`);

    res.status(201).json({ message: 'User added to client and roles set.', membership });
}));

// PUT /api/users/:id/clients/:clientId/roles (Update user roles in client)
router.put('/:id/clients/:clientId/roles',
  requireAuth,
  loadContext,
  adminOnly,
  auditMiddleware({action: 'user.roles_updated_in_client', resourceType:'user'}),
  asyncHandler(async (req, res) => {
    const { roleIds = [] } = req.body;
    const { id: user_id, clientId: client_id } = req.params;

    const membership = await db('client_memberships')
      .where({ user_id, client_id })
      .first();

    if (!membership) {
      return res.status(404).json({ error: 'User is not a member of this client.' });
    }

    await db.transaction(async (trx) => {
      await trx('membership_roles').where({ membership_id: membership.id }).delete();
      if (roleIds.length > 0) {
        const inserts = roleIds.map(role_id => ({ membership_id: membership.id, role_id }));
        await trx('membership_roles').insert(inserts);
      }
    });

    permissionCache.del(`user_client_permissions:${user_id}`);
    console.log(`Invalidated permission cache for user ${user_id} due to role update in client ${client_id}`);

    res.json({ message: 'User roles updated in client.', membership_id: membership.id, role_ids: roleIds });
}));

// DELETE /api/users/:id/clients/:clientId (Remove user from client)
router.delete('/:id/clients/:clientId',
  requireAuth,
  loadContext,
  adminOnly,
  auditMiddleware({action: 'user.removed_from_client', resourceType:'user'}),
  asyncHandler(async (req, res) => {
    const { id: user_id, clientId: client_id } = req.params;

    const deletedCount = await db('client_memberships')
      .where({ user_id, client_id })
      .del();

    if (deletedCount === 0) {
      return res.status(404).json({ error: 'User not found in this client.' });
    }

    permissionCache.del(`user_client_permissions:${user_id}`);
    console.log(`Invalidated permission cache for user ${user_id} due to removal from client ${client_id}`);

    res.json({ message: 'User removed from client.' });
}));

// PATCH /api/users/:id (Update user details and memberships/roles)
router.patch('/:id',
  requireAuth,
  loadContext,
  adminOnly,
  auditMiddleware({action: 'user.updated', resourceType:'user'}),
  asyncHandler(async (req, res) => {
  const target = await db('users').where({ id: req.params.id }).first();
  if (!target) return res.status(404).json({ error: 'User not found' });

  const {status, platform_role, full_name, phone, job_title, avatar_storage_key, memberships} = req.body;
  const updates = { updated_at: new Date() };
  if (status) updates.status = status;
  if (full_name) updates.full_name = full_name;
  if (phone) updates.phone = phone;
  if (job_title) updates.job_title = job_title;
  if (avatar_storage_key) updates.avatar_storage_key = avatar_storage_key;

  if (req.user.isInternalAdmin) {
    if (platform_role) updates.platform_role = platform_role;
  }

  await db('users').where({ id: req.params.id }).update(updates);

  let cacheInvalidatedForUser = false;
  if (memberships && Array.isArray(memberships)) {
    for (const membershipUpdate of memberships) {
      const { clientId, roleIds } = membershipUpdate;

      const clientMembership = await db('client_memberships')
        .where({ user_id: req.params.id, client_id: clientId })
        .first();

      if (clientMembership) {
        await db('membership_roles').where({ membership_id: clientMembership.id }).delete();
        if (roleIds && Array.isArray(roleIds) && roleIds.length > 0) {
          const inserts = roleIds.map(role_id => ({
            membership_id: clientMembership.id,
            role_id,
          }));
          await db('membership_roles').insert(inserts);
          cacheInvalidatedForUser = true;
        }
      } else {
        console.warn(`Attempted to update roles for non-existent membership for user ${req.params.id} and client ${clientId}`);
      }
    }
  }

  if (cacheInvalidatedForUser || updates.platform_role) {
    permissionCache.del(`user_client_permissions:${req.params.id}`);
    console.log(`Invalidated permission cache for user ${req.params.id} due to membership/role/platform_role update.`);
  }

  res.json({
    success: true,
    id: req.params.id
   });
})
);

// DELETE /api/users/:id — deactivate/soft delete (admin only)
router.delete('/:id',
  requireAuth,
  loadContext,
  adminOnly,
  auditMiddleware({action: 'user.deleted', resourceType:'user'}),
  asyncHandler(async (req, res) => {
  const user_id_to_delete = req.params.id;
  await db('users').where({ id: user_id_to_delete }).update({ status: 'inactive' ,deleted_at:db.fn.now(), updated_at: new Date()});

  permissionCache.del(`user_client_permissions:${user_id_to_delete}`);
  console.log(`Invalidated permission cache for user ${user_id_to_delete} due to soft deletion.`);

  res.json({ success: true });
}));


module.exports = router;
