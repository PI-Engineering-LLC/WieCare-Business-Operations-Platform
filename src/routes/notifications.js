const router = require('express').Router();
const db = require('../db');
const requireAuth = require('../middleware/auth');
const loadContext = require('../middleware/loadContext');
const resolveClientContext = require('../middleware/resolveClientContext');
const adminOnly = require('../middleware/adminOnly');
const clientScope = require('../middleware/clientScope');
const asyncHandler = require('../middleware/asyncHandler');
const auditMiddleware = require('../middleware/auditMiddleware');
const notificationService = require('../services/notifications.service'); // Using the service class

// GET /api/notifications — for current user
router.get('/', requireAuth, loadContext, resolveClientContext,
  asyncHandler( async (req, res) => {
    let q = db('notifications')
      .orderBy('created_at', 'desc');

    // Platform admins can request all notifications by leaving recipient_id/client_id out
    if (req.user.isInternalAdmin && !req.query.recipient_id && !req.query.client_id) {
        // No specific filtering needed for super/platform admins if they want everything
        if (req.query.user_id) q = q.where({ recipient_id: req.query.user_id});
    } else {
        // For regular users or admins specifying filters, apply recipient/client filtering
        q.where(function() {
            // Notifications for the current authenticated user
            this.where('recipient_id', req.user.id)
                .orWhere('recipient_email', req.user.email); // Always include notifications by email
            // If user is part of a client, also include client-scoped notifications for them
            // if (req.clientId) {
            //     this.orWhere('client_id', req.clientId);
            // }
            //
            if (req.clientId && req.membership.roles.some(role => ['client_admin'].includes(role.name))) {
                this.orWhere('client_id', req.clientId);
            }
        });
    }

    // Apply is_read filter if present
    if (req.query.is_read === 'false') q = q.where({ is_read: false });
    if (req.query.is_read === 'true') q = q.where({ is_read: true });

    // Apply limit
    let limit = req.query.limit ? parseInt(req.query.limit) : 100;
    if (limit > 0) q.limit(limit);

    // Apply ordering
    if (req.query.order) {
      const [orderCol, orderDir] = req.query.order.startsWith('-')
        ? [req.query.order.substring(1), 'desc']
        : [req.query.order, 'asc'];
      q.orderBy(orderCol, orderDir);
    }

    const notifications = await q;
    res.json(notifications);
}));

// PATCH /api/notifications/:id/read
router.patch('/:id/read', requireAuth, loadContext, resolveClientContext,
  auditMiddleware({action: 'notification.marked_read', resourceType:'notification'}),
  asyncHandler(async (req, res) => {
  await db('notifications').where({ id: req.params.id, recipient_id: req.user.id }).update({ is_read: true, updated_at: db.fn.now() });
  res.json({ success: true });
}));

// POST /api/notifications/mark-all-read
router.post('/mark-all-read', requireAuth, loadContext, resolveClientContext,
  auditMiddleware({action: 'notification.marked_all_read', resourceType:'notification'}),
  asyncHandler( async (req, res) => {
  await db('notifications').where({ recipient_id: req.user.id, is_read: false }).update({ is_read: true, updated_at: db.fn.now() });
  res.json({ success: true });
}));

// DELETE /api/notifications/:id
router.delete('/:id', requireAuth, loadContext, resolveClientContext,
  auditMiddleware({action: 'notification.deleted', resourceType:'notification'}),
  asyncHandler( async (req, res) => {
  const deletedCount = await db('notifications').where({ id: req.params.id, recipient_id: req.user.id }).delete();
  if (deletedCount === 0) return res.status(404).json({ error: 'Notification not found or not authorized' });
  res.json({ success: true });
}));

// DELETE /api/notifications/clear-read
router.delete('/clear-read', requireAuth, loadContext, resolveClientContext,
  auditMiddleware({action: 'notification.cleared_read', resourceType:'notification'}),
  asyncHandler( async (req, res) => {
  await db('notifications').where({ recipient_id: req.user.id, is_read: true }).delete();
  res.json({ success: true });
}));

// POST /api/notifications (admin — send to specific user)
router.post('/', requireAuth, loadContext, adminOnly,
  auditMiddleware({action: 'notification.sent_to_user', resourceType:'notification'}),
  asyncHandler( async (req, res) => {
  const { title, message, type, category, recipient_id, recipient_email, client_id, link, is_email_sent } = req.body;

  if (!recipient_id && !recipient_email) {
      return res.status(400).json({ error: 'Recipient ID or Email is required.' });
  }

  const notification = await notificationService.notify({
      userId: recipient_id,
      email: recipient_email,
      clientId: client_id,
      title,
      message,
      type,
      category,
      link,
      isSendEmail: is_email_sent
  });

  res.status(201).json(notification);
}));

// POST /api/notifications/client (admin — send to all users in a client, but email only to contact)
router.post('/client', requireAuth, loadContext, adminOnly,
  auditMiddleware({action: 'notification.sent_to_client', resourceType:'notification'}),
  asyncHandler( async (req, res) => {
  const { title, message, type, category, client_id, link, is_email_sent } = req.body;

  if (!client_id) {
      return res.status(400).json({ error: 'Client ID is required.' });
  }

  let clientContactEmail = null;
  if (is_email_sent) {
      // Fetch the client's contact email if email sending is requested
      const client = await db('clients').where({ id: client_id }).select('contact_email').first();
      if (client) {
          clientContactEmail = client.contact_email;
      } else {
          console.warn(`Client with ID ${client_id} not found for email notification.`);
      }
  }

  const notifications = await notificationService.notifyClientUsers({
      clientId: client_id,
      email: clientContactEmail, // Pass the contact email for the service to use
      title,
      message,
      type,
      category,
      link,
      isSendEmail: is_email_sent
  });

  res.status(201).json(notifications);
}));

module.exports = router;