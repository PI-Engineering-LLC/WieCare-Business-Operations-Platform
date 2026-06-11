const axios = require('axios');
async function getPaymentLink(paymentAmount,invoiceId, invoiceNumber) {
    // iPOSpays requires amount in cents
    const amountInCents = Math.round(paymentAmount * 100);
    const config = {
        headers: {
            // This is the Auth Token you generated in the portal
            'token': process.env.IPOSPAYS_AUTH_TOKEN, 
            'Content-Type': 'application/json'
        }
    }
    const body = {
        "merchantAuthentication": {
      "merchantId": process.env.IPOSPAYS_TPN, // Your Cloud TPN
      "transactionReferenceId": `IN${invoiceId}--${Date.now().toString(36)}`
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
    "eReceiptInputPrompt": false,
    "customerEmail": "info@piengineeringllc.com",
    "customerMobile": "+13122574245",
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
            return response.data.information;
        } else {
            // res.status(400).json({ error: "Failed to generate URL" });
             throw new Error("Failed to generate URL" );
        }
    } catch (error) {
        console.error("Error fetching payment URL:", error);
    }
}
