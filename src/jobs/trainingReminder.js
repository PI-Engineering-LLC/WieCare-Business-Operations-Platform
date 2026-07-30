const db = require('../db');
const notificationService = require('../services/notifications.service');
const emailService = require('../services/email.service');

async function runTrainingReminders() {
  const oneYearAgo = new Date();
  const thisYear = oneYearAgo.getFullYear();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  //TODO check that maintenance training request has not been created for ones that are not in recentTrainings
  const recentTrainings = await db('training_sessions as tr')
    .where('tr.category', 'maintenance')
    .where('status', 'completed')
    .where('tr.session_date', '<', oneYearAgo)
    .select('client_id');
  const trainings = recentTrainings.map(r => r.client_id);
  const query = db('clients').where({ status: 'active' })
  if (trainings && trainings.length > 0) {
    query.whereNotIn('id', trainings);
  }
    const clients = await query;

    for (const c of clients) {
      const title = `Annual Maintenance Training Due`
      const message = `Your annual maintenance training is due. Please request or schedule training.`

      if (c?.contact_email) {
        await emailService.queue({
          type: 'training_reminder', to: c?.contact_email, payload: {
            client: c,
            year: thisYear
          }
        });
      }
      notificationService.notifyClientUsers({ email: c.contact_email, clientId: c.id, type: 'reminder', category: 'training', link: `/Training`, title, message, is_email_sent: !!c?.contact_email })

    }
  }


module.exports = { runTrainingReminders };
