
const db = require('../db');
const permissionCache = require('../lib/permissionsCache')

module.exports = async (req, res, next) => {
  if (!req.auth || !req.auth.userId) {
    // If not authenticated, proceed without user context
    req.user = null;
    return next();
  }

  const user = await db('users')
    .where({ id: req.auth.userId, deleted_at: null })
    .first();

  if (!user) {
    req.user = null; // User not found or deleted, treat as unauthenticated for this request
    return next();
  }

  const userId = user.id;
  const cacheKey = `user_client_permissions:${userId}`;
  let groupedClients;

  // Attempt to retrieve from cache
  let cachedData = permissionCache.get(cacheKey);

  if (cachedData) {
    // Cache hit!
    console.log(`Cache hit for user ${userId} client permissions.`);
    groupedClients = cachedData;
  } else {
    // Cache miss. Fetch from DB and process.
    console.log(`Cache miss for user ${userId} client permissions. Fetching from DB...`);
    const clientMembershipsWithPermissions = await db('client_memberships as cm')
      .leftJoin('clients as c', 'c.id', 'cm.client_id') // Join with clients table to get client details
      .leftJoin('membership_roles as mr', 'mr.membership_id', 'cm.id')
      .leftJoin('roles as r', 'r.id', 'mr.role_id')
      .leftJoin('role_permissions as rp', 'rp.role_id', 'r.id')
      .leftJoin('permissions as p', 'p.id', 'rp.permission_id')
      .where({ 'cm.user_id': userId, 'cm.is_active': true })
      .select([
        'cm.id as membership_id',
        'cm.client_id',
        'c.company_name',
        'c.coaster_name',
        'c.on_hold',
        'r.id as role_id',
        'r.name as role_name',
        'p.resource',
        'p.action'
      ]);

    groupedClients = Object.values(
      clientMembershipsWithPermissions.reduce((acc, row) => {
        const membershipKey = row.membership_id;

        if (!acc[membershipKey]) {
          acc[membershipKey] = {
            id: row.membership_id, // Add membership ID here for easier reference
            clientId: row.client_id,
            client: {
              id: row.client_id,
              company_name: row.company_name,
              coaster_name: row.coaster_name,
              on_hold: row.on_hold
            },
            roles: [],
            permissions: new Set()
          };
        }

        if (row.role_id && !acc[membershipKey].roles.some(role => role.id === row.role_id)) {
          acc[membershipKey].roles.push({
            id: row.role_id,
            name: row.role_name
          });
        }

        if (row.resource && row.action) {
          acc[membershipKey].permissions.add(`${row.resource}:${row.action}`);
        }

        return acc;
      }, {})
    ).map(membership => ({
      ...membership,
      permissions: Array.from(membership.permissions)
    }));

    // Store in cache
    permissionCache.set(cacheKey, groupedClients);
  }

  // Set req.user properties, including internal flags
  req.user = {
    id: user.id,
    email: user.email,
    full_name: user.full_name,
    phone: user.phone,
    job_title: user.job_title,
    avatar_storage_key: user.avatar_storage_key,
    status: user.status,
    platform_role: user.platform_role,
    mfa_enabled: user.mfa_enabled,
    preferences: {
      notif_invoice: user.notif_invoice,
      notif_maintenance: user.notif_maintenance,
      notif_training: user.notif_training,
      notif_order: user.notif_order,
      notif_email: user.notif_email,
    },
    memberships: groupedClients, // All client memberships with aggregated roles and permissions
    // Internal flags for convenience
    isPlatformAdmin: user.platform_role === 'super_admin',
    isInternalAdmin: user.platform_role === 'super_admin' || user.platform_role === 'platform_admin',
  };

  next();
};