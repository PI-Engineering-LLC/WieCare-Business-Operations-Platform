require('dotenv').config();
const db       = require('../db');
const axios = require('axios');
const notificationService = require('../services/notifications.service'); 
const {formatToStrict13}= require('../utils/phone')

const BASE_URL = process.env.IPOSPAYS_SANDBOX === 'true'
  ? process.env.IPOSPAYS_SANDBOX_API_URL
  : process.env.IPOSPAYS_API_URL
  const TPN = process.env.IPOSPAYS_SANDBOX === 'true'
  ? process.env.IPOSPAYS_SANDBOX_TPN
  : process.env.IPOSPAYS_SANDBOX_TPN;
  const AUTH_TOKEN = process.env.IPOSPAYS_SANDBOX === 'true'
  ? process.env.IPOSPAYS_SANDBOX_AUTH_TOKEN
  : process.env.IPOSPAYS_SANDBOX_AUTH_TOKEN;

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
      'Content-Type': 'application/json'
  }
};

class PaymentService {
  async  checkPaymentLink(invoiceId) {
    //check if there is an invoice and auth
    const invoice = await db('invoices as i')
       .where('i.id', invoiceId)
       .whereNotIn('status', ['paid'])
       .leftJoin('clients as t', 't.id', 'i.client_id')
       .select('i.*', 't.contact_phone', 't.contact_email')
       .first();
    if (!invoice) throw new Error('Invoice not found');
    if (invoice.balance_due <= 0 || invoice.status === 'paid') throw new Error('No balance due');;
    
    const paymentAmount = invoice.balance_due;

    let payment = await db('payments')
    .where({ invoice_id: invoiceId, method: 'ipospays'})
    .whereNotIn('status', 'completed')
    .whereNotNull('link')
    .orderBy('created_at', 'desc').first();
    if (payment && (payment.status !== 'completed')) {
      // 2. Query POS to see if link is still valid/active - wrong query post payment.link
      // const status = await reconcilePaymentStatus(payment.transactionReferenceId);

      const response =  await axios.post(`${payment.link}`, {}, config);
      
      // If POS says link expires, get new link and update failed payment with possibly new amount
      if (response.status === 'Expired' || response.responseMessage === 'Link Expired'  || response.responseCode === 'IPOS-ERR-002') {
         
          const paymentLinkInfo =  await this.getPaymentLink(paymentAmount,invoiceId, invoice.invoice_number, payment.transactionReferenceId, invoice.contact_email, invoice.contact_phone )
          await db('payments').where({ id: payment.id }).update({amount:paymentAmount,  link: paymentLinkInfo.link, status: 'pending' });
          return ({ payment_url: paymentLinkInfo.link });
      } else {
          return ({ payment_url: payment.link });
      }
  }else{
    const amountInCents = Math.round(paymentAmount * 100);
    const transactionReferenceId = `IN${invoiceId}--${Date.now().toString(36)}`
    const reference = this.generatePaymentReference();
    const method ='ipospays'
    const paymentLinkInfo = await this.getPaymentLink(paymentAmount,invoiceId, invoice.invoice_number, transactionReferenceId, invoice.contact_email, invoice.contact_phone )
         
    const [payment] = await db('payments').insert({
  amount: paymentAmount,
  method,
  transactionReferenceId: transactionReferenceId,
  reference,
  link: paymentLinkInfo.link, 
  status: 'pending',
  invoice_id : invoiceId,
  client_id: invoice.client_id

}).returning('*');
  }

  return ({ payment_url: paymentLinkInfo.link });
    // const amountInCents = Math.round(invoice.balance_due * 100);
    // let formattedPhoneNo;
    // if(invoice.contact_phone) formattedPhoneNo = formatToStrict13(invoice.contact_phone)
    // // const [payment] = await db('payments').insert({
      
    // }).returning('*');
  }
async  getPaymentLink(paymentAmount,invoiceId, invoiceNumber,transactionReferenceId, contact_email, contact_phone='' ) {
    // iPOSpays requires amount in cents
    const amountInCents = Math.round(paymentAmount * 100);
    
    let formattedPhoneNo;
    if(contact_phone) formattedPhoneNo = formatToStrict13(contact_phone)
    
    // const config = {
    //     headers: {
    //         // This is the Auth Token you generated in the portal
    //         'token': AUTH_TOKEN, 
    //         'Content-Type': 'application/json'
    //     }
    // }
    const body = {
        "merchantAuthentication": {
      "merchantId": TPN, // Your Cloud TPN
      "transactionReferenceId": transactionReferenceId
  },
  "transactionRequest": {
      "transactionType": 1, // 1 = Sale
      "amount": amountInCents.toString(), // e.g., "25.00"
      "calculateFee": true,
    "tipsInputPrompt": false,
    "calculateTax": false,
      "invoiceNumber": invoiceNumber
  },
  // Callback for the server (Webhook)
  "notificationOption": {
    "notifyBySMS": false,
    "notifyByPOST": true,
      "postAPI": `${process.env.BACKEND_URL}/api/payments/webhook/ipospays?secret="${process.env.WEBHOOK_SECRET}`,
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
    "customerEmail": contact_email,
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
        const response = await axios.post(`${BASE_URL}`, body, config);
        
        if (response.data.information) {
          
            return {link: response.data.information};
        } else {
            // res.status(400).json({ error: "Failed to generate URL" });
            console.error("Failed to generate URL: POS response missing 'information'.", response.data);
                
             throw new Error("Failed to generate URL" );
        }
    } catch (error) {
        console.error("Error fetching payment URL:", error);
        throw new Error("Failed to communicate with POS for URL generation");
    }
}
async reconcilePaymentStatus (transactionReferenceId) {
  const payment = await db('payments').where({ transactionReferenceId }).whereNotIn('status', 'completed').first();
  if(!payment){
    // we still need to do an audit log of this attempt in the db so create a new payment
    const statusData = await axios.get(`${QUERY_URL}`, {
      params: { tpn: TPN, transactionReferenceId: transactionReferenceId }
  }, config);

  const querySuccess =  statusData.status       
  const { responseCode, responseMessage, transactionReferenceId,amount, errResponseCode, errResponseMessage, responseApprovalCode } = statusData.data;
  // const status = statusData.status
    const reference = this.generatePaymentReference();
    const method ='ipospays'
         
    const [orphanPayment] = await db('payments').insert({
  amount: amount,
  method,
  transactionReferenceId: transactionReferenceId,
  reference,
  status: (responseCode === '200' || responseCode == 200) ?'completed' : 'failed',
  paid_at: (responseCode === '200' || responseCode == 200) ? new Date() : null,
   raw_response: JSON.stringify(statusData.data)
  })
  const invoiceId = transactionReferenceId.split('--')[0].split('IN')[1];  //See if invoice can be found
  const invoice = await db('invoices as i')
       .where('i.id', invoiceId)
       .leftJoin('clients as t', 't.id', 'i.client_id')
       .select('i.*', 't.contact_phone', 't.contact_email')
       .first();
  if(invoice){
    await db('payments').where({ id: orphanPayment.id }).update({invoice_id : invoice.id, client_id: invoice.client_id });
          
  }
  throw new Error('Payment record not found');
}
  //Prevent double counting
  if (payment.status === 'completed') return 'completed';
  const config = {
    headers: {
        // This is the Auth Token you generated in the portal
        'Authorization': AUTH_TOKEN, 
        'Content-Type': 'application/json'
    }
  }
  // 1. Fetch live status from POS
  const statusData = await axios.get(`${QUERY_URL}`, {
      params: { tpn: TPN, transactionReferenceId: transactionReferenceId }
  }, config);

  const querySuccess =  statusData.status       
  const { responseCode, responseMessage, transactionReferenceId,amount, errResponseCode, errResponseMessage, responseApprovalCode } = statusData.data;
  // const status = statusData.status

  // 2. Map POS status to your DB status
  let newStatus = 'pending';
  if (responseCode == '200' || responseCode == 200) newStatus = 'completed';
  else if (['Cancelled', 'Declined', 'Rejected'].includes(responseMessage)) newStatus =  'failed';

  // 3. Update DB within transaction - can change txrefid to paymentid since payment includes invoice
  const invoiceId = payment.invoice_id
  const amountPaid = parseFloat(amount) / 100;
  await db.transaction(async (trx) => {
     const method ='ipospays'
     const reference = `PAY-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${Math.random().toString(36).slice(2,6)}`
     if (newStatus === 'failed') {
      await trx('payments')
          .where({ transactionReferenceId })
          .update({ amount: amountPaid, status: newStatus, raw_response: JSON.stringify(statusData.data) });
          await this.notifyClientOfPaymentFailure(invoiceId, amountPaid, responseCode, errResponseMessage)
          
return newStatus;
     }
      
      if (newStatus === 'completed') {
          // Recalculate and update invoice...
           const inv = await trx('invoices').where({ id: invoiceId }).first();
          if (inv) {
            const newPaid    = parseFloat(amountPaid || 0) ;
            const newBalance = parseFloat(inv.total_amount) - newPaid;
            const paymentHistory = [...(inv.payment_history || []), {
              date: new Date().toISOString().split('T')[0],
              amountPaid: parseFloat(amountPaid),
              method,
              transactionReferenceId,
              reference,
              invoice_id : invoiceId,
              status: newStatus
            }]; 
            const newInvoiceStatus  = newBalance <= 0 ? 'paid' : newPaid > 0 ? 'partial' : inv.status;
            
            await trx('invoices').where({ id: invoiceId }).update({
              amount_paid: newPaid,
              balance_due: Math.max(0, newBalance),
              payment_history: JSON.stringify(paymentHistory ?? []),
              status:      newInvoiceStatus,
              updated_at:  new Date(),
            });

            await trx('payments')
          .where({ id: payment.id, transactionReferenceId })
          .update({ amount: amountPaid, paid_at: new Date().toISOString().split('T')[0], status: newStatus, raw_response: JSON.stringify(statusData.data) });
          
           //Send notification and email
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
      }
  });
  
  return newStatus;
};
async  updateMyInvoiceRecord(invoiceId, amountPaid, transactionId,method ='ipospays') {
  const inv = await db('invoices').where({ id: invoiceId }).first();
    if (inv) {
      const newPaid    = parseFloat(amountPaid || 0) ;
      const newBalance = parseFloat(inv.total_amount) - newPaid;
      const newStatus  = newBalance <= 0 ? 'paid' : 'partial';
      const paymentHistory = [...(inv.payment_history || []), {
        date: new Date().toISOString().split('T')[0],
        amountPaid: parseFloat(amountPaid),
        method,
        transactionReferenceId: transactionId,
        reference : `PAY-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${Math.random().toString(36).slice(2,6)}`,
        invoice_id : invoiceId,
        status: 'completed'
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
async  notifyClientOfPaymentFailure(invoiceId, amountPaid, responseCode, errResponseMessage) {
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
 generatePaymentReference() {
  const timestamp = new Date().toISOString().replace(/[-T:.Z]/g, '').slice(0, 12); // e.g., 202607161525
  const randomSuffix = Math.random().toString(36).substring(2, 6).toUpperCase(); // e.g., A7X2
  return `PAY-${timestamp}-${randomSuffix}`;
}
}

module.exports = new PaymentService();