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
const { getIO } = require('../config/socket');
const validate = require('../middleware/validate');
const { createInvoiceSchema, updateInvoiceSchema } = require('../validators/invoice.validators');

const toNum = (val) => {
  const parsed = parseFloat(val);
  return isNaN(parsed) ? 0 : parsed;
};
router.get('/', requireAuth,loadContext,resolveClientContext, 
  asyncHandler( async (req, res) => {
  let q = db('invoices').orderBy('created_at', 'desc');
  if (req.query.client_id) q = q.where({ client_id: req.query.client_id });
  if(!req.user.isInternalAdmin) q = q.whereNotIn('status', ['draft'])
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

// router.get('/:id', requireAuth,loadContext, async (req, res) => {
//   const inv = await db('invoices').where({ id: req.params.id }).first();
//   if (!inv) return res.status(404).json({ error: 'Not found' });
//   res.json(inv);
// });
router.get('/:id', requireAuth, loadContext, resolveClientContext,
  asyncHandler(async (req, res) => {
    let q = db('invoices').where({ id: req.params.id });
    q = clientScope(q, req); // restricts to client's own invoices

    const inv = await q.first();
    if (!inv) return res.status(404).json({ error: 'Invoice not found' });
    res.json(inv);
  })
);

router.post('/', requireAuth,loadContext, adminOnly, 
  validate(createInvoiceSchema),
  auditMiddleware({action: 'invoice.created', resourceType:'invoice'}),
  asyncHandler( async (req, res) => {
  const body = req.body;
  // const balance_due = body.total_amount - (body.amount_paid || 0);
  const balance_due = toNum(body.total_amount) - toNum(body.amount_paid);
  //TODO remove
  const{ client_id,sending_entity,tax_code,tax_rate, ...invData} = req.body
  const issue = invData['issue_date'] ? new Date(invData['issue_date']) : new Date();
if (invData['issue_date'] === '') invData['issue_date'] = issue;
if (invData['due_date'] === '') {
  invData['due_date'] = new Date(issue.getTime() + 60 * 24 * 60 * 60 * 1000);
}
  if (invData['order_id'] === '') {
    invData['order_id'] = null;
  }
  if (req.body.items !== undefined) {
    invData.items = JSON.stringify(req.body.items);
  } else {
    delete invData.items; // don't overwrite items with undefined
  }
  // const [{ nextval }] = await db.raw(
  //   "SELECT nextval('invoice_number_seq') AS nextval"
  // );
  // Access the .rows array first
const result = await db.raw("SELECT nextval('invoice_number_seq') AS nextval");
// Now destructure from the rows array
const [{ nextval }] = result.rows;
  const invoice_number = `INV-${String(nextval).padStart(6, '0')}`;
  const [inv] = await db('invoices').insert({
    ...invData,
    // items: JSON.stringify(req.body.items ?? []), 
    client_id,
    sending_entity: sending_entity,
    due_date: invData.due_date || null,
    balance_due,
    created_by: req.user.id,
    invoice_number
    // invoice_number: `INV-${Date.now().toString().slice(-6)}`
  }).returning('*');
  const client = await db('clients').where({ id: inv.client_id }).first();
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
      await notificationService.emailClientAdmins({ type: 'invoice_issue', clientId: client?.id, payload: {
        invoice: inv,
          client,
        } });
        // await emailService.queue({ type: 'invoice_issue', to: client?.contact_email, payload: {
        //   invoice: inv,
        //     client,
        //   } });

    }
   
    
  }


  res.status(201).json(inv);
}));

router.patch('/:id', requireAuth,loadContext, adminOnly, 
  validate(updateInvoiceSchema),
  auditMiddleware({action: 'invoice.updated', resourceType:'invoice'}),
  asyncHandler( async (req, res) => {
    const{ tax_code,tax_rate, ...invData} = req.body
    const invoice = await db('invoices')
    .where({ id: req.params.id })
    .first();
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    
    // if (invData['issue_date'] === '') {
    //   // invData['issue_date'] = new Date();
    //   invData['issue_date'] = invoice.issue_date;
    // }
    // if (invData['due_date'] === '') {
    //   invData['due_date'] = invoice.due_date;;
    // }
    if (invData['order_id'] === '') {
      invData['order_id'] = null;
    }
    if (req.body.items !== undefined) {
      invData.items = JSON.stringify(req.body.items);
    } else {
      delete invData.items; // don't overwrite items with undefined
    }
    
    // if (req.body.payment_history !== undefined) {
    //   invData.payment_history = JSON.stringify(req.body.payment_history);
    // } else {
    //   delete invData.payment_history; // don't overwrite items with undefined
    // }
    const status = invData.status
    
      // invData.balance_due = (invData.total_amount || invoice.total_amount) - (invData.amount_paid || invoice.amount_paid)
      // console.log("@@@@!!",invData.balance_due, invData.total_amount,invData.amount_paid )
      // // invData.status = invData.balance_due <= 0 ? 'paid' : invData.amount_paid > 0 ? 'partial' : invData.amount_paid = 0 ? 'pending' : (invData.status || invoice.status);
      
        // invData.balance_due = (invData.total_amount || invoice.total_amount) - (invData.amount_paid || invoice.amount_paid)
        const total = toNum(invData.total_amount || invoice.total_amount);
        const paid = toNum(invData.amount_paid || invoice.amount_paid);
        
        invData.balance_due = total - paid;
        // console.log("@@@@!!",invData.balance_due, invData.total_amount,invData.amount_paid,total,paid,invoice.total_amount,invoice.amount_paid, invoice )
        if( invoice.status!='draft' || invData.status=='sent'){
      if (invData.balance_due <= 0) {
        invData.status = 'paid';
      } else if (invData.amount_paid > 0) {
        invData.status = 'partial';
      } else if (Number(invData.amount_paid) === 0) {
        invData.status = 'pending';
      } else {
        invData.status = invData.status || invoice.status;
      }
      // console.log("@@@@22",invData.status)
      // if(invData['due_date']|| invData['issue_date'] ){
      const today = new Date();
      const sixtyDaysAgo = new Date(today.getTime() - (60 * 24 * 60 * 60 * 1000));
      const dueDate = invData['due_date'] ? new Date(invData['due_date']) : invoice.due_date
      const issueDate = invData['issue_date'] ? new Date(invData['issue_date']): invoice.issue_date
      if(dueDate < today || issueDate < sixtyDaysAgo ){
        // console.log("@@@@here")
        if(invData.balance_due >0){
            invData.status = 'overdue'
        }
        // else{
        //   invData.status = status
        // }
        
      }
    // }
    
    }
    // console.log('!!!!@@@@@@@@@??',invData )
    const updateData = { ...invData };
if (req.body.amount_paid !== undefined) {
  updateData.amount_paid = paid;
}
const [inv] = await db('invoices').where({ id: req.params.id }).update(updateData).returning('*');
  // const [inv] = await db('invoices').where({ id: req.params.id }).update({...invData, amount_paid: paid}).returning('*');
  const client = await db('clients').where({ id: inv.client_id }).first();
  // console.log('@@@@@@@@@??',inv.status)
  if (req.user.isInternalAdmin && ( inv.status !== 'paid'  && inv.status != 'draft' ) && inv.client_id) {
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
        await notificationService.emailClientAdmins({ type: 'invoice_issue', clientId: client?.id, payload: {
          invoice: inv,
            client,
          } });
        // await emailService.queue({ type: 'invoice_issue', to: client?.contact_email, payload: {
        //     invoice: inv,
        //     client,
        //   } });

    }
    } else if (inv.status != 'draft') {
      const io = getIO();
      if (io) {
        io.to(`client:${invoice.client_id }`).emit('notification:new', { category:'invoice'});
        io.to('admins').emit('notification:new', { category:'invoice'})
        // io.emit('notification:new', { category:'invoice'})
      }
    }
  res.json(inv);
}));

router.delete('/:id', requireAuth,loadContext, adminOnly, 
  auditMiddleware({action: 'invoice.deleted', resourceType:'invoice'}),
  asyncHandler( async (req, res) => {
    const invoice = await db('invoices')
    .where({ id: req.params.id })
    .select('client_id')
    .first();

  if (!invoice) {
    return res.status(404).json({ error: 'Not found' });
  }
    await db('invoices').where({ id: req.params.id }).delete();
    const io = getIO();
  if (io) {
    io.to(`client:${invoice.client_id }`).emit('notification:new', { category:'invoice'});
    io.to('admins').emit('notification:new', { category:'invoice'})
    // io.emit('notification:new', { category:'invoice'})
  } 
    res.json({ success: true }); 
  }));

  router.get('/:id/pdf', requireAuth, loadContext, resolveClientContext,
    asyncHandler( async (req, res) => {
    const invoice = await db('invoices').where({ id: req.params.id }).first();
    renderInvoicePDF(invoice, res);
  }));

  
module.exports = router;