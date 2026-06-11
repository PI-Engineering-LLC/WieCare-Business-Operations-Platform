const db = require('../db');
const notificationService = require('../services/notifications.service'); 
const emailService = require('../services/email.service' );

async function runTrainingReminders() {
    const oneYearAgo = new Date();
    const thisYear = oneYearAgo.getFullYear();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const trainingCategory = "maintenance"
    const recentTrainings = await db('training_registrations as tr')
    .leftJoin(
        'training_sessions as t',
        't.id',
        'tr.training_id'
    )
    .where('tr.completion_date', '>', oneYearAgo)
    .where('t.category', 'maintenance')
    .select('client_id');
  
    const trainings = recentTrainings.map(r => r.client_id);
    const clients = await db('clients').where({ status: 'active' })
      .whereNotIn('id', trainings.length ? trainings : ['none']);
  
    for (const c of clients) {
        const title =`Annual Maintenance Training Due`
        const message=`<p>Hi ${c.contact_name || c.company_name},</p>
                 <p>Your annual maintenance training is due. Please log in to request or schedule training.</p>`
  
      if (c?.contact_email) {
        await emailService.queue({ type: 'training_reminder', to: c?.contact_email, payload: {       
          client: c,
          year: thisYear
        } });
      }
      notificationService.notifyClientUsers({email: c.contact_email,clientId: c.id, type:'reminder', category:'training', title, message})
      
    }

}

module.exports = {runTrainingReminders};
