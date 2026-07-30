const db = require('../db');
const notificationService = require('../services/notifications.service');
const emailService = require('../services/email.service');

async function runInspectionReminders() {
  // 1st of each month: annual inspection reminders
  const oneYearAgo = new Date();
  const thisYear = oneYearAgo.getFullYear();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  //TODO check that maintainence request has not been created where preferred date is > oneYear ago, exclude those clientIds. Handle new clients
  const recentInspections = await db('maintenance_requests')
    .where('maintenance_type', 'inspection')
    .where('status', 'completed')
    .where('scheduled_date', '<', oneYearAgo)
    .select('client_id');

  const inspected = recentInspections.map(r => r.client_id);
  const query = db('clients').where({ status: 'active' })
  if (inspected && inspected.length > 0) {
    query.whereNotIn('id', inspected);
  }
  const clients = await query;
  for (const c of clients) {
    const title = `Annual Inspection Due`
    const message = `Your annual inspection is due. Please schedule a service visit.`
    notificationService.notifyClientUsers({ email: c.contact_email, clientId: c.id, category: 'inspection', type: 'reminder', link: `/Maintenance`, title, message, is_email_sent: !!c?.contact_email })
    await emailService.queue({
      type: 'inspection_reminder', to: c?.contact_email, payload: {
        client: c,
        year: thisYear
      }
    });
  }
}



module.exports = { runInspectionReminders }
