const router = require('express').Router();
const db = require('../db');
const requireAuth = require('../middleware/auth');
const loadContext = require('../middleware/loadContext');
const resolveAuthContext = require('../middleware/resolveAuthContext');
const audit = require('../services/audit');
const asyncHandler = require('../middleware/asyncHandler');
const inviteService = require('../services/invite');
const requireRoles = require('../middleware/roles');
const resolveClientContext = require('../middleware/resolveClientContext');

// POST /api/invites
router.post('/', requireAuth, loadContext, resolveAuthContext, requireRoles(['client_admin', 'super_admin', 'platform_admin']),
  asyncHandler(async (req, res) => {
    const { email, role_ids, inviteType, platformRole, authProvider = 'any', invited_by_message } = req.body;
    const clientId = req.clientId;
    if (clientId) {
      const client = await db('clients').where({ id: clientId }).first();
      if (client) {
        const limit = client.invite_limit || 5

        const userResult = await db('users')
        .whereNull('users.deleted_at')
          .join('client_memberships as cm', 'cm.user_id', 'users.id')
          .join('clients as c', 'c.id', 'cm.client_id')
          .where('cm.client_id', clientId)
          .count('users.id as count')
          .first();

        const userCount = parseInt(userResult.count);

        // Active, unaccepted, unexpired invites
        const pendingCount = await db('invites')
          .where({ client_id: clientId })
          .whereNull('accepted_at')              // Has not been accepted yet
          .where('invite_expires_at', '>', new Date()) // Is not expired (and not revoked)
          .count('id as count')
          .first();

        const totalUsage = parseInt(userCount) + parseInt(pendingCount.count);

        // Enforce the limit
        if (totalUsage > limit) {
          return res.status(403).json({
            error: "Invite limit reached. Please contact support to increase your limit."
          });
        }
      }
    }

    const invite = await inviteService.createInvite({
      email,
      inviteType,
      clientId,
      role_ids,
      platformRole,
      authProvider,
      invitedBy: req.user.id,
      message: invited_by_message,
    });
    await audit({ actorUserId: req.user.id, clientId: req.clientId, action: 'invite.created', resourceType: 'invite', resourceId: invite.id, metadata: { email, role_ids, platformRole }, req });

    res.json({ success: true });
  }));

// GET /api/invites
router.get('/', requireAuth, loadContext, resolveClientContext, requireRoles(['client_admin', 'super_admin', 'platform_admin']),
  asyncHandler(async (req, res) => {
    const { client_id, page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;

    let query = db('invites as i')
      .leftJoin('clients as t', 't.id', 'i.client_id')
      .leftJoin('users as u', 'u.id', 'i.invited_by')
      .select('i.*', 't.company_name as client_name', 'u.full_name as invited_by_name');

    if (client_id) query.where('i.client_id', client_id);
    if (req.clientId) query.where('i.client_id', req.clientId);

    // const [{ count }] = await query.clone().count('i.id as count');
    const invites = await query.orderBy('i.created_at', 'desc').limit(limit).offset(offset);

    // res.json({ invites, total: parseInt(count) });
    res.json({ invites });
  }));

// GET /api/invites/status
router.get('/status', requireAuth, loadContext, resolveClientContext,
  asyncHandler(async (req, res) => {
    const { client_id } = req.query;
    const clientId = req.clientId || client_id;
    const client = await db('clients')
      .where({ id: clientId })
      .select('invite_limit')
      .first();

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }
    // const userResult = await db('users')
    // .where({ client_id: clientId })
    // .count('id as count')
    // .first();

    // const inviteResult = await db('invites')
    // .where({ client_id: clientId })
    // .whereNull('accepted_at') 
    // .where('expires_at', '>', new Date())
    // .count('id as count')
    // .first();
    const [userResult, inviteResult] = await Promise.all([
      db('users').where({ client_id: clientId }).count('id as count').first(),
      db('invites').where({ client_id: clientId }).whereNull('accepted_at').where('expires_at', '>', new Date()).count('id as count').first()
    ]);
    const currentUsage = parseInt(userResult.count) + parseInt(inviteResult.count);
    const limit = client.invite_limit || 5;

    res.status(200).json({
      currentUsage,
      limit,
      remaining: Math.max(0, limit - currentUsage),
      isAtLimit: currentUsage >= limit
    });
  }));

// GET /api/invites/:id
router.get('/:id', requireAuth, loadContext, resolveClientContext,
  asyncHandler(async (req, res) => {
    const invite = await db('invites as i')
      .join('clients as t', 't.id', 'i.client_id')
      .join('users as u', 'u.id', 'i.invited_by')
      .where('i.id', req.params.id)
      .select('i.*', 't.company_name as client_name', 'u.full_name as invited_by_name')
      .first();
    if (!invite) return res.status(404).json({ error: 'Invite not found' });
    res.json({ invite });
  }));

// POST /api/invites/:id/resend
router.post('/:id/resend', requireAuth, loadContext, resolveClientContext,
  asyncHandler(async (req, res) => {
    const invite = await inviteService.resendInvite(req.params.id);
    await audit({ actorUserId: req.user.id, clientId: req.clientId, action: 'invite.resent', resourceType: 'invite', resourceId: invite.id, metadata: { email: invite.email }, req });
    res.json({ message: 'Invite resent' });
  }));

// POST /api/invites/:id/revoke
router.post('/:id/revoke', requireAuth, loadContext, resolveClientContext,
  asyncHandler(async (req, res) => {
    const invite = await inviteService.revokeInvite(req.params.id);
    await audit({ actorUserId: req.user.id, clientId: req.clientId, action: 'invite.resent', resourceType: 'invite', resourceId: invite.id, metadata: { email: invite.email }, req });
    res.json({ message: 'Invite revoked' });
  }));
module.exports = router;
