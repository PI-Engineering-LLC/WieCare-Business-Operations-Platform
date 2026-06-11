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
const holdCheck = require('../middleware/holdCheck');
/**client.on_hold
  if (part.holdUntil && now < part.holdUntil) {
    return res.status(403).json({ message: 'This part is on hold due to overdue invoice' });
  } */
// Parts catalog
router.get('/', requireAuth,loadContext,resolveClientContext,adminOnly,
  asyncHandler( async (req, res) => {

  let q = db('parts').orderBy('name');
  if (req.query.status) q = q.where({ status: req.query.status });
  if (req.query.category) q = q.where({ category: req.query.category });
  
    q = clientScope(q, req);
    let result;
  if (req.query.id) {
    result = await q.where({ id: req.query.id }).first();
    if (!result) return res.status(404).json({ error: 'Part not found' });
  } else {
    result = await q; 
  }

  res.json(result);
}));

// router.get('/:id', requireAuth, async (req, res) => {
//   const part = await db('parts').where({ id: req.params.id }).first();
//   if (!part) return res.status(404).json({ error: 'Not found' });
//   res.json(part);
// });

router.post('/', requireAuth,loadContext, adminOnly,
  auditMiddleware({action: 'part.created', resourceType:'part'}),
  asyncHandler( async (req, res) => {
  const [part] = await db('parts').insert(req.body).returning('*');
  res.status(201).json(part);
}));

router.patch('/:id', requireAuth,loadContext, adminOnly,
  auditMiddleware({action: 'part.updated', resourceType:'part'}),
  asyncHandler( async (req, res) => {
  const [part] = await db('parts').where({ id: req.params.id }).update(req.body).returning('*');
  res.json(part);
}));

router.delete('/:id', requireAuth,loadContext, adminOnly,
  auditMiddleware({action: 'part.deleted', resourceType:'part'}),
  asyncHandler( async (req, res) => {
  await db('parts').where({ id: req.params.id }).delete();
  res.json({ success: true });
}));

// Part orders
router.get('/orders', requireAuth,loadContext,resolveClientContext,
  asyncHandler( async (req, res) => {
    console.log("**PARTS")
    
  let q = db('part_orders').orderBy('created_at', 'desc');
  
    q = clientScope(q, req);
    let result;
  if (req.query.id) {
    result = await q.where({ id: req.query.id }).first();
    if (!result) return res.status(404).json({ error: 'Part Order not found' });
  } else {
    result = await q; 
  }

  res.json(result);
}));

// router.get('/orders/:id', requireAuth,loadContext,resolveClientContext, async (req, res) => {
    
//   const po = await db('part_orders').where({ id: req.params.id }).first();
//   if (!po) return res.status(404).json({ error: 'Not found' });
//   res.json(po);
// });

router.post('/orders', requireAuth,loadContext,resolveClientContext,holdCheck,
  auditMiddleware({action: 'part_order.created', resourceType:'part_order'}),
  asyncHandler( async (req, res) => {
  const client = await db('clients').where({ id: reqclientId }).first();
  // if (client?.on_hold)
  //   return res.status(403).json({ error: 'Account is on hold — please resolve outstanding invoices' });

  const [po] = await db('part_orders').insert({
    ...req.body,
    client_id: client.id,
    created_by: req.user.id,
    order_number: `PO-${Date.now().toString().slice(-6)}`
  }).returning('*');
  res.status(201).json(po);
}));

router.patch('/orders/:id', requireAuth,loadContext,resolveClientContext, adminOnly,
  auditMiddleware({action: 'part_order.updated', resourceType:'part_order'}),
  asyncHandler( async (req, res) => {
  const [po] = await db('part_orders').where({ id: req.params.id }).update(req.body).returning('*');
  res.json(po);
}));

module.exports = router;