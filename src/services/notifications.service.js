require('dotenv').config();
const db = require('../db');
const emailService = require('./email.service');
const { getIO } = require('../config/socket');

class NotificationService {

  async notify({ userId, email, clientId, title, message, type = 'info', category = 'general', link, resourceId, resourceType, is_email_sent=false, isSendEmail = false }) {
    const [notification] = await db('notifications').insert({
      recipient_id: userId,
      recipient_email: email,
      client_id: clientId,
      title,
      message,
      type,
      category,
      link,
      resource_id: resourceId,
      resource_type: resourceType,
      is_email_sent: isSendEmail || is_email_sent,
      created_at: new Date(),
      updated_at: new Date(),
    }).returning('*');

    const io = getIO();
    if (io) {
        io.to(`user:${userId}`).emit('notification:new', notification);
        if (clientId) {
          io.to(`client:${clientId}`).emit('notification:new', notification);
        }
    }

    if (isSendEmail && email) {
      await emailService.queue({ to: email, type: category, payload: { title, message, link } });
    }
    return notification;
  }

  // REVISED: 'email' parameter is back for the single client contact email
  async notifyClientUsers({ email, clientId, title, message, type = 'info', category = 'general', link, resourceId, resourceType, is_email_sent=false, isSendEmail = false }) {
    if (clientId) {
        const users = await db('client_memberships as cm')
          .leftJoin('users as u', 'u.id', 'cm.user_id')
          .where({ 'cm.client_id': clientId })
          .where({ 'u.deleted_at': null })
          .whereNot({ 'u.status': 'inactive' })
          .select([
            'u.id as user_id',
            'u.email',
          ]);

        const notificationsToInsert = users.map(user => ({
            recipient_id: user.user_id,
            recipient_email: user.email,
            client_id: clientId,
            title,
            message,
            type,
            category,
            link,
            resource_id: resourceId,
            resource_type: resourceType,
            is_email_sent: isSendEmail || is_email_sent, // In-app notification, not email for each user
            created_at: new Date(),
            updated_at: new Date(),
          }));

        if (notificationsToInsert.length > 0) {
          const notifications = await db('notifications').insert(notificationsToInsert).returning('*');

          const io = getIO();
          if (io) {
            io.to(`client:${clientId}`).emit('notification:new', { clientId, title, message, type, category, link, resourceId, resourceType});
          }

          if (isSendEmail && email) { // Send email ONLY to the provided contact email
            const CHUNK_SIZE = 1000; // Best size for most email APIs
    let emailBatch = [];

    for  (const user of users) {
      emailBatch.push(user.email);

      //  Once the chunk is full, push the array to the queue
      if (emailBatch.length === CHUNK_SIZE) {
        await emailService.queue({ to: emailBatch, type: category, payload: { title, message, link } });
        emailBatch = []; // Reset the array
      }
    }

    // Queue any remaining users left in the last batch
    if (emailBatch.length > 0) {
      await emailService.queue({ to: emailBatch, type: category, payload: { title, message, link } });

   
    }
              // await emailService.queue({ to: email, type: category, payload: { title, message, link } });
          }
          return notifications;
        }
    }
    return [];
  }

  async notifyAllAdmins({ title, message, type = 'info', category = 'general', link, resourceId, resourceType,is_email_sent=false, isSendEmail = false }) {
    const admins = await db('users')
      .whereIn('platform_role', ['super_admin', 'platform_admin'])
      .whereNot({ 'status': 'inactive' });

    const notificationsToInsert = admins.map(admin => ({
      recipient_id: admin.id,
      recipient_email: admin.email,
      title,
      message,
      type,
      category,
      link,
      resource_id: resourceId,
      resource_type: resourceType,
      is_email_sent: isSendEmail || is_email_sent,
      created_at: new Date(),
      updated_at: new Date(),
    }));

    if (notificationsToInsert.length > 0) {
      const notifications = await db('notifications').insert(notificationsToInsert).returning('*');
      const io = getIO();
      if (io) {
        io.to('admins').emit('notification:new', { title, message, type, category, link, resourceId, resourceType });
      }
      if (isSendEmail) {
        const adminEmail = process.env.ADMIN_EMAIL
        if (adminEmail) {
          await emailService.queue({ to: adminEmail, type: category, payload: { title, message, link } });
      }
        // for (const admin of admins) {
        //   if (admin.email) {
        //       await emailService.queue({ to: admin.email, type: category, payload: { title, message, link } });
        //   }
        // }
      }
      return notifications;
    }
    return [];
  }
}

module.exports = new NotificationService();