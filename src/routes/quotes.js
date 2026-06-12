const router = require('express').Router();
const db = require('../db');
const requireAuth = require('../middleware/auth');
const loadContext = require('../middleware/loadContext');
const clientContext = require('../middleware/clientContext');
const resolveClientContext = require('../middleware/resolveClientContext');
const adminOnly = require('../middleware/adminOnly');
const clientScope = require('../middleware/clientScope');
const asyncHandler = require('../middleware/asyncHandler');
const auditMiddleware = require('../middleware/auditMiddleware');
const notificationService = require('../services/notifications.service'); // Corrected import
const emailService = require('../services/email.service');

router.get('/', requireAuth, loadContext, resolveClientContext,
  asyncHandler(async (req, res) => {
    let q = db('quotes').orderBy('created_at', 'desc');
    if (req.query.client_id) q = q.where({ client_id: req.query.client_id });

    q = clientScope(q, req);
    let result;
    if (req.query.id) {
      result = await q.where({ id: req.query.id }).first();
      if (!result) return res.status(404).json({ error: 'Quote not found' });
    } else {
      result = await q; 
    }

    res.json(result);
  }));

router.post('/', requireAuth, loadContext, resolveClientContext,
  auditMiddleware({ action: 'quote.created', resourceType: 'quote' }),
  asyncHandler(async (req, res) => {
    const quoteClientId= req.body.client_id;
    const client = await db('clients').where({ id: quoteClientId}).first();

    const [quote] = await db('quotes').insert({
      ...req.body,
      client_name: client?.company_name ||  '',
      items: JSON.stringify(req.body.items ?? []),
      created_by: req.user.id,
      quote_number: `Q-${Date.now().toString().slice(-6)}`
    }).returning('*');

    // Link back to maintenance/training request
    if (quote.maintenance_request_id) {
      await db('maintenance_requests').where({ id: quote.maintenance_request_id }).update({ status: 'quote_sent' });
    }
    if (quote.training_request_id) {
      await db('training_requests').where({ id: quote.training_request_id }).update({ status: 'quote_sent' });
    }

    if (quote.status === 'pending' && !req.user.isInternalAdmin) {

      const notifs = await notificationService.notifyAllAdmins({
        title: 'New Quote Request',
        message: `${quote.client_name || 'A client'} has requested a quote: "${quote.title}"`,
        type: 'info',
        category: 'quote',
        link: `/AdminQuotes?quote_id=${quote.id}`,
        resourceId: quote.id,
        resourceType: "quote"
      });

    }
    // Notify client when admin sends a quote
    const isUpdate = false;
    if (req.user.isInternalAdmin && (quote.status === 'sent') && quote.client_id) {
      await notificationService.notifyClientUsers({
        clientId: quote.client_id,
        email: client?.contact_email,
        title: isUpdate ? 'Quote Updated' : 'Your Quote is Ready',
        message: isUpdate
          ? `Your quote "${quote.title}" (${quote.quote_number || ''}) has been updated. Please log in to review the changes.`
          : `Your quote "${quote.title}" (${quote.quote_number || ''}) has been prepared and is ready for your review.`,
        type: 'success',
        category: 'quote',
        link: `/Quotes?quote_id=${quote.id}`,
        is_email_sent: !!client?.contact_email,
        resourceId: quote.id,
        resourceType: "quote"
      });
      if (client) {
        await emailService.queue({
          type: 'quote_issue', to: client?.contact_email, payload: {
            is_update: isUpdate,
            quote,
            client,
          }
        });

      }

    }

    res.status(201).json(quote);
  }));

router.patch('/:id', requireAuth, loadContext, resolveClientContext,
  auditMiddleware({ action: 'quote.updated', resourceType: 'quote' }),
  asyncHandler(async (req, res) => {

    const { id } = req.params;
    const updates = { ...req.body };

    let q = db('quotes').where({ id }).first();
    q = clientScope(q, req);
    await db('quotes').where({ id }).first();
    const existing = await q;
    if (!existing) return res.status(404).json({ error: 'Not found' });
    // Handle notes appending
    if (updates.notes && typeof updates.notes === 'string') {
      const modNote = `\n\n[Client Modification Request - ${new Date().toLocaleDateString()}]:\n${updates.notes}`;
      updates.notes = (existing.notes || '') + modNote;
    } else {
      delete updates.notes; // Prevent overwriting with non-string or undefined
    }

    if (req.body.items !== undefined) {
      updates.items = JSON.stringify(req.body.items);
    } else {
      delete updates.items; // don't overwrite items with undefined
    }
    let [quote] = await db('quotes').where({ id }).update(updates).returning('*');
    const client = await db('clients').where({ id: quote.client_id }).first();
    // Notify client when admin sends a quote
    const isUpdate = req.user.isInternalAdmin && !!updates.sending_entity && existing.status != 'draft';
    if (req.user.isInternalAdmin && (updates.status === 'sent') && quote.client_id) {
      await notificationService.notifyClientUsers({
        clientId: quote.client_id,
        email: client?.contact_email,
        title: isUpdate ? 'Quote Updated' : 'Your Quote is Ready',
        message: isUpdate
          ? `Your quote "${quote.title}" (${quote.quote_number || ''}) has been updated. Please log in to review the changes.`
          : `Your quote "${quote.title}" (${quote.quote_number || ''}) has been prepared and is ready for your review.`,
        type: 'success',
        category: 'quote',
        link: `/Quotes?quote_id=${quote.id}`,
        is_email_sent: !!client?.contact_email,
        resourceId: quote.id,
        resourceType: "quote"
      });
      if (client) {
        await emailService.queue({
          type: 'quote_issue', to: client?.contact_email, payload: {
            is_update: isUpdate,
            quote,
            client,
          }
        });

      }

    }

    // Notify admins when client requests modifications (status reverted to pending)
    if (updates.status === 'pending' && existing.status === 'sent') {
      await notificationService.notifyAllAdmins({
        title: 'Quote Modification Requested',
        message: `${quote.client_name || 'A client'} requested modifications on quote "${quote.title}" (${quote.quote_number || quote.id?.slice(-6)}): ${updates.notes}`,
        type: 'warning',
        category: 'quote',
        link: `/AdminQuotes?quote_id=${quote.id}`,
        resourceId: quote.id,
        resourceType: "quote"
      });
    }

    if (updates.status === 'approved') {
      await db('orders').insert({
        client_id: quote.client_id,
        client_name: quote.client_name,
        quote_id: quote.id,
        title: quote.title,
        description: quote.description,
        items: JSON.stringify(quote.items),
        total_amount: quote.total_amount,
        currency: quote.currency,
        status: 'pending',
        created_by: req.user.id,
        order_number: `ORD-${Date.now().toString().slice(-6)}`
      })
      quote = await db('quotes').where({ id }).update({ status: 'converted' }).returning('*');
    }
    res.json(quote);
  }));
router.delete('/:id', requireAuth, adminOnly,
  auditMiddleware({ action: 'quote.deleted', resourceType: 'quote' }),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    await db('quotes').where({ id }).delete();
    res.json({ success: true });
  }));

module.exports = router;