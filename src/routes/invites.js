const router = require('express').Router();
const requireAuth = require('../middleware/auth');
const loadContext = require('../middleware/loadContext');
const resolveAuthContext = require('../middleware/resolveAuthContext');
const audit = require('../services/audit');
const asyncHandler = require('../middleware/asyncHandler');
const inviteService = require('../services/invite');


// POST /api/invites
router.post('/', requireAuth, loadContext, resolveAuthContext,
  asyncHandler(async (req, res) => {
    const { email, role_ids, inviteType, platformRole, authProvider = 'any', invited_by_message } = req.body;
    const clientId = req.clientId;

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
router.get('/', requireAuth, loadContext, resolveAuthContext,
  asyncHandler(async (req, res) => {
    const { client_id, page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;

    let query = db('invites as i')
      .join('clients as t', 't.id', 'i.client_id')
      .join('users as u', 'u.id', 'i.invited_by')
      .select('i.*', 't.company_name as client_name', 'u.full_name as invited_by_name');

    if (client_id) query.where('i.client_id', client_id);

    const [{ count }] = await query.clone().count('i.id as count');
    const invites = await query.orderBy('i.created_at', 'desc').limit(limit).offset(offset);

    res.json({ invites, total: parseInt(count) });
  }));

// GET /api/invites/:id
router.get('/:id', requireAuth, loadContext, resolveAuthContext,
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
router.post('/:id/resend', requireAuth, loadContext, resolveAuthContext,
  asyncHandler(async (req, res) => {
    const invite = await inviteService.resendInvite(req.params.id);
    await audit({ actorUserId: req.user.id, clientId: req.clientId, action: 'invite.resent', resourceType: 'invite', resourceId: invite.id, metadata: { email: invite.email }, req });
    res.json({ message: 'Invite resent' });
  }));

// POST /api/invites/:id/revoke
router.post('/:id/revoke', requireAuth, loadContext, resolveAuthContext,
  asyncHandler(async (req, res) => {
    await inviteService.revokeInvite(req.params.id);
    return { success: true };
  }));
module.exports = router;
