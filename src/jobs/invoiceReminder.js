const db = require('../db');
const notificationService = require('../services/notifications.service'); 
const emailService = require('../services/email.service' );

async function runOverDueClientsHold() {
    // Daily at 8am: auto-hold clients with invoices overdue > 60 days
    const cutoff = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    const overdueInvoices = await db('invoices')
        .where('issue_date', '<', cutoff.toISOString().split('T')[0])
        .whereNotIn('status', ['paid', 'cancelled'])
        .select('client_id');

    const ids = [...new Set(overdueInvoices.map(i => i.client_id))];
    if (ids.length) await db('clients').whereIn('id', ids).update({ on_hold: true });
    await db('clients').whereNotIn('id', ids.length ? ids : ['none']).where({ on_hold: true }).update({ on_hold: false });
}
async function runInvoiceReminders() {
    //Daily at 9am, check for invoices that are due in 3 days
    const days = 3
    const soon = new Date(Date.now() + days * 86400000);

    const invoices = await db('invoices')
        .whereRaw(`due_date::date = ?`, [soon.toISOString().split('T')[0]])
        .where('status', ['pending']);

    for (const invoice of invoices) {
        const client = await db('clients').where({ id: inv.client_id }).first();
        //send notification and email to all client user
        const title = `Invoice ${inv.invoice_number} Due in ${days} Days - Payment Reminder`
        const message = `<p>Invoice <strong>${inv.invoice_number}</strong> for <strong>$${(invoice.balance_due || 0).toLocaleString()}</strong> is due in ${days} days and unpaid.</p>
                   <p>Please remit payment to avoid your account being placed on hold.</p>`
        if (client?.contact_email) {
            message = `<h2>Invoice Reminder from ${invoice.sending_entity || 'Wiegand'}</h2><p>Dear ${client.contact_name || client.company_name},</p>${message} `
            
            await emailService.queue({ type: 'invoice_reminder', to: client?.contact_email, payload: {
                title,
                message,
                      } });
        }
        notificationService.notifyClientUsers({ email: client.contact_email,clientId: client.id, type: 'reminder', category:'invoice', title, message })
    }
}
async function runInvoiceOverDue() {
    // Daily at 8am: send invoice overdue warnings at 30 and 45 days
    for (const days of [30, 45]) {
        const d = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        const invoices = await db('invoices')
            .whereRaw(`issue_date::date = ?`, [d.toISOString().split('T')[0]])
            .whereNotIn('status', ['paid', 'cancelled']);

        for (const inv of invoices) {
            const client = await db('clients').where({ id: inv.client_id }).first();
            const title = `Invoice ${inv.invoice_number} — ${days}-Day Payment Reminder`
            const message = `<p>Invoice <strong>${inv.invoice_number}</strong> for <strong>$${(invoice.balance_due || 0).toLocaleString()}</strong> is ${days} days old and unpaid.</p>
                 <p>Please remit payment to avoid your account being placed on hold at 60 days.</p>`

            if (client?.contact_email) {
                message = `<h2>Invoice Overdue Reminder from ${invoice.sending_entity || 'Wiegand'}</h2><p>Dear ${client.contact_name || client.company_name},</p>${message} `
                await emailService.queue({ type: 'invoice_reminder', to: client?.contact_email, payload: {
                    title,
                    message,
                          } });
            }

            notificationService.notifyClientUsers({ email: client.contact_email,clientId: client.id, type: 'warning', category:'invoice', title, message })

        }
    }

}
module.exports = { runOverDueClientsHold, runInvoiceReminders, runInvoiceOverDue }
