const router   = require('express').Router();
const db       = require('../db');
const requireAuth = require('../middleware/auth');
const loadContext = require('../middleware/loadContext');
const clientContext = require('../middleware/clientContext');
const resolveClientContext = require('../middleware/resolveClientContext');
const adminOnly = require('../middleware/adminOnly');
const clientScope = require('../middleware/clientScope');
const asyncHandler = require('../middleware/asyncHandler');
const auditMiddleware = require('../middleware/auditMiddleware');
const axios = require('axios')
const notificationService = require('../services/notifications.service'); 
const {getIO} = require('../config/socket')
const {formatToStrict13}= require('../utils/phone')
const validateWebhook = require('../middleware/uploadMiddleWare');
const PaymentService = require('../services/payments')

router.post('/webhook/ipospays', validateWebhook,
  auditMiddleware({action: 'payment.processed', resourceType:'payment'}),
  asyncHandler( async (req, res) => {
      // iPOSpays sends response fields in the body
      const { 
        transactionReferenceId,
      } = req.body;

      if (!transactionReferenceId) {
        console.error('Invalid Webhook Payload: Missing transactionReferenceId');
        return res.status(400).send('Bad Request');
      }

      try {
        console.log(`--- Webhook Received for Invoice: ${transactionReferenceId} ---`);
        await PaymentService.reconcilePaymentStatus(transactionReferenceId);
        
        return res.status(200).send('OK');
  
      } catch (error) {
        // 1. Differentiate: "Record not found" is a permanent failure
        if (error.message === 'Payment record not found') {
          console.warn(`⚠️ Webhook ignored: ${error.message} for ID: ${transactionReferenceId}`);
          // Return 200 to prevent retries
          return res.status(200).send('Acknowledged (Record not found)');
        }
  
        // 2. Transient failures (Database down, Network error) should still return 500
        console.error('Critical Webhook Error:', error);
        res.status(500).send('Webhook Processing Error');
      }
     

  
}));


//create payment session/get payment link to redirect user to ipos, then ipos sends results to hook
router.post('/ipospays/createPaymentSession', requireAuth,loadContext,resolveClientContext,
  auditMiddleware({action: 'payment.created', resourceType:'payment'}),
  asyncHandler( async (req, res) => {
  
    const { invoiceId } = req.body;
  
try {
  const response = await PaymentService.checkPaymentLink(invoiceId);
  if (response.payment_url) {
      res.json({ url: response.payment_url });
  } else {
      res.status(400).json({ error: "Failed to generate URL" });
  }
} catch (error) {
  console.error(error.response?.data || error.message );
  res.status(500).json({ error: error.errors?.[0]?.message || error.response?.data || error.message ||"Gateway connection error" });
}


   
}));

router.post('/recordPayment', requireAuth,loadContext, adminOnly, 
  auditMiddleware({action: 'payment.recorded', resourceType:'payment'}),
  asyncHandler( async (req, res) => {
    const{ amount,method,invoice_id, date, notes,paymentHistory} = req.body
    //paid_at,status,recorded_by, transactionReferenceId, reference, notes
   
  const invoice = await db('invoices').where({ id: invoice_id }).first()
  //.update({...invData, created_by: req.user.id}).returning('*');
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
  const reference = PaymentService.generatePaymentReference();
  const [payment] = await db('payments').insert({
    amount: amount,
    method,
    reference,
    status: 'completed',
    invoice_id : invoice.id,
    client_id: invoice.client_id,
    recorded_by: req.user.id,
    paid_at: date || new Date()
  
  }).returning('*');

  const newTotalPaid = (invoice.amount_paid || 0) + parseFloat(amount);
  const balanceDue = (invoice.total_amount || 0) - newTotalPaid;
  const newStatus = balanceDue <= 0 ? 'paid' : newTotalPaid > 0 ? 'partial' : selectedInvoice.status;
  await db('invoices')
  .where({ id: invoice_id })
  .update({ amount_paid: newTotalPaid, balance_due: balanceDue, status: newStatus, paymentHistory: JSON.stringify(paymentHistory ?? [])});

  // Mark invoice paid if amount covers total
  // if (parseFloat(amount) >= parseFloat(invoice.total_due)) {
  //   await db('invoices')
  //     .where({ id: invoice_id })
  //     .update({ status: 'paid', amount_paid: newTotalPaid, balance_due: balanceDue, status: newStatus});
  // }

  res.status(201).json({ payment });
}));
router.get('/', requireAuth,loadContext,resolveClientContext, 
  asyncHandler( async (req, res) => {
  const { invoice_id, status, method, page = 1, limit = 50 } = req.query;
  const offset = (page - 1) * limit;

  let query = db('payments as p')
    .join('clients as t', 't.id', 'p.client_id')
    .select('p.*', 't.company_name as client_name');
    if (req.query.client_id) query.where('p.client_id', req.query.client_id);
 clientScope(query, req);

  if (req.clientId) query.where('p.client_id', req.clientId);
  if (invoice_id)   query.where('p.invoice_id', invoice_id);
  if (status)       query.where('p.status', status);
  if (method)       query.where('p.method', method);
  let payments;
  if (req.query.id) {
    payments = await query.where('p.id', req.query.id).first();
    if (!result) return res.status(404).json({ error: 'Invoice not found' });
  } else {
    const [{ count }] = await query.clone().count('p.id as count');
   payments = await query.orderBy('p.created_at', 'desc').limit(limit).offset(offset);

  res.json({ payments, total: parseInt(count) });
  }

  
}));

router.get('/:id', requireAuth,loadContext, async (req, res) => {
  const payment = await db('payments as p')
    .join('clients as t', 't.id', 'p.client_id')
    .join('invoices as i', 'i.id', 'p.invoice_id')
    .where('p.id', req.params.id)
    .select('p.*', 't.name as client_name', 'i.invoice_number')
    .first();
  if (!payment) return res.status(404).json({ error: 'Payment not found' })
  // if (req.clientId && payment.client_id !== req.clientId) return res.status(403).json({ error: 'Forbidden' });
  res.json({ payment });
});
router.post('/:id/refund', requireAuth,loadContext, adminOnly, 
  auditMiddleware({action: 'payment.refunded', resourceType:'payment'}),
  asyncHandler( async (req, res) => {
    const { amount, reason } = req.body;
  const payment = await db('payments').where({ id: req.params.id, status: 'completed' }).first();
  if (!payment) return res.status(404).json({ error: 'Completed payment not found' });

  const refundAmount = amount || payment.amount;
  if (parseFloat(refundAmount) > parseFloat(payment.amount)) {
    return res.status(400).json({ error: 'Refund amount exceeds original payment' })
  }

  const [refund] = await db('payments')
    .insert({
      invoice_id:       payment.invoice_id,
      client_id:        payment.client_id,
      amount:           -Math.abs(refundAmount),
      method:           payment.method,
      status:           'refunded',
      reference:        `REFUND-${payment.reference}`,
      notes:            reason,
      // parent_payment_id: payment.id,
      recorded_by:      req.user.id,
    })
    .returning('*');

  // Reopen invoice if refunded
  await db('invoices')
    .where({ id: payment.invoice_id, status: 'paid' })
    .update({ status: 'sent'});
    // .update({ status: 'sent', paid_at: null, updated_at: new Date() });

  res.status(201).json({ refund });
  }))

module.exports = router;

