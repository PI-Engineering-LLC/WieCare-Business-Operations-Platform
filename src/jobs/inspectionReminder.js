const db = require('../db');
const notificationService = require('../services/notifications.service'); 
const emailService = require('../services/email.service' );

async function runInspectionReminders() {
    // 1st of each month: annual inspection reminders
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  
    const recentInspections = await db('maintenance_requests')
      .where('maintenance_type', 'inspection')
      .where('status', 'completed')
      .where('updated_at', '>', oneYearAgo)
      .select('client_id');
  
    const inspected = recentInspections.map(r => r.client_id);
    const clients = await db('clients').where({ status: 'active' })
      .whereNotIn('id', inspected.length ? inspected : ['none']);
  
    for (const c of clients) {
        const title =`Annual Inspection Due`
        const message=`<p>Hi ${c.contact_name || c.company_name},</p>
                 <p>Your annual inspection is due. Please log in to schedule a service visit.</p>`
      notificationService.notifyClientUsers({email: c.contact_email,clientId: c.id, category: 'inspection', type:'reminder', title, message})
      await emailService.queue({ type: 'inspection_reminder', to: c?.contact_email, payload: {       
              client: c,
              year: thisYear
            } });
    }

}
module.exports = {runInspectionReminders}
