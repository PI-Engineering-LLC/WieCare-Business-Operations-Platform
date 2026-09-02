console.log('TRACE: services/email.service.js loaded.');
require('dotenv').config();
const { sendEmail } = require('../mailer');
const { initializeAndStartBoss, getBossInstance } = require('../jobs/boss');

class EmailService {

  // ── Template registry ──────────────────────────────────────────────

  EMAIL_TEMPLATES = {
    quote_issue: this.buildQuoteEmail.bind(this),
    maintenance_update: this.buildMaintenanceUpdateEmail.bind(this),
    inspection_reminder: this.buildInspectionReminderEmail.bind(this),
    training_reminder: this.buildTrainingReminderEmail.bind(this),
    training_created: this.buildTrainingCreatedEmail.bind(this),
    training_updated: this.buildTrainingUpdatedEmail.bind(this),
    invoice_issue: this.buildInvoiceEmail.bind(this),
    warranty_update: this.buildWarrantyUpdateEmail.bind(this),
    invite: this.buildInvitationEmail.bind(this),
    reset: this.buildResetEmail.bind(this),
    notification: this.buildNotificationEmail.bind(this),
    invoice_reminder: this.buildEmail.bind(this),
    general: this.buildEmail.bind(this),
    default: this.buildEmail.bind(this),
  };
  // ── Template builders ──────────────────────────────────────────────

  buildQuoteEmail({ is_update, quote, client }) {
    const itemsHtml = (quote.items || []).map(item =>
      `<tr>
          <td style="padding:6px 12px;border-bottom:1px solid #e2e8f0">${item.item_number || '-'}</td>
          <td style="padding:6px 12px;border-bottom:1px solid #e2e8f0">${item.ez_number || '-'}</td>
          <td style="padding:6px 12px;border-bottom:1px solid #e2e8f0">${item.description || ''}</td>
          <td style="padding:6px 12px;border-bottom:1px solid #e2e8f0;text-align:right">${item.quantity}</td>
          <td style="padding:6px 12px;border-bottom:1px solid #e2e8f0;text-align:right">$${(item.unit_price || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
          <td style="padding:6px 12px;border-bottom:1px solid #e2e8f0;text-align:right">$${(item.total || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        </tr>`
    ).join('');
    const discountLine = quote.discount_percent > 0
      ? `<tr><td colspan="5" style="padding:4px 12px;text-align:right;color:#e53e3e">Discount (${quote.discount_percent}%)</td><td style="padding:4px 12px;text-align:right;color:#e53e3e">-$${(quote.subtotal * quote.discount_percent / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td></tr>` : '';
    const packingLine = quote.packing > 0
      ? `<tr><td colspan="5" style="padding:4px 12px;text-align:right">Packing</td><td style="padding:4px 12px;text-align:right">$${quote.packing.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td></tr>` : '';
    const exportLine = quote.export_declaration > 0
      ? `<tr><td colspan="5" style="padding:4px 12px;text-align:right">Export Declaration</td><td style="padding:4px 12px;text-align:right">$${quote.export_declaration.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td></tr>` : '';
    const taxLine = quote.tax_amount > 0
      ? `<tr><td colspan="5" style="padding:4px 12px;text-align:right">Tax (${quote.tax_rate}%)</td><td style="padding:4px 12px;text-align:right">$${quote.tax_amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td></tr>` : '';


    return {
      subject: `${is_update ? '[Updated] ' : ''}Quote ${quote.quote_number || ''} from ${quote.sending_entity || 'Wiegand'} – ${quote.title}`,
      html: `
        <div style="font-family:sans-serif;max-width:680px;margin:0 auto;color:#1a202c">
          <div style="background:#1e3a5f;padding:24px 32px;border-radius:8px 8px 0 0">
            <h1 style="color:white;margin:0;font-size:22px">${is_update ? 'Updated Quote' : 'Quote'} from ${quote.sending_entity || 'Wiegand'}</h1>
          </div>
          <div style="background:#f8fafc;padding:24px 32px;border-radius:0 0 8px 8px;border:1px solid #e2e8f0">
            <p>Dear ${client?.contact_name || client?.company_name},</p>
            <p>${is_update ? 'Your quote has been updated. Please find the latest details below.' : 'Please find your quote details below.'}</p>
            <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px">
              <tr style="background:#edf2f7">
                <th style="padding:8px 12px;text-align:left">Item #</th>
                <th style="padding:8px 12px;text-align:left">EZ #</th>
                <th style="padding:8px 12px;text-align:left">Description</th>
                <th style="padding:8px 12px;text-align:right">Qty</th>
                <th style="padding:8px 12px;text-align:right">Unit Price</th>
                <th style="padding:8px 12px;text-align:right">Total</th>
              </tr>
              ${itemsHtml}
              <tr><td colspan="5" style="padding:4px 12px;text-align:right">Subtotal</td><td style="padding:4px 12px;text-align:right">$${(quote.subtotal || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td></tr>
              ${discountLine}${packingLine}${exportLine}${taxLine}
              <tr style="font-weight:bold;font-size:16px">
                <td colspan="5" style="padding:8px 12px;text-align:right;border-top:2px solid #e2e8f0">Total</td>
                <td style="padding:8px 12px;text-align:right;border-top:2px solid #e2e8f0">$${(quote.total_amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
              </tr>
            </table>
            ${quote.valid_until ? `<p style="font-size:13px;color:#718096">This quote is valid until <strong>${quote.valid_until}</strong>.</p>` : ''}
            <p>Please <a href='${process.env.FRONTEND_URL}'>log in</a> to your portal to review and approve or request changes.</p>
            <p style="margin-top:24px;color:#718096;font-size:13px">— ${quote.sending_entity || 'Wiegand'}</p>
          </div>
        </div>
      `,
    };
  }

