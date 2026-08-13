require('dotenv').config();
const router  = require('express').Router();
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
const validateWebhook = require('../middleware/webhook');
const PaymentService = require('../services/payments')
const BASE_URL = process.env.IPOSPAYS_SANDBOX === 'true'
  ? process.env.IPOSPAYS_SANDBOX_API_URL
  : process.env.IPOSPAYS_API_URL
const TPN = process.env.IPOSPAYS_SANDBOX === 'true'
  ? process.env.IPOSPAYS_SANDBOX_TPN
  : process.env.IPOSPAYS_TPN;
const AUTH_TOKEN = process.env.IPOSPAYS_SANDBOX === 'true'
  ? process.env.IPOSPAYS_SANDBOX_AUTH_TOKEN
  : process.env.IPOSPAYS_AUTH_TOKEN;

const QUERY_URL = process.env.IPOSPAYS_SANDBOX === 'true'
  ? process.env.IPOSPAYS_SANDBOX_QUERY_URL
  : process.env.IPOSPAYS_QUERY_URL
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;


const config = {
  headers: {
    // This is the Auth Token you generated in the portal
    'token': AUTH_TOKEN,
    'Content-Type': 'application/json'
  }
}
// POS Config for API calls
const POS_API_CONFIG = {
  headers: {
    'token': AUTH_TOKEN,
    'Content-Type': 'application/json'
  }
};

