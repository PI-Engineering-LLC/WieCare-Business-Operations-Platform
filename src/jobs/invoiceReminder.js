require('dotenv').config();
const db = require('../db');
const notificationService = require('../services/notifications.service');
const emailService = require('../services/email.service');

// async function runOverDueClientsHold() {
//     // Daily at 8am: auto-hold clients with invoices overdue > 60 days
//     const cutoff = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
//     const overdueInvoices = await db('invoices')
//         .where(function () {
//             this.where('issue_date', '<', cutoff.toISOString().split('T')[0])
//                 .orWhere('due_date', '<', new Date());
//         })
//         .whereNotIn('status', ['paid', 'cancelled'])
//         .select('client_id', 'id');

//     const invIds = [...new Set(overdueInvoices.map(i => i.id))];
//     if (invIds.length) await db('invoices').whereIn('id', invIds).update({ status: 'overdue' });

//     const ids = [...new Set(overdueInvoices.map(i => i.client_id))];
//     if (ids.length) await db('clients').whereIn('id', ids).update({ on_hold: true });
//     await db('clients').whereNotIn('id', ids.length ? ids : ['none']).where({ on_hold: true }).update({ on_hold: false });
// }
// async function runInvoiceReminders() {
//     //Daily at 9am, check for invoices that are due in 3 days
//     const days = 3
//     const soon = new Date(Date.now() + days * 86400000);
//     const fiftySixDaysFromNow = new Date();
//     fiftySixDaysFromNow.setDate(fiftySixDaysFromNow.getDate() + 56);

//     const invoices = await db('invoices')
//         .where(function () {
//             this.whereRaw(`due_date::date = ?`, [soon.toISOString().split('T')[0]])
//                 .orWhere('issue_date', '=', fiftySixDaysFromNow);
//         })
//         // .whereRaw(`due_date::date = ?`, [soon.toISOString().split('T')[0]])
//         .whereNotIn('status', ['paid', 'cancelled']);

//     for (const invoice of invoices) {
//         const client = await db('clients').where({ id: invoice.client_id }).first();
//         //send notification and email to all client user
//         const title = `Invoice ${invoice.invoice_number} Due in ${days} Days - Payment Reminder`
//         const message = `<p>Invoice <strong>${invoice.invoice_number}</strong> for <strong>$${(invoice.balance_due || 0).toLocaleString()}</strong> is due in ${days} days and unpaid.</p>
//                    <p>Please remit payment to avoid your account being placed on hold.</p>`
//         if (client?.contact_email) {
//             message = `<h2>Invoice Reminder from ${invoice.sending_entity || 'Wiegand'}</h2><p>Dear ${client.contact_name || client.company_name},</p>${message} `

//             await emailService.queue({
//                 type: 'invoice_reminder', to: client?.contact_email, payload: {
//                     title,
//                     message,
//                 }
//             });
//         }
//         notificationService.notifyClientUsers({ email: client.contact_email, clientId: client.id, type: 'reminder', category: 'invoice', title, message })
//     }
// }
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
        .whereNotIn('status', ['paid', 'cancelled'])
        .where('balance_due', '>', 0)
        .select('client_id', 'id');

    const invIds = [...new Set(overdueInvoices.map(i => i.id))];
    const clientIds = [...new Set(overdueInvoices.map(i => i.client_id))];

    // 3. Perform batch updates
    if (invIds.length) {
        await db('invoices').whereIn('id', invIds).update({ status: 'overdue' });
    }

    if (clientIds.length) {
        await db('clients').whereIn('id', clientIds).update({ on_hold: true });
        // Reset on_hold for clients NOT in the overdue list
        await db('clients')
            .whereNotIn('id', clientIds.length ? clientIds : ['none'])
            .where({ on_hold: true })
            .update({ on_hold: false });
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
        .whereNotIn('status', ['paid', 'cancelled'])
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
            payload: { title, emailMessage }
        });

        const message = `Invoice ${invoice.invoice_number}for $${(invoice.balance_due || 0).toLocaleString()}is due in ${days} days and unpaid.`

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
            .whereNotIn('status', ['paid', 'cancelled'])
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
                payload: { title, emailMessage }
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
// async function runInvoiceOverDue() {
//     // Daily at 8am: send invoice overdue warnings at 30 and 45 days
//     for (const days of [30, 45]) {
//         const d = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
//         const invoices = await db('invoices')
//             .where(function () {
//                 this.whereRaw(`issue_date::date = ?`, [d.toISOString().split('T')[0]])
//                     .orWhere('due_date', '<', new Date());
//             })
//             // .whereRaw(`issue_date::date = ?`, [d.toISOString().split('T')[0]])
//             .whereNotIn('status', ['paid', 'cancelled']);

//         for (const invoice of invoices) {
//             const client = await db('clients').where({ id: invoice.client_id }).first();
//             const title = `Invoice ${invoice.invoice_number} — ${days}-Day Payment Reminder`
//             const message = `<p>Invoice <strong>${invoice.invoice_number}</strong> for <strong>$${(invoice.balance_due || 0).toLocaleString()}</strong> is ${days} days old and unpaid.</p>
//                  <p>Please remit payment to avoid your account being placed on hold at 60 days.</p>`

//             if (client?.contact_email) {
//                 message = `<h2>Invoice Overdue Reminder from ${invoice.sending_entity || 'Wiegand'}</h2><p>Dear ${client.contact_name || client.company_name},</p>${message} `
//                 await emailService.queue({
//                     type: 'invoice_reminder', to: client?.contact_email, payload: {
//                         title,
//                         message,
//                     }
//                 });
//             }

//             notificationService.notifyClientUsers({ email: client.contact_email, clientId: client.id, type: 'warning', category: 'invoice', title, message })

//         }
//     }

// }
module.exports = { runOverDueClientsHold, runInvoiceReminders, runInvoiceOverDue }