  buildInspectionReminderEmail({ client, scheduled_date, year }) {
    return {
      subject: `Annual Inspection Reminder – ${year}`,
      html: `
      <div style="font-family:sans-serif;max-width:680px;margin:0 auto">
        <h2>Annual Inspection Reminder</h2>
        <p>Dear ${client.contact_name || "Customer"},</p>
        <p>This is a reminder that your annual inspection for <strong>${year}</strong> 
          ${scheduled_date ? `is scheduled for <strong>${scheduled_date}</strong>` : 'has not yet been scheduled'}.
        </p>
        <p>Please <a href='${process.env.FRONTEND_URL}'>log in</a> to your portal to confirm or schedule your inspection.</p>
      </div>
    `,
    };
  }
  buildMaintenanceUpdateEmail({ maintenance, client}) {
    const formattedDate = maintenance.scheduled_date 
  ? new Date(maintenance.scheduled_date).toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: 'UTC' // Forces parsing exactly as stored without shifting zones
    })
  : '';
    return {
      subject: `Maintenance Update: ${maintenance.title}`,
      html: `
      <div style="font-family:sans-serif;max-width:680px;margin:0 auto;color:#1a202c">
  <div style="background:#1e3a5f;padding:24px 32px;border-radius:8px 8px 0 0">
    <h1 style="color:white;margin:0;font-size:22px">Maintenance Update: ${maintenance.title}</h1>
  </div>
  <div style="background:#f8fafc;padding:24px 32px;border-radius:0 0 8px 8px;border:1px solid #e2e8f0">
  <p>Dear ${client.contact_name || "Customer"},</p>
    <p>Your maintenance request has been updated.</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px">
      <tr><td style="padding:6px 12px;font-weight:bold;border-bottom:1px solid #e2e8f0">New Status</td><td style="padding:6px 12px;border-bottom:1px solid #e2e8f0">${maintenance.status}</td></tr>
      ${formattedDate ? `<tr><td style="padding:6px 12px;font-weight:bold;border-bottom:1px solid #e2e8f0">Scheduled Date</td><td style="padding:6px 12px;border-bottom:1px solid #e2e8f0">${formattedDate}</td></tr>` : ''}
    </table>
    ${maintenance.completion_notes ? `<p><strong>Completion Notes:</strong> ${maintenance.completion_notes}</p>` : ''}
    <p>Please <a href='${process.env.FRONTEND_URL}'>log in</a> to your portal to review the request.</p>
  </div>
</div>
    `,
    };
  }
  buildTrainingReminderEmail({ client, scheduled_date, year }) {
    return {
      subject: `Annual Training Reminder – ${year}`,
      html: `
      <div style="font-family:sans-serif;max-width:680px;margin:0 auto">
        <h2>Annual Training Reminder</h2>
        <p>Dear ${client.contact_name || "Customer"},</p>
        <p>This is a reminder that your annual training for <strong>${year}</strong> 
          ${scheduled_date ? `is scheduled for <strong>${scheduled_date}</strong>` : 'has not yet been scheduled'}.
        </p>
        <p>Please <a href='${process.env.FRONTEND_URL}'>log in</a> to your portal to confirm or schedule your training.</p>
      </div>
    `,
    };
  }
  buildTrainingCreatedEmail({ training, client}) {
    return {
      subject: `New Training Session – ${training.title}`,
      html: `

      <div style="font-family:sans-serif;max-width:680px;margin:0 auto;color:#1a202c">
  <div style="background:#1e3a5f;padding:24px 32px;border-radius:8px 8px 0 0">
    <h1 style="color:white;margin:0;font-size:22px">New Training Session: ${training.title}</h1>
  </div>
  <div style="background:#f8fafc;padding:24px 32px;border-radius:0 0 8px 8px;border:1px solid #e2e8f0">
    <p>A new ${training.category} training session has been scheduled for <strong>${training.coaster_name}</strong>.</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px">
      <tr><td style="padding:6px 12px;font-weight:bold;border-bottom:1px solid #e2e8f0">Date</td><td style="padding:6px 12px;border-bottom:1px solid #e2e8f0">${training.session_date}</td></tr>
      <tr><td style="padding:6px 12px;font-weight:bold;border-bottom:1px solid #e2e8f0">Time</td><td style="padding:6px 12px;border-bottom:1px solid #e2e8f0">${training.start_time} - ${training.end_time}</td></tr>
      <tr><td style="padding:6px 12px;font-weight:bold;border-bottom:1px solid #e2e8f0">Location</td><td style="padding:6px 12px;border-bottom:1px solid #e2e8f0">${training.location}</td></tr>
    </table>
    <p>Please <a href='${process.env.FRONTEND_URL}'>log in</a> to your portal to view more details and register.</p>
  </div>
</div>
    `,
    };
  }
  buildTrainingUpdatedEmail({ training, client}) {
    return {
      subject: `Training Session – ${training.title} Updated`,
      html: `

      <div style="font-family:sans-serif;max-width:680px;margin:0 auto;color:#1a202c">
  <div style="background:#1e3a5f;padding:24px 32px;border-radius:8px 8px 0 0">
    <h1 style="color:white;margin:0;font-size:22px">New Training Session: ${training.title}</h1>
  </div>
  <div style="background:#f8fafc;padding:24px 32px;border-radius:0 0 8px 8px;border:1px solid #e2e8f0">
    <p>The ${training.category} training session for <strong>${training.coaster_name}</strong> has been updated.</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px">
      <tr><td style="padding:6px 12px;font-weight:bold;border-bottom:1px solid #e2e8f0">Date</td><td style="padding:6px 12px;border-bottom:1px solid #e2e8f0">${training.session_date}</td></tr>
      <tr><td style="padding:6px 12px;font-weight:bold;border-bottom:1px solid #e2e8f0">Time</td><td style="padding:6px 12px;border-bottom:1px solid #e2e8f0">${training.start_time} - ${training.end_time}</td></tr>
      <tr><td style="padding:6px 12px;font-weight:bold;border-bottom:1px solid #e2e8f0">Location</td><td style="padding:6px 12px;border-bottom:1px solid #e2e8f0">${training.location}</td></tr>
    </table>
    <p>Please <a href='${process.env.FRONTEND_URL}'>log in</a> to your portal to view more details and register.</p>
  </div>
</div>
    `,
    };
  }
  buildInvoiceEmail({ invoice, client }) {
    const itemsHtml = (invoice.items || []).map(item => `
        <tr>
          <td style="padding:6px 12px;border-bottom:1px solid #e2e8f0">${item.description || ''}</td>
          <td style="padding:6px 12px;border-bottom:1px solid #e2e8f0;text-align:right">${item.quantity}</td>
          <td style="padding:6px 12px;border-bottom:1px solid #e2e8f0;text-align:right">$${(item.unit_price || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        </tr>`
    ).join('');
    return {
      subject: `Invoice ${invoice.invoice_number || ''} – ${invoice.title}`,
      html: `
        <div style="font-family:sans-serif;max-width:680px;margin:0 auto">
          <h2>Invoice from ${invoice.sending_entity || 'Wiegand'}</h2>
          <p>Dear ${client.contact_name || client.company_name},</p>
          <p>Please find your invoice from ${invoice.sending_entity || 'Wiegand'} is ready.</p>
          <p>Total: $${(invoice.total_amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
          <p>Please <a href='${process.env.FRONTEND_URL}'>log in</a> to your portal to view details.</p>
        </div>
      `,
    };
  }
  buildWarrantyUpdateEmail({ claim, client}) {
    return {
      subject: `Warranty Claim Update: ${claim.claim_number}`,
      html: `
<div style="font-family:sans-serif;max-width:680px;margin:0 auto;color:#1a202c">
  <div style="background:#1e3a5f;padding:24px 32px;border-radius:8px 8px 0 0">
    <h1 style="color:white;margin:0;font-size:22px">Warranty Claim Update: ${claim.claim_number}</h1>
  </div>
  <div style="background:#f8fafc;padding:24px 32px;border-radius:0 0 8px 8px;border:1px solid #e2e8f0">
    <p>Your warranty claim status has been updated to: <strong>${claim.status}</strong></p>
    ${claim.resolution ? `<p><strong>Resolution:</strong> ${claim.resolution}</p>` : ''}
    ${claim.admin_notes ? `<p><strong>Admin Notes:</strong> ${claim.admin_notes}</p>` : ''}
    <p>Please <a href='${process.env.FRONTEND_URL}'>log in</a> to your portal to review.</p>

  </div>
  </div>
    `,
    };
  }
  buildEmail({ title, message }) {
    return {
      subject: `${title || 'You have a new notification'}`,
      html: `${message ? `
         <div style="font-family:sans-serif;max-width:680px;margin:0 auto">
     
        <p>${message}<p/>
        <p>Please <a href='${process.env.FRONTEND_URL}'>log in</a> to the portal to view.</p>
        </div>
        ` :

        `
      <div style="font-family:sans-serif;max-width:680px;margin:0 auto">
        
    <p>Hi,</p>
    <p>You have a new notification. Please <a href='${process.env.FRONTEND_URL}'>log in</a> to the portal to view.</p>
    
  
      </div>
    `

        }`
      ,

    };
  }

  buildInvitationEmail({ inviteUrl, inviterName, inviterOrgName, inviterOrgCoaster }) {
    return {
      from: inviterOrgName ? `${inviterOrgName} via Wiegand` : null,
      subject: 'You\'ve been invited to Wiegand USA Customer Portal',
      html: `<p>Hello!</p>
<p>
  <strong>${inviterName || 'Wiegand'}</strong> has invited you to join 
  <strong>${inviterOrgName || 'Wiegand USA Customer Portal'}</strong> on our platform.
</p>
      <p>Click the link below to set your password and access your account:</p>
           <p><a href="${inviteUrl}" style="background:#1e3a5f;color:white;padding:10px 20px;text-decoration:none;border-radius:5px;">Accept Invite</a></p>
           <p>This link expires in 72 hours.</p>`,
    };
  }

  buildResetEmail({ fullName, resetUrl }) {
    return {
      subject: 'Reset your Wiegand Customer Portal password',
      html: `
      <p>Hi ${fullName},</p>
      <p>Click the link below to reset your password. This link expires in 1 hour.</p>
      <a href="${resetUrl}" style="
        display:inline-block;padding:12px 24px;background:#005f27;
        color:white;border-radius:8px;text-decoration:none;font-weight:600;
      ">Reset Password</a>
      <p>If you didn't request this, you can safely ignore this email.</p>
    `,
    };
  }
  buildNotificationEmail(data) {
    return {
      subject: 'You have a new notification',
      html: `
      <p>Hi,</p>
      <p>You have a new notification. Please <a href='${process.env.FRONTEND_URL}'>log in</a> to the portal to view.</p>
      
    `,
    };
  }


  // ── Main dispatcher ────────────────────────────────────────────────
  async send({ to, type, payload }) {
    const { subject, html, from } = this.renderTemplate(type, payload);
    console.log(subject, html)
    await sendEmail({ to, subject, body: html, from });
  }
  renderTemplate(type, payload) {
    let builder = this.EMAIL_TEMPLATES[type];
    if (!builder) builder = this.EMAIL_TEMPLATES['default'];
    return builder(payload);
  }
  //queue email
  async queue({ to, type, payload, delaySeconds = 0 }) {
    const boss = await initializeAndStartBoss();
    if (!boss) {
      console.error("Attempted to queue email, but PgBoss failed to start or is not started after initializeAndStartBoss. Critical error.");
      throw new Error("Email queuing service unavailable due to PgBoss startup failure.");

    }
    await boss.send(
      'send-email',
      {
        to: to,
        type: type,
        payload: payload
      },
      { startAfter: delaySeconds > 0 ? new Date(Date.now() + delaySeconds * 1000) : undefined }
    );
  }

}
module.exports = new EmailService();