// Config for Query API (assuming different auth header as per your reconcilePaymentStatus)
const POS_QUERY_CONFIG = {
  headers: {
    'Authorization': AUTH_TOKEN, // Or the correct header for query API
    'token': AUTH_TOKEN,
    'Content-Type': 'application/json'
  }
};
//router.post(`/webhook/ipospays/secret=${process.env.WEBHOOK_SECRET}`, validateWebhook,
router.post(`/webhook/ipospays/secret=${process.env.WEBHOOK_SECRET}`,
  auditMiddleware({action: 'payment.processed', resourceType:'payment'}),
  asyncHandler( async (req, res) => {
    console.log("^^^^^^^^^",req.params,req.params.secret, req.body.transactionReferenceId, req.body.responseCode, req.body.responseMessage, req.body.amount, req.body.responseApprovalCode, req.body.errResponseMessage)
      // iPOSpays sends response fields in the body
      const { transactionReferenceId, responseCode, responseMessage, amount, errResponseCode, errResponseMessage, responseApprovalCode } = req.body;

      if (!transactionReferenceId) {
        console.error('Invalid Webhook Payload: Missing transactionReferenceId');
        return res.status(400).send('Bad Request');
      }

      try {
        console.log(`--- Webhook Received for Invoice: ${transactionReferenceId} ---`);
        // await PaymentService.reconcilePaymentStatus(transactionReferenceId,responseCode, responseMessage, amount, errResponseCode, errResponseMessage, responseApprovalCode, req.body );
        console.log("PayquerySData%%%0", responseCode, responseMessage, amount, errResponseCode, errResponseMessage, responseApprovalCode,req.body)

    const payment = await db('payments').where({ transactionReferenceId }).whereNotIn('status', ['completed']).first();
    console.log("payment%%%1", payment)
    if (!payment) {
      // we still need to do an audit log of this attempt in the db so create a new payment
      //   const statusData = await axios.get(`${QUERY_URL}`, {
      //     params: { tpn: TPN, transactionReferenceId: transactionReferenceId }
      // }, POS_QUERY_CONFIG);
      // const statusData = await axios.get(QUERY_URL, {
      //   headers: {
      //     'Authorization': AUTH_TOKEN,
      //     'Content-Type': 'application/json'
      //   },
      //   params: {
      //     tpn: TPN,
      //     transactionReferenceId: transactionReferenceId
      //   }
      // });

      // const querySuccess = statusData.data.status
      // console.log("querySuccess%%%1", querySuccess)
      // const { responseCode, responseMessage, amount, errResponseCode, errResponseMessage, responseApprovalCode } = statusData.data.data;
      console.log("querySData%%%1", responseCode, responseMessage, amount, errResponseCode, errResponseMessage, responseApprovalCode)
      // const status = statusData.status
      const reference = PaymentService.generatePaymentReference();
      const method = 'ipospays'

      const [orphanPayment] = await db('payments').insert({
        amount: amount,
        method,
        transactionReferenceId: transactionReferenceId,
        reference,
        status: (responseCode === '200' || responseCode == 200) ? 'completed' : 'failed',
        paid_at: (responseCode === '200' || responseCode == 200) ? new Date() : null,
        raw_response: JSON.stringify(req.body)
      })
      const invoiceId = transactionReferenceId.split('--')[0].split('IN')[1];  //See if invoice can be found
      const invoice = await db('invoices as i')
        .where('i.id', invoiceId)
        .leftJoin('clients as t', 't.id', 'i.client_id')
        .select('i.*', 't.contact_phone', 't.contact_email')
        .first();
      if (invoice) {
        await db('payments').where({ id: orphanPayment.id }).update({ invoice_id: invoice.id, client_id: invoice.client_id });

      }
      throw new Error('Payment record not found');
    } else {
      //Prevent double counting
      if (payment.status === 'completed') return 'completed';
      // const config = {
      //   headers: {
      //       // This is the Auth Token you generated in the portal
      //       'Authorization': AUTH_TOKEN, 
      //       'Content-Type': 'application/json'
      //   }
      // }
      // 1. Fetch live status from POS
      // const statusData = await axios.get(`${QUERY_URL}`, {
      //     params: { tpn: TPN, transactionReferenceId: transactionReferenceId }
      // }, POS_QUERY_CONFIG);
      // const statusData = await axios.get(QUERY_URL, {
      //   headers: {
      //     'Authorization': AUTH_TOKEN,
      //     'Content-Type': 'application/json'
      //   },
      //   params: {
      //     tpn: TPN,
      //     transactionReferenceId: transactionReferenceId
      //   }
      // });

      // const querySuccess = statusData.data.status
      // const { responseCode, responseMessage, amount, errResponseCode, errResponseMessage, responseApprovalCode } = statusData.data.data;
      // const status = statusData.status
      console.log("PayquerySData%%%1", responseCode, responseMessage, amount, errResponseCode, errResponseMessage, responseApprovalCode,req.body)

      // 2. Map POS status to your DB status
      let newStatus = 'pending';
      if (responseCode == '200' || responseCode == 200) newStatus = 'completed';
      else  newStatus = 'failed';
      // else if (['Cancelled', 'Declined', 'Rejected'].includes(responseMessage)) newStatus = 'failed';
      const invoiceId = payment.invoice_id
      const amountPaid = parseFloat(amount) / 100;
      if (newStatus === 'failed') {
        console.log("PayquerySData%%%2")
        await db('payments')
          .where({ id: payment.id, transactionReferenceId })
          .update({ amount: amountPaid, status: newStatus, raw_response: JSON.stringify(req.body) });
          console.log("PayquerySData%%%3")
        await PaymentService.notifyClientOfPaymentFailure(invoiceId, amountPaid, responseCode, errResponseMessage)
        console.log("PayquerySData%%%4")
         return res.status(200).send('OK');;
      }
      // 3. Update DB within transaction - can change txrefid to paymentid since payment includes invoice
      
      await db.transaction(async (trx) => {
        const method = 'ipospays'
        const reference = `PAY-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.random().toString(36).slice(2, 6)}`
       

        if (newStatus === 'completed') {
          // Recalculate and update invoice...
          const inv = await trx('invoices').where({ id: invoiceId }).first();
          if (inv) {
            const newPaid = parseFloat(amountPaid || 0);
            const newBalance = parseFloat(inv.total_amount) - newPaid;
            const paymentHistory = [...(inv.payment_history || []), {
              date: new Date().toISOString().split('T')[0],
              amountPaid: parseFloat(amountPaid),
              method,
              transactionReferenceId,
              reference,
              invoice_id: invoiceId,
              status: newStatus
            }];
            
            const newInvoiceStatus = newBalance <= 0 ? 'paid' : newPaid > 0 ? 'partial' : inv.status;

            await trx('invoices').where({ id: invoiceId }).update({
              amount_paid: newPaid,
              balance_due: Math.max(0, newBalance),
              payment_history: JSON.stringify(paymentHistory ?? []),
              status: newInvoiceStatus,
              updated_at: new Date(),
            });

            await trx('payments')
              .where({ id: payment.id, transactionReferenceId })
              .update({ amount: amountPaid, paid_at: new Date().toISOString().split('T')[0], status: newStatus, raw_response: JSON.stringify(req.body) });

            //Send notification and email
            let clientContactEmail = null;
            let is_email_sent = false;
            let client_id = inv.client_id;
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
              title: 'Payment Received',
              message: `Payment of $${amountPaid.toFixed(2)} received for invoice #${inv.invoice_number}`,
              type: 'success',
              category: 'invoice',
              link: `/Invoices?invoice_id=${inv.id}`,
              isSendEmail: is_email_sent,
              resourceId: inv.id,
              resourceType: "invoice"
            });
            await notificationService.notifyAllAdmins({ title: 'Payment Received', message: `Payment of $${amountPaid.toFixed(2)} received for invoice #${inv.invoice_number}`, type: 'success', category: 'invoice', link: `/AdminInvoices?invoice_id=${inv.id}` });
                  
      //       const io = getIO();
      // if (io) {
      //   io.to('admins').emit('notification:new', { title: 'Payment Received', message: `Payment of $${amountPaid.toFixed(2)} received for invoice #${inv.invoice_number}`, type: 'success', category: 'invoice', link: `/AdminInvoices?invoice_id=${inv.id}` });
      // }
          }
        }
      });

       return res.status(200).send('OK');;
    }
        
        // return res.status(200).send('OK');
  
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
  } else if (response.payment_status) {
    res.status(400).json({ error: `Payment status : ${response.payment_status} ` });
} 
  else {
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
    const{ amount,method,invoice_id, date, notes,paymentHistory, reference} = req.body
    //paid_at,status,recorded_by, transactionReferenceId, reference, notes
   
  const invoice = await db('invoices').where({ id: invoice_id }).first()
  //.update({...invData, created_by: req.user.id}).returning('*');
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
  const referenceGen = PaymentService.generatePaymentReference();
  const [payment] = await db('payments').insert({
    amount: amount,
    method,
    reference: reference || referenceGen,
    status: 'completed',
    invoice_id : invoice.id,
    client_id: invoice.client_id,
    recorded_by: req.user.id,
    paid_at: date || new Date()
  
  }).returning('*');

  const newTotalPaid = parseFloat(invoice.amount_paid || 0) + parseFloat(amount);
  const balanceDue = parseFloat(invoice.total_amount || 0) - newTotalPaid;
  const newStatus = balanceDue <= 0 ? 'paid' : newTotalPaid > 0 ? 'partial' : selectedInvoice.status;
  console.log("newTotalPaid",newTotalPaid,balanceDue, amount, newStatus)
  const [updatedInvoice] =await db('invoices')
  .where({ id: invoice.id })
  .update({ amount_paid: newTotalPaid, balance_due: balanceDue, status: newStatus,  created_by: req.user.id, payment_history: JSON.stringify(paymentHistory ?? [])}).returning('*');

  // Mark invoice paid if amount covers total
  // if (parseFloat(amount) >= parseFloat(invoice.total_due)) {
  //   await db('invoices')
  //     .where({ id: invoice_id })
  //     .update({ status: 'paid', amount_paid: newTotalPaid, balance_due: balanceDue, status: newStatus});
  // }
  // const io = getIO();
  //         if (io) {
  //           io.to(`client:${invoice.client_id}`).emit('notification:new', { clientId:invoice.client_id, title: "Test", message:'', type: 'reminder', category:'invoice'});
  //         }
  const io = getIO();
  if (io) {
    io.to(`client:${invoice.client_id}`).emit('notification:new', {   category:'invoice'});
  }

  res.status(201).json({ payment , updatedInvoice});
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
    // const [{ count }] = await query.clone().count('p.id as count');
   payments = await query.orderBy('p.created_at', 'desc').limit(limit).offset(offset);
   res.json({ payments });
  // res.json({ payments, total: parseInt(count) });
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
    const io = getIO();
    if (io) {
        io.emit('notification:new', { category:'invoice'})
      
      io.to('admins').emit('notification:new', { category:'invoice'})
    }
  res.status(201).json({ refund });
  }))

module.exports = router;

