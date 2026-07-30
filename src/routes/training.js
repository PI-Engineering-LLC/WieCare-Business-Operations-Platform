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
const notificationService = require('../services/notifications.service');
const emailService = require('../services/email.service' );
const { getIO } = require('../config/socket');

// Training sessions
router.get('/', requireAuth,loadContext,resolveClientContext,
  asyncHandler( async (req, res) => {
  let q = db('training_sessions').orderBy('session_date');
  if (req.query.client_id) q = q.where({ client_id: req.query.client_id });
    q = clientScope(q, req);
  if (req.query.status) q = q.where({ status: req.query.status });
  if (req.query.coaster_name) q = q.where({ coaster_name: req.query.coaster_name });
  let result;
    if (req.query.id) {
      result = await q.where({ id: req.query.id }).first();
      if (!result) return res.status(404).json({ error: 'Training session not found' });
    } else {
      result = await q;
    }
    res.json(result);
}));


router.post('/', requireAuth,loadContext, adminOnly,
  auditMiddleware({action: 'training.created', resourceType:'training'}),
  asyncHandler( async (req, res) => {
    const trainingClientId= req.body.client_id;
    const client = await db('clients').where({ id: trainingClientId}).first();

  const [session] = await db('training_sessions').insert(
    {
      ...req.body,
      coaster_name: client?.coaster_name ||''

    }).returning('*');
    await notificationService.notifyClientUsers({
            clientId: session.client_id,
            email: client?.contact_email,
            title: `New Training Session: ${session.title || ''} `,
            message: `A new ${session.category} training session has been scheduled for "${session.coaster_name}".`,
            type: 'info',
            category: 'training',
            link: `/Training`,
            is_email_sent: !!client?.contact_email,
            resourceId: session.id,
            resourceType: "training_session"
          });
        if(client) {
            await emailService.queue({ type: 'training', to: client?.contact_email, payload: {
              training: session,
                client,
              } });
    
        }
  res.status(201).json(session);
}));

router.patch('/:id', requireAuth,loadContext, adminOnly,
  auditMiddleware({action: 'training.updated', resourceType:'training'}),
  asyncHandler( async (req, res) => {
  const [session] = await db('training_sessions').where({ id: req.params.id }).update(req.body).returning('*');
  const io = getIO();
          if (io) {
            io.to(`client:${session.client_id}`).emit('notification:new', { category:'training'});
          }
  res.json(session);
}));

// Registrations
router.post('/registrations', requireAuth,loadContext,resolveClientContext,
  auditMiddleware({action: 'training_registration.created', resourceType:'training_registration'}),
  asyncHandler( async (req, res) => {
  const session = await db('training_sessions').where({ id: req.body.training_id }).first();
  if (!session) return res.status(404).json({ error: 'Session not found' });
  if (session.max_participants && session.current_registrations > session.max_participants)
    return res.status(409).json({ error: 'Session is full' });

  const existing = await db('training_registrations')
    .where({ training_id: req.body.training_id, user_id: req.user.id }).whereNotIn('status', ['cancelled']).first();
  if (existing) return res.status(409).json({ error: 'Already registered' });

  const clientId= req.body.client_id;
      const client = await db('clients').where({ id: clientId}).first();
  
  const [reg] = await db('training_registrations').insert({
    ...req.body,
    client_name: client?.company_name ||  '',
    user_id: req.user.id,
    user_email: req.user.email,
    registration_date: new Date().toISOString().split('T')[0]
  }).returning('*');

  await db('training_sessions').where({ id: req.body.training_id })
    .increment('current_registrations', 1);
    const title= 'New Training Registration';
  const message= ` ${req.user.full_name || "User"} from ${client?.company_name || "a client"}  has registered for the training session: ${session.title || ''}`;
  // const io = getIO();
  // if (io) {
  //   io.to(`client:${reg.client_id}`).emit('notification:new', { category:'training'});
  //   io.to('admins').emit('notification:new', { category:'training'})
  // }     
  await notificationService.notifyAllAdmins({
          title,
          message,
          type: 'info',
          category: 'training',
          resourceId: reg.id,
          resourceType: "training_request",
          is_email_sent: true
          // isSendEmail: true
        })
        const adminEmail = process.env.ADMIN_EMAIL
                if (adminEmail) {
                  await emailService.queue({ to: adminEmail, type: "training_registration", payload: { title, message } });
              }
              // const io = getIO();
              // if (io) {
              //   io.to(`client:${reg.client_id}`).emit('notification:new', { category:'training'});
              //   // io.to('admins').emit('notification:new', { category:'training'})
              // } 

  res.status(201).json(reg);
}));

