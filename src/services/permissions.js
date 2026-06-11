const db = require('../db');

const getUserPermissions = async (userId) => {
  const rows = await db('client_memberships as cm') // Start from client_memberships
    .join('membership_roles as mr', 'mr.membership_id', 'cm.id')
    .join('roles as r', 'r.id', 'mr.role_id')
    .join('role_permissions as rp', 'rp.role_id', 'r.id')
    .join('permissions as p', 'p.id', 'rp.permission_id')
    .where('cm.user_id', userId)
    .select('p.resource', 'p.action'); // Select resource and action

  const permissions = new Set();
  rows.forEach(p => permissions.add(`${p.resource}:${p.action}`));
  return Array.from(permissions);
};

const getClientPermissions = async ({
  userId,
  clientId
}) => {
  const rows = await db('client_memberships as cm') // Start from client_memberships
    .join('membership_roles as mr', 'mr.membership_id', 'cm.id')
    .join('roles as r', 'r.id', 'mr.role_id')
    .join('role_permissions as rp', 'rp.role_id', 'r.id')
    .join('permissions as p', 'p.id', 'rp.permission_id')
    .where({
      'cm.user_id': userId,
      'cm.client_id': clientId
    })
    .select('p.resource', 'p.action'); // Select resource and action

  const permissions = new Set();
  rows.forEach(p => permissions.add(`${p.resource}:${p.action}`));
  return Array.from(permissions);
};

module.exports = { getUserPermissions, getClientPermissions};