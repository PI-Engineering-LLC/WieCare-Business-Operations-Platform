const router = require('express').Router();
const db = require('../db');
const requireAuth = require('../middleware/auth');
const loadContext = require('../middleware/loadContext');
const clientContext = require('../middleware/clientContext');
const resolveClientContext = require('../middleware/resolveClientContext');
const adminOnly = require('../middleware/adminOnly');
const clientScope = require('../middleware/clientScope');
const asyncHandler = require('../middleware/asyncHandler');
const auditMiddleware = require('../middleware/auditMiddleware');
const holdCheck  = require('../middleware/holdCheck');
const notificationService = require('../services/notifications.service');
const emailService = require('../services/email.service' );
const { getIO } = require('../config/socket');

router.get('/', requireAuth,loadContext, resolveClientContext, 
  asyncHandler( async (req, res) => {
  let q = db('maintenance_requests').orderBy('created_at', 'desc');
  if (req.query.client_id) q = q.where({ client_id: req.query.client_id });
  
    q = clientScope(q, req);
    let result;
    if (req.query.id) {
      result = await q.where({ id: req.query.id }).first();
      if (!result) return res.status(404).json({ error: 'Maintenance request not found' });
    } else {
      result = await q;
    }
    res.json(result);
}));

// router.get('/:id', requireAuth, async (req, res) => {
//   const req_ = await db('maintenance_requests').where({ id: req.params.id }).first();
//   res.json(req_);
// });

router.post('/', requireAuth,loadContext,resolveClientContext,holdCheck, 
  auditMiddleware({action: 'maintenance.created', resourceType:'maintenance'}),
  asyncHandler( async (req, res) => {
  const client = await db('clients').where({ id: req.clientId || req.body.client_id }).first();
  const [mr] = await db('maintenance_requests').insert({
    ...req.body,
    client_id: req.clientId || req.body.client_id ,
    client_name: client?.company_name,
    attachments: JSON.stringify(req.body.attachments ?? []),
    created_by: req.user.id,
    request_number: `MR-${Date.now().toString().slice(-6)}`
  }).returning('*');
  const title= 'New Maintenance Request';
  const message= `A new ${mr.maintenance_type} request has been submitted by ${client?.company_name || 'a client'}`;
   
  await notificationService.notifyAllAdmins({
            title,
            message,
            type: 'info',
            category: 'maintenance',
            resourceId: mr.id,
            resourceType: "maintenance",
            is_email_sent: true
            // isSendEmail: true
          })
          await notificationService.emailAdmins({ type: "maintenance_request", payload: { title, message } });
          // const adminEmail = process.env.ADMIN_EMAIL
          //         if (adminEmail) {
          //           await emailService.queue({ to: adminEmail, type: "maintenance_request", payload: { title, message } });
          //       }
  res.status(201).json(mr);
}));
router.patch('/:id', requireAuth,loadContext, adminOnly, 
  auditMiddleware({action: 'maintenance.updated', resourceType:'maintenance'}),
  asyncHandler( async (req, res) => {
  const [mr] = await db('maintenance_requests').where({ id: req.params.id }).update({...req.body,attachments: JSON.stringify(req.body.attachments ?? [])}).returning('*');
  const client = await db('clients').where({ id: mr.client_id}).first();
  await notificationService.notifyClientUsers({
              clientId: mr.client_id,
              email: client?.contact_email,
              title: `Maintenance Update: ${mr.title || ''} `,
              message: `Your maintenance request has been updated.`,
              type: 'info',
              category: 'maintenance',
              link: `/Maintenance`,
              is_email_sent: !!client?.contact_email,
              resourceId: mr.id,
              resourceType: "maintenance"
            });
          if(client) {
            await notificationService.emailClientAdmins({ type: 'maintenance_update', clientId: client?.id, payload: {
              maintenance: mr,
                client,
              } });
              // await emailService.queue({ type: 'maintenance_update', to: client?.contact_email, payload: {
              //   maintenance: mr,
              //     client,
              //   } });
      
          }
  res.json(mr);
}));

module.exports = router;