router.get('/registrations', requireAuth,loadContext,resolveClientContext,
  asyncHandler( async (req, res) => {
    let q =  db('training_registrations')
      .orderBy('created_at', 'desc');
    q = clientScope(q, req);
    if (req.query.user_id) { q = q.where({ user_id: req.query.user_id })}
    if (req.query.client_id) { q = q.where({ client_id: req.query.client_id })}
    let result;
    if (req.query.id) {
      result = await q.where({ id: req.query.id }).first();
      if (!result) return res.status(404).json({ error: 'Registration not found' });
    } else {
      result = await q;
    }
    res.json(result);
  }));
  

router.patch('/registrations/:id', requireAuth,loadContext,
  auditMiddleware({action: 'training_registration.updated', resourceType:'training_registration'}),
  asyncHandler(async (req, res) => {
  const [reg] = await db('training_registrations').where({ id: req.params.id }).update(req.body).returning('*');
  if(req.body?.status === 'cancelled'){
    await db('training_sessions').where({ id: reg.training_id })
    .decrement('current_registrations', 1);
  }
  const io = getIO();
          if (io) {
            io.to(`client:${reg.client_id}`).emit('notification:new', { category:'training'});
            io.to('admins').emit('notification:new', { category:'training'})
          }
  res.json(reg);
}));

// Training requests
router.get('/requests', requireAuth,loadContext,resolveClientContext,
  asyncHandler( async (req, res) => {
  let q = db('training_requests').orderBy('created_at', 'desc');
  q = clientScope(q, req);
  let result;
    if (req.query.id) {
      result = await q.where({ id: req.query.id }).first();
      if (!result) return res.status(404).json({ error: 'Training request not found' });
    } else {
      result = await q;
    }
    res.json(result);
}));

router.post('/requests', requireAuth,loadContext,resolveClientContext,
  auditMiddleware({action: 'training_request.created', resourceType:'training_request'}),
  asyncHandler( async (req, res) => {
    const clientId= req.body.client_id;
    let clientName=''
    if(clientId){
      const client = await db('clients').where({ id: clientId}).first();
      if (!client) {
        return res.status(404).json({ error: 'Client not found' });
      }
      clientName =client?.company_name ||  ''
    }else{
      return res.status(404).json({ error: 'Client required not found' });
    }
      
      
  const [tr] = await db('training_requests').insert({
    ...req.body,
    client_name: clientName,
    client_id: clientId || null,
    user_id: req.user.id,
    user_email: req.user.email,
    preferred_date_1: req.body.preferred_date_1 || null,
    preferred_date_2: req.body.preferred_date_2 || null
  }).returning('*');
  const title= 'New Training Request';
  const message= `A new ${tr.training_type} training request has been submitted by ${clientName || 'a client'}`;
        
  await notificationService.notifyAllAdmins({
          title,
          message,
          type: 'info',
          category: 'training',
          resourceId: tr.id,
          resourceType: "training_request",
          is_email_sent: true
          // isSendEmail: true
        })
        const adminEmail = process.env.ADMIN_EMAIL
                if (adminEmail) {
                  await emailService.queue({ to: adminEmail, type: "training_request", payload: { title, message } });
              }

  res.status(201).json(tr);
}));

router.patch('/requests/:id', requireAuth,loadContext, adminOnly,
  auditMiddleware({action: 'training_request.updated', resourceType:'training_request'}),
  asyncHandler( async (req, res) => {
  const [tr] = await db('training_requests').where({ id: req.params.id }).update(req.body).returning('*');
  const io = getIO();
          if (io) {
            io.to(`client:${tr.client_id}`).emit('notification:new', { category:'training'});
            io.to('admins').emit('notification:new', { category:'training'})
          }
  res.json(tr);
}));

router.delete('/:id', requireAuth,loadContext, adminOnly,
  auditMiddleware({action: 'training.deleted', resourceType:'training'}),
  asyncHandler( async (req, res) => {
    const session = await db('training_sessions').where({ id: req.params.id }).first();
  if (!session) return res.status(404).json({ error: 'Session not found' });
    await db('training_sessions').where({ id: req.params.id }).delete();
    const io = getIO();
    if (io) {
      io.to(`client:${session.client_id}`).emit('notification:new', { category:'training'});
      io.to('admins').emit('notification:new', { category:'training'})
    }
    res.json({ success: true });
  }));

module.exports = router;