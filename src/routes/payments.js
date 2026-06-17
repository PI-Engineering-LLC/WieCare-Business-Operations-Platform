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
const normalizePhone= require('../utils/phone')

router.post('/webhook/ipospays',
  auditMiddleware({action: 'payment.created', resourceType:'payment'}),
  asyncHandler( async (req, res) => {
  try {
      // iPOSpays sends response fields in the body
      const { 
        responseCode,
        transactionReferenceId,
        transactionId,
        totalAmount,
        errResponseCode,
        responseMessage,
        errResponseMessage,
        responseApprovalCode,
          status, 
          transaction_id, 

          amount, 
          message 
      } = req.body;

      console.log(`--- Webhook Received for Invoice: ${transactionReferenceId} ---`);

      //Check if the payment was successful
      if (responseCode == '200' || responseCode == 200) {
          const invoiceId = transactionReferenceId.split('--')[0].split('IN')[1];
          const amountPaid = parseFloat(amount) / 100; // Convert cents back to dollars

          //update invoice
          const updateSuccess = await updateMyInvoiceRecord(invoiceId, amountPaid, transactionReferenceId);

          if (updateSuccess) {
              console.log(`✅ Success: ${amountPaid} applied to Invoice ${invoiceId}`);
              // Send 200 OK to iPOSpays so they stop sending the webhook
              return res.status(200).send('OK');
          } else {
              console.error('❌ Database update failed.');
              return res.status(500).send('Internal Server Error');
          }
      } else {
          console.warn(`⚠️ Payment not approved. Status: ${responseCode}, Message: ${errResponseMessage}`);
          const invoiceId = transactionReferenceId.split('--')[0].split('IN')[1];
          const amountPaid = parseFloat(amount) / 100; 
          notifyClientOfPaymentFailure(invoiceId, amountPaid, responseCode, errResponseMessage)
          return res.status(200).send('Payment not approved, no action taken.');
      }

  } catch (error) {
      console.error('Critical Webhook Error:', error);
      res.status(500).send('Webhook Processing Error');
  }
}));

async function updateMyInvoiceRecord(invoiceId, amountPaid, transactionId,method ='ipospays') {
  const inv = await db('invoices').where({ id: invoiceId }).first();
    if (inv) {
      const newPaid    = parseFloat(amountPaid || 0) ;
      const newBalance = parseFloat(inv.total_amount) - newPaid;
      const newStatus  = newBalance <= 0 ? 'paid' : 'partial';
      const paymentHistory = [...(inv.payment_history || []), {
        date: new Date().toISOString().split('T')[0],
        amountPaid: parseFloat(amountPaid),
        method,
        reference: transactionId
        // reference: `PAY-${Date.now()}` transactionId
      }];      
      await db('invoices').where({ id: invoiceId }).update({
        amount_paid: newPaid,
        balance_due: Math.max(0, newBalance),
        payment_history: JSON.stringify(paymentHistory ?? []),
        status:      newStatus,
        updated_at:  new Date(),
      });
      let clientContactEmail = null;
      let is_email_sent = true;
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
      title:    'Payment Received',
      message:  `Payment of $${amountPaid.toFixed(2)} received for invoice #${inv.invoice_number}`,
      type:     'success',
      category: 'invoice',
      link: `/Invoices?invoice_id=${inv.id}`,
      isSendEmail: is_email_sent,
        resourceId: inv.id,
        resourceType: "invoice"
  });
    }
  return true; 

  
}
async function notifyClientOfPaymentFailure(invoiceId, amountPaid, responseCode, errResponseMessage) {
  const inv = await db('invoices').where({ id: invoiceId }).first();
    if (inv) {
      
      let clientContactEmail = null;
      let is_email_sent = true;
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
      clientId: inv.client_id,
      email: clientContactEmail, // Pass the contact email for the service to use
      title:    'Payment Error',
      message:  `Payment of $${amountPaid.toFixed(2)} for invoice #${inv.invoice_number} not approved, no action taken. ${responseCode} ${errResponseMessage}`,
      type:     'failure',
      category: 'invoice',
      link: `/Invoices?invoice_id=${inv.id}`,
      isSendEmail: is_email_sent,
        resourceId: inv.id,
        resourceType: "invoice"
  });
    }
  return true; 

  
}

//create payment session/get payment link to redirect user to ipos, then ipos sends results to hook
router.post('/ipospays/createPaymentSession', requireAuth,loadContext,resolveClientContext,
  asyncHandler( async (req, res) => {
  
    const { amount, invoiceId } = req.body;
    // const amountInCents = Math.round(amount * 100);

    //check if there is an invoice and auth
    const invoice = await db('invoices').where({ id: invoiceId }).first();
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
  const amountInCents = Math.round(invoice.balance_due * 100);
    const client = await db('clients').where({ id: invoice.client_id || req.clientId }).first();
    let formattedPhoneNo;
    if(client.contact_phone)
    formattedPhoneNo = normalizePhone(client.contact_phone)

    console.log(formattedPhoneNo)
  
  const config = {
    headers: {
        // This is the Auth Token you generated in the portal
        'token': process.env.IPOSPAYS_AUTH_TOKEN, 
        'Content-Type': 'application/json'
    }
};
const body = {
  "merchantAuthentication": {
      "merchantId": process.env.IPOSPAYS_TPN, // Your Cloud TPN
      "transactionReferenceId": `IN${invoice.id}--${Date.now().toString(36)}`
  },
  "transactionRequest": {
      "transactionType": 1, // 1 = Sale
      "amount": amountInCents.toString(), // e.g., "25.00"
      "calculateFee": true,
    "tipsInputPrompt": false,
    "calculateTax": false,
      "invoiceNumber": invoice.invoice_number
  },
  // Callback for the server (Webhook)
  "notificationOption": {
    
    "notifyBySMS": false,
    "notifyByPOST": true,
      "postAPI": `${process.env.BACKEND_URL}/api/payments/webhook/ipospays`,
      "notifyByRedirect": true, 
      "returnUrl": `${process.env.FRONTEND_URL}/Invoices?action=invoices`,
      "failureUrl": `${process.env.FRONTEND_URL}/Invoices?action=retry`, 
      "cancelUrl": `${process.env.FRONTEND_URL}/Invoices?action=cancel`,
  },
 
  "preferences": {
    "integrationType": 1,
    "avsVerification": false,
    "eReceipt": true,
    "eReceiptInputPrompt": formattedPhoneNo?.length !== 13,
    "customerEmail": client.contact_email,
    "customerMobile": formattedPhoneNo,
    "requestCardToken": true,
    "shortenURL": true,
    "sendPaymentLink": true, 
 
  },
  "personalization": {
    // "logoUrl":'',
  },
 
 
};


try {
  const response = await axios.post(`${process.env.IPOSPAYS_API_URL}`, body, config);
  if (response.data.information) {
      res.json({ url: response.data.information });
  } else {
      res.status(400).json({ error: "Failed to generate URL" });
  }
} catch (error) {
  console.error(error.response?.data || error.message );
  res.status(500).json({ error: error.errors?.[0]?.message || error.response?.data || error.message ||"Gateway connection error" });
}


   
}));


module.exports = router;

