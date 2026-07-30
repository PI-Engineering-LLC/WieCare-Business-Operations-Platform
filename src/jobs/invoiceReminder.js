require('dotenv').config();
const db = require('../db');
const notificationService = require('../services/notifications.service');
const emailService = require('../services/email.service');
const { getIO } = require('../config/socket');

async function runOverDueClientsHold() {
    // Daily at 8am: auto-hold clients with invoices overdue > 60 days
    // Calculate cutoff date (60 days ago) 
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 60);

    // 2. Identify overdue invoices
    const overdueInvoices = await db('invoices')
        .where(function () {
            this.where('issue_date', '<', cutoff)
                .orWhere('due_date', '<', new Date());
        })
        .whereNotIn('status', ['paid', 'cancelled', 'draft'])
        .where('balance_due', '>', 0)
        .select('client_id', 'id');

    const invIds = [...new Set(overdueInvoices.map(i => i.id))];
    const clientIds = [...new Set(overdueInvoices.map(i => i.client_id))];

    // 3. Perform batch updates
    if (invIds?.length > 0) {
        await db('invoices').whereIn('id', invIds).update({ status: 'overdue' });
        await db('invoices').where('status', 'overdue').where('balance_due', '>', 0).whereNotIn('id', invIds).update({ status: 'sent' });
        await db('invoices').where('status', 'overdue').where('balance_due', '<=', 0).whereNotIn('id', invIds).update({ status: 'paid' });
        
    }

    if (clientIds?.length > 0) {
        await db('clients').whereIn('id', clientIds).update({ on_hold: true });
        // Reset on_hold for clients NOT in the overdue list
        await db('clients')
            .whereNotIn('id', clientIds )
            .where({ on_hold: true })
            .update({ on_hold: false });
            // const io = getIO();
            //     if (io) {
            //         clientIds.forEach((id) => {
            //       io.to(`client:${invoice.client_id}`).emit('notification:new', { category:'invoice'});
            //     })
            // }
    }
    


}
async function runInvoiceReminders() {
    const days = 3;
    const soon = new Date();
    soon.setDate(soon.getDate() + days);

    const fiftySevenDaysFromNow = new Date();
    fiftySevenDaysFromNow.setDate(fiftySevenDaysFromNow.getDate() + 57);

    // 1. Fetch relevant invoices
    const invoices = await db('invoices')
        .where(function () {
            this.where('due_date', '=', soon)
                .orWhere('issue_date', '=', fiftySevenDaysFromNow);
        })
        .whereNotIn('status', ['paid', 'cancelled', 'draft'])
        .where('balance_due', '>', 0);

    if (invoices.length === 0) return;

    // 2. Optimization: Fetch all needed clients in ONE query using a Map
    const clientIds = [...new Set(invoices.map(i => i.client_id))];
    const clients = await db('clients').whereIn('id', clientIds);
    const clientMap = new Map(clients.map(c => [c.id, c]));

    // 3. Process
    for (const invoice of invoices) {
        const client = clientMap.get(invoice.client_id);
        if (!client?.contact_email) continue;

        const title = `Invoice ${invoice.invoice_number} Due in ${days} Days - Payment Reminder`;

        // Use 'let' to allow reassignment
        let emailMessage = `<p>Invoice <strong>${invoice.invoice_number}</strong> for <strong>$${(invoice.balance_due || 0).toLocaleString()}</strong> is due in ${days} days and unpaid.</p>
                       <p>Please remit payment to avoid your <a href='${process.env.FRONTEND_URL}'>account</a> being placed on hold.</p>`;

        emailMessage = `<h2>Invoice Reminder from ${invoice.sending_entity || 'Wiegand'}</h2><p>Dear ${client.contact_name || client.company_name},</p>${emailMessage}`;

        await emailService.queue({
            type: 'invoice_reminder',
            to: client.contact_email,
            payload: { title, message:emailMessage }
        });

        const message = `Invoice ${invoice.invoice_number}for $${(invoice.balance_due || 0).toLocaleString()} is due in ${days} days and unpaid.`

        notificationService.notifyClientUsers({
            email: client.contact_email,
            clientId: client.id,
            type: 'reminder',
            category: 'invoice',
            link: `/Invoices?invoice_id=${invoice.id}`,
            title,
            message,
            is_email_sent: !!client?.contact_email,
            resourceId: invoice.id,
            resourceType: "invoice_reminder"
        });
    }
}
async function runInvoiceOverDue() {
    // Daily at 8am: send invoice overdue warnings at 30 and 45 days
    const intervals = [30, 45];
    const now = new Date();

    for (const days of intervals) {
        const targetDate = new Date();
        targetDate.setDate(now.getDate() - days);

        const invoices = await db('invoices')
            .where('issue_date', '=', targetDate)
            .whereNotIn('status', ['paid', 'cancelled','draft'])
            .where('balance_due', '>', 0);

        if (invoices.length === 0) continue;

        // Bulk lookup for clients to avoid N+1 queries
        const clientIds = [...new Set(invoices.map(i => i.client_id))];
        const clients = await db('clients').whereIn('id', clientIds);
        const clientMap = new Map(clients.map(c => [c.id, c]));

        for (const invoice of invoices) {
            const client = clientMap.get(invoice.client_id);
            if (!client?.contact_email) continue;

            const title = `Invoice ${invoice.invoice_number} — ${days}-Day Payment Reminder`;
            let emailMessage = `<p>Invoice <strong>${invoice.invoice_number}</strong> for <strong>$${(invoice.balance_due || 0).toLocaleString()}</strong> is ${days} days old and unpaid.</p>
                           <p>Please remit payment to avoid your <a href='${process.env.FRONTEND_URL}'>account</a> being placed on hold at 60 days.</p>`;

            emailMessage = `<h2>Invoice Overdue Reminder from ${invoice.sending_entity || 'Wiegand'}</h2><p>Dear ${client.contact_name || client.company_name},</p>${emailMessage}`;

            await emailService.queue({
                type: 'invoice_reminder',
                to: client.contact_email,
                payload: { title, message:emailMessage  }
            });
            const message = `Invoice ${invoice.invoice_number}for $${(invoice.balance_due || 0).toLocaleString()} is ${days} days old and unpaid.<`


            notificationService.notifyClientUsers({
                email: client.contact_email,
                clientId: client.id,
                type: 'warning',
                category: 'invoice',
                link: `/Invoices?invoice_id=${invoice.id}`,
                title,
                message,
                is_email_sent: !!client?.contact_email,
                resourceId: invoice.id,
                resourceType: "invoice_reminder"
            });
        }
    }
}
module.exports = { runOverDueClientsHold, runInvoiceReminders, runInvoiceOverDue }
