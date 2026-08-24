require('dotenv').config();
const db = require('../db');
const axios = require('axios');
const notificationService = require('../services/notifications.service');
const { formatToStrict13 } = require('../utils/phone')
const {getIO} = require('../config/socket')
// const { nanoid } = require('nanoid');

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
function generateReferenceId() {
  // Convert current millisecond timestamp to Base36 (~8 characters)
  const timePart = Date.now().toString(36);
  //  Generate 5 random alphanumeric characters using Base36
  const randomPart = Math.random().toString(36).substring(2, 7);

  // ombine and return as uppercase (Total: ~13 characters)
  return (timePart + randomPart).toUpperCase();
}

class PaymentService {
  async checkPaymentLink(invoiceId) {
    //check if there is an invoice and auth
    const invoice = await db('invoices as i')
      .where('i.id', invoiceId)
      .whereNotIn('i.status', ['paid'])
      .leftJoin('clients as t', 't.id', 'i.client_id')
      .select('i.*', 't.contact_phone', 't.contact_email')
      .first();
    if (!invoice) throw new Error('Invoice not found');
    let paymentAmount = invoice.balance_due;
    const query = db('payments').where({ invoice_id: invoiceId }).whereIn('status', ['completed']).sum('amount as total');
    const resultA = await query;
    
    console.log("Raw result:", resultA);

    const result = await db('payments')
    .whereIn('status', ['completed'])
    .where({ invoice_id: invoiceId })
    .sum('amount as total')
    .first();
    const total = parseFloat(result.total || 0);
    console.log("details", invoice,total, result, invoiceId)
    if((invoice.total_amount - invoice.amount_paid - total <=0) && invoice.status !== 'paid'){
      //update invoice balance due and status
      const newPaid = parseFloat(total || 0);
            const newBalance = parseFloat(invoice.total_amount) - newPaid;
            const newInvoiceStatus = newBalance <= 0 ? 'paid' : newPaid > 0 ? 'partial' : invoice.status;

            const [updatedInvoice ] =await db('invoices').where({ id: invoiceId }).update({
              amount_paid: newPaid,
              balance_due: Math.max(0, newBalance),
              status: newInvoiceStatus,
              updated_at: new Date(),
            }).returning('*');;
            paymentAmount = updatedInvoice.balance_due
            if(updatedInvoice.status === 'paid') throw new Error('Invoice is now Paid!')

    }
    if(( invoice.amount_paid !==total) && invoice.status !== 'paid'){
      //update invoice balance due and status
      const newPaid = parseFloat(total || 0);
            const newBalance = parseFloat(invoice.total_amount) - newPaid;
            const newInvoiceStatus = newBalance <= 0 ? 'paid' : newPaid > 0 ? 'partial' : invoice.status;

            const [updatedInvoice ] =await db('invoices').where({ id: invoiceId }).update({
              amount_paid: newPaid,
              balance_due: Math.max(0, newBalance),
              status: newInvoiceStatus,
              updated_at: new Date(),
            }).returning('*');;
            paymentAmount = updatedInvoice.balance_due
            if(updatedInvoice.status === 'paid') throw new Error('Invoice is Paid!')
      

    }
    

    if (invoice.balance_due <= 0 || invoice.status === 'paid') throw new Error('No balance due');;

    // const paymentAmount = invoice.balance_due;
    // const totalAmount = payments.reduce((sum, payment) => sum + payment.amount, 0);
    
    let payment = await db('payments')
      .where({ invoice_id: invoiceId, method: 'ipospays' })
      .whereNotIn('status', ['completed'])
      .whereNotNull('link')
      .orderBy('created_at', 'desc').first();
    console.log("@@@%%%", payment)
    const expiryDays = 1;
    if (payment && (payment.status !== 'completed')) {
      const now = new Date();

      //Check if an active, unexpired link exists
      //&& payment.link_expires_at > now
      if (payment.link ) {
        // First check if payment was successful or if it failed
        const response = await axios.get(QUERY_URL, {
          headers: {
            'Authorization': AUTH_TOKEN,
            'Content-Type': 'application/json'
          },
          params: {
            tpn: TPN,
            transactionReferenceId: payment.transactionReferenceId
          }
        });
        if (response.data.data.responseCode === '200' || response.data.data.responseCode === 200) {
          //payment successful but did not hit webhook. update to completed and set link expired to now?
          console.log('successful payment. mark as complete. TODO: update invoice balance due', response.data.data)
          await db('payments').where({ id: payment.id }).update({ status: 'completed', link_expires_at: now });
          
          // const newPaid = parseFloat(payment.amount || 0);
          //   const newBalance = parseFloat(invoice.total_amount) - newPaid;
          //   const newInvoiceStatus = newBalance <= 0 ? 'paid' : newPaid > 0 ? 'partial' : invoice.status;

          //   await db('invoices').where({ id: invoiceId }).update({
          //     amount_paid: newPaid,
          //     balance_due: Math.max(0, newBalance),
          //     status: newInvoiceStatus,
          //     updated_at: new Date(),
          //   });

          return ({ payment_status: response.data.data.responseMessage })
        } else if (response.data.data.responseCode === '400' || response.data.data.responseCode === 400) {
          console.log('failed payment. geerate new link',response.data.data)
          //payment failed but did not hit. Generate new link? Sometimes it failed but got completed after
          await db('payments').where({ id: payment.id }).update({ status: 'failed', link_expires_at: now });
          // const transactionId = `IN${invoiceId}--${Date.now().toString(36)}` 
          const transactionId = `IN${generateReferenceId()}`
          console.log("transactionId",transactionId)
          const reference = this.generatePaymentReference();
          const method = 'ipospays'
          const paymentLinkInfo = await this.getPaymentLink(paymentAmount, invoiceId, invoice.invoice_number, transactionId, expiryDays, invoice.contact_email, invoice.contact_phone)
          console.log("%%%1", paymentLinkInfo)
          const expirationDate = new Date();
          expirationDate.setDate(expirationDate.getDate() + expiryDays);
         await db('payments').insert({
            amount: paymentAmount,
            method,
            transactionReferenceId: transactionId,
            reference,
            link: paymentLinkInfo.link,
            link_expires_at: expirationDate,
            status: 'pending',
            invoice_id: invoiceId,
            client_id: invoice.client_id

          }).returning('*');
          return ({ payment_url: paymentLinkInfo.link });

        }


        console.log(`Active link found for payment ${payment.id}. Reusing existing URL.`);
        return ({ payment_url: payment.link });
      } else {
        console.log(" payment exists,  not completed, link is not active... expired at is null")
        // const txReferenceId = `IN${invoiceId}--${Date.now().toString(36)}`
        const txReferenceId = `IN${generateReferenceId()}`
      
        const paymentLinkInfo = await this.getPaymentLink(paymentAmount, invoiceId, invoice.invoice_number, payment.transactionReferenceId, expiryDays, invoice.contact_email, invoice.contact_phone)
        console.log("%%%", paymentLinkInfo)
        const expirationDate = new Date();
        expirationDate.setDate(expirationDate.getDate() + expiryDays);
        await db('payments').where({ id: payment.id }).update({ amount: paymentAmount, link: paymentLinkInfo.link, status: 'pending', link_expires_at: expirationDate });
        return ({ payment_url: paymentLinkInfo.link });

      }

    } else {
      const amountInCents = Math.round(paymentAmount * 100);
      // const transactionReferenceId = `IN${invoiceId}--${Date.now().toString(36)}`
      // const transactionNewReferenceId = `IN${invoiceId}--${Date.now().toString(36)}`
      const transactionNewReferenceId = `IN${generateReferenceId()}`
      console.log("%%%%%%%%%%%%%%%%",transactionNewReferenceId)
      const reference = this.generatePaymentReference();
      const method = 'ipospays'
      const paymentLinkInfo = await this.getPaymentLink(paymentAmount, invoiceId, invoice.invoice_number, transactionNewReferenceId, expiryDays, invoice.contact_email, invoice.contact_phone)
      console.log("%%%1", paymentLinkInfo)
      const expirationDate = new Date();
      expirationDate.setDate(expirationDate.getDate() + expiryDays);
      const [payment] = await db('payments').insert({
        amount: paymentAmount,
        method,
        transactionReferenceId: transactionNewReferenceId,
        reference,
        link: paymentLinkInfo.link,
        link_expires_at: expirationDate,
        status: 'pending',
        invoice_id: invoiceId,
        client_id: invoice.client_id

      }).returning('*');
      return ({ payment_url: paymentLinkInfo.link });
    }


    // const amountInCents = Math.round(invoice.balance_due * 100);
    // let formattedPhoneNo;
    // if(invoice.contact_phone) formattedPhoneNo = formatToStrict13(invoice.contact_phone)
    // // const [payment] = await db('payments').insert({

    // }).returning('*');
  }
  async getPaymentLink(paymentAmount, invoiceId, invoiceNumber, transactionReferenceId, expiryDays, contact_email, contact_phone = '') {
    // iPOSpays requires amount in cents
    const amountInCents = Math.round(paymentAmount * 100);

    let formattedPhoneNo;
    if (contact_phone) formattedPhoneNo = formatToStrict13(contact_phone)

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
        // "invoiceNumber": invoiceNumber,
        "expiry": Number(expiryDays), //Link expires after 1 day

      },
      // Callback for the server (Webhook)
      "notificationOption": {
        "notifyBySMS": false,
        "notifyByPOST": true,
        "postAPI": `${process.env.BACKEND_URL}/api/payments/webhook/ipospays/secret=${process.env.WEBHOOK_SECRET}`,
        // "postAPI": `${process.env.BACKEND_URL}/api/payments/webhook/ipospays?secret="${process.env.WEBHOOK_SECRET}`,
        "notifyByRedirect": true,
        "returnUrl": `${process.env.FRONTEND_URL}/Invoices?action=invoices`,
        "failureUrl": `${process.env.FRONTEND_URL}/Invoices?action=retry`,
        "cancelUrl": `${process.env.FRONTEND_URL}/Invoices?action=cancel`,
        "expiry": Number(expiryDays), //Link expires after 1 day
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
        "sendPaymentLink": false,
      },
      "personalization": {
        // "logoUrl":'',
      },
     
    };

    try {
      const response = await axios.post(`${BASE_URL}`, body, config);
      console.log("$$$$$$$$", response.data.information, response.data)

      if (response.data.information) {

        return { link: response.data.information };
      } else {
        // res.status(400).json({ error: "Failed to generate URL" });
        console.error("Failed to generate URL: POS response missing 'information'.", response.data);

        throw new Error("Failed to generate URL");
      }
    } catch (error) {
      console.error("Error fetching payment URL:", error.response.data.errors);
      throw new Error("Failed to communicate with POS for URL generation");
    }
  }
  async reconcilePaymentStatus(transactionReferenceId, responseCode, responseMessage, amount, errResponseCode, errResponseMessage, responseApprovalCode, reqBody ) {
    console.log("PayquerySData%%%0", responseCode, responseMessage, amount, errResponseCode, errResponseMessage, responseApprovalCode,reqBody)

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
      const reference = this.generatePaymentReference();
      const method = 'ipospays'

      const [orphanPayment] = await db('payments').insert({
        amount: amount,
        method,
        transactionReferenceId: transactionReferenceId,
        reference,
        status: (responseCode === '200' || responseCode == 200) ? 'completed' : 'failed',
        paid_at: (responseCode === '200' || responseCode == 200) ? new Date() : null,
        raw_response: JSON.stringify(reqBody)
      })
      // const invoiceId = transactionReferenceId.split('IN')[1]; 
      // // const invoiceId = transactionReferenceId.split('--')[0].split('IN')[1];  //See if invoice can be found
      // const invoice = await db('invoices as i')
      //   .where('i.id', invoiceId)
      //   .leftJoin('clients as t', 't.id', 'i.client_id')
      //   .select('i.*', 't.contact_phone', 't.contact_email')
      //   .first();
      // if (invoice) {
      //   await db('payments').where({ id: orphanPayment.id }).update({ invoice_id: invoice.id, client_id: invoice.client_id });

      // }
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
      console.log("PayquerySData%%%1", responseCode, responseMessage, amount, errResponseCode, errResponseMessage, responseApprovalCode,reqBody)

      // 2. Map POS status to your DB status
      let newStatus = 'pending';
      if (responseCode == '200' || responseCode == 200) newStatus = 'completed';
      else if (['Cancelled', 'Declined', 'Rejected'].includes(responseMessage)) newStatus = 'failed';

      // 3. Update DB within transaction - can change txrefid to paymentid since payment includes invoice
      const invoiceId = payment.invoice_id
      const amountPaid = parseFloat(amount) / 100;
      await db.transaction(async (trx) => {
        const method = 'ipospays'
        const reference = `PAY-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.random().toString(36).slice(2, 6)}`
        if (newStatus === 'failed') {
          await trx('payments')
            .where({ transactionReferenceId })
            .update({ amount: amountPaid, status: newStatus, raw_response: JSON.stringify(reqBody) });
          await this.notifyClientOfPaymentFailure(invoiceId, amountPaid, responseCode, errResponseMessage)

          return newStatus;
        }

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
              .update({ amount: amountPaid, paid_at: new Date().toISOString().split('T')[0], status: newStatus, raw_response: JSON.stringify(reqBody) });

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
          }
        }
      });

      return newStatus;
    }
  };
  async updateMyInvoiceRecord(invoiceId, amountPaid, transactionId, method = 'ipospays') {
    const inv = await db('invoices').where({ id: invoiceId }).first();
    if (inv) {
      const newPaid = parseFloat(amountPaid || 0);
      const newBalance = parseFloat(inv.total_amount) - newPaid;
      const newStatus = newBalance <= 0 ? 'paid' : 'partial';
      const paymentHistory = [...(inv.payment_history || []), {
        date: new Date().toISOString().split('T')[0],
        amountPaid: parseFloat(amountPaid),
        method,
        transactionReferenceId: transactionId,
        reference: `PAY-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.random().toString(36).slice(2, 6)}`,
        invoice_id: invoiceId,
        status: 'completed'
        // reference: `PAY-${Date.now()}` transactionId
      }];
      await db('invoices').where({ id: invoiceId }).update({
        amount_paid: newPaid,
        balance_due: Math.max(0, newBalance),
        payment_history: JSON.stringify(paymentHistory ?? []),
        status: newStatus,
        updated_at: new Date(),
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
        title: 'Payment Received',
        message: `Payment of $${amountPaid.toFixed(2)} received for invoice #${inv.invoice_number}`,
        type: 'success',
        category: 'invoice',
        link: `/Invoices?invoice_id=${inv.id}`,
        isSendEmail: is_email_sent,
        resourceId: inv.id,
        resourceType: "invoice"
      });
    }
    return true;


  }
  async notifyClientOfPaymentFailure(invoiceId, amountPaid, responseCode, errResponseMessage) {
    console.log("PayquerySData%%%7")
    const inv = await db('invoices').where({ id: invoiceId }).first();
    console.log("PayquerySData%%%8")
    if (inv) {

      let clientContactEmail = null;
      let is_email_sent = false;
      let client_id = inv.client_id;
      if (is_email_sent) {
        // Fetch the client's contact email if email sending is requested
        const client = await db('clients').where({ id: inv.client_id }).select('contact_email').first();
        if (client) {
          clientContactEmail = client.contact_email;
        } else {
          console.warn(`Client with ID ${inv.client_id} not found for email notification.`);
        }
      }

      const notifications = await notificationService.notifyClientUsers({
        clientId: inv.client_id,
        email: clientContactEmail, // Pass the contact email for the service to use
        title: 'Payment Error',
        message: `Payment of $${amountPaid.toFixed(2)} for invoice #${inv.invoice_number} not approved, no action taken. ${responseCode} ${errResponseMessage}`,
        type: 'error',
        category: 'invoice',
        link: `/Invoices?invoice_id=${inv.id}`,
        isSendEmail: is_email_sent,
        resourceId: inv.id,
        resourceType: "invoice"
      });
      // await notificationService.notifyAllAdmins({ title: 'Payment Error', message: `Payment of $${amountPaid.toFixed(2)} for invoice #${inv.invoice_number} not approved, no action taken. ${responseCode} ${errResponseMessage}`, type: 'error', category: 'invoice', link: `/AdminInvoices?invoice_id=${inv.id}` })
      // const io = getIO();
      if (io) {
        io.to('admins').emit('notification:new', { category:'invoice'})
        // io.to('admins').emit('notification:new', { title: 'Payment Error', message: `Payment of $${amountPaid.toFixed(2)} for invoice #${inv.invoice_number} not approved, no action taken. ${responseCode} ${errResponseMessage}`, type: 'error', category: 'invoice', link: `/AdminInvoices?invoice_id=${inv.id}` });
      }
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