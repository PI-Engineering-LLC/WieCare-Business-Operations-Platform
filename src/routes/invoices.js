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
const { renderInvoicePDF } = require('../services/pdfRenderer');
const notificationService = require('../services/notifications.service');
const emailService = require('../services/email.service' );


router.get('/', requireAuth,loadContext,resolveClientContext, 
  asyncHandler( async (req, res) => {
  let q = db('invoices').orderBy('created_at', 'desc');
  if (req.query.client_id) q = q.where({ client_id: req.query.client_id });
  q = clientScope(q, req);
  let result;
  if (req.query.id) {
    result = await q.where({ id: req.query.id }).first();
    if (!result) return res.status(404).json({ error: 'Invoice not found' });
  } else {
    result = await q; 
  }

  res.json(result);
}));

router.get('/:id', requireAuth,loadContext, async (req, res) => {
  const inv = await db('invoices').where({ id: req.params.id }).first();
  if (!inv) return res.status(404).json({ error: 'Not found' });
  res.json(inv);
});

router.post('/', requireAuth,loadContext, adminOnly, 
  auditMiddleware({action: 'invoice.created', resourceType:'invoice'}),
  asyncHandler( async (req, res) => {
  const body = req.body;
  const balance_due = body.total_amount - (body.amount_paid || 0);
  //TODO remove
  const{ client_id,sending_entity,tax_code,tax_rate, ...invData} = req.body
  if (invData['issue_date'] === '') {
    invData['issue_date'] = new Date();
  }
  if (invData['order_id'] === '') {
    invData['order_id'] = null;
  }
  if (req.body.items !== undefined) {
    invData.items = JSON.stringify(req.body.items);
  } else {
    delete invData.items; // don't overwrite items with undefined
  }

  const [inv] = await db('invoices').insert({
    ...invData,
    items: JSON.stringify(req.body.items ?? []), 
    client_id,
    sending_entity: sending_entity,
    due_date: invData.due_date || null,
    balance_due,
    created_by: req.user.id,
    invoice_number: `INV-${Date.now().toString().slice(-6)}`
  }).returning('*');
  if (req.user.isInternalAdmin && (inv.status === 'sent' || inv.status === 'invoiced'  ) && inv.client_id) {
    await notificationService.notifyClientUsers({
        clientId: inv.client_id,
        email: client?.contact_email,
        title: `Invoice ${inv.invoice_number || ''} Ready`,
        message: `Your invoice "${inv.title}" for $${(inv.total_amount || 0).toLocaleString()} is now available in your portal.`,
        type: 'info',
        category: 'invoice',
        link: `/Invoices?invoice_id=${inv.id}`,
        is_email_sent: !!client?.contact_email,
        resourceId: inv.id,
        resourceType: "invoice"
      });
    if(client) {
        await emailService.queue({ type: 'invoice_issue', to: client?.contact_email, payload: {
            inv,
            client,
          } });

    }
    
  }


  res.status(201).json(inv);
}));

router.patch('/:id', requireAuth,loadContext, adminOnly, 
  auditMiddleware({action: 'invoice.updated', resourceType:'invoice'}),
  asyncHandler( async (req, res) => {
    const{ tax_code,tax_rate, ...invData} = req.body
    
    if (invData['issue_date'] === '') {
      invData['issue_date'] = new Date();
    }
    if (invData['due_date'] === '') {
      invData['due_date'] = null
    }
    if (invData['order_id'] === '') {
      invData['order_id'] = null;
    }
    if (req.body.items !== undefined) {
      invData.items = JSON.stringify(req.body.items);
    } else {
      delete invData.items; // don't overwrite items with undefined
    }
    if (req.body.payment_history !== undefined) {
      invData.payment_history = JSON.stringify(req.body.payment_history);
    } else {
      delete invData.payment_history; // don't overwrite items with undefined
    }
  const [inv] = await db('invoices').where({ id: req.params.id }).update({...invData, created_by: req.user.id}).returning('*');
  res.json(inv);
}));

router.delete('/:id', requireAuth,loadContext, adminOnly, 
  auditMiddleware({action: 'invoice.deleted', resourceType:'invoice'}),
  asyncHandler( async (req, res) => {
    await db('invoices').where({ id: req.params.id }).delete();
    res.json({ success: true });
  }));

  router.get('/invoices/:id/pdf', 
    asyncHandler( async (req, res) => {
    const invoice = await db('invoices').where({ id: req.params.id }).first();
    renderInvoicePDF(invoice, res);
  }));
module.exports = router;