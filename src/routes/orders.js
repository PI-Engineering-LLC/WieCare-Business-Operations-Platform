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

// Orders
router.get('/', requireAuth, loadContext, resolveClientContext,
  asyncHandler(async (req, res) => {
    let q = db('orders').orderBy('created_at', 'desc');
    if (req.query.client_id) q = q.where({ client_id: req.query.client_id });

    q = clientScope(q, req);
    let result;
    if (req.query.id) {
      result = await q.where({ id: req.query.id }).first();
      if (!result) return res.status(404).json({ error: 'Order not found' });
    } else {
      result = await q;
    }

    res.json(result);
  }));

router.post('/', requireAuth, loadContext, resolveClientContext,
  auditMiddleware({ action: 'order.created', resourceType: 'order' }),
  asyncHandler(async (req, res) => {
    const [order] = await db('orders').insert({
      ...req.body,
      items: JSON.stringify(req.body.items ?? []),
      created_by: req.user.id,
      order_number: `ORD-${Date.now().toString().slice(-6)}`
    }).returning('*');
    res.status(201).json(order);
  }));

router.patch('/:id', requireAuth, loadContext, adminOnly,
  auditMiddleware({ action: 'order.updated', resourceType: 'order' }),
  asyncHandler(async (req, res) => {
    const [order] = await db('orders').where({ id: req.params.id }).update({
      ...req.body,
      items: JSON.stringify(req.body.items ?? []),
    }).returning('*');
    res.json(order);
  }));

// Sub-orders
router.get('/:id/sub-orders', requireAuth, loadContext, resolveClientContext,
  asyncHandler(async (req, res) => {
    const subs = await db('sub_orders').where({ parent_order_id: req.params.id }).orderBy('created_at');
    res.json(subs);
  }));

router.post('/:id/sub-orders', requireAuth, loadContext, resolveClientContext, adminOnly,
  auditMiddleware({ action: 'sub_order.created', resourceType: 'sub_order' }),
  asyncHandler(async (req, res) => {
    const [sub] = await db('sub_orders').insert({
      ...req.body,
      items: JSON.stringify(req.body.items ?? []),
      parent_order_id: req.params.id,
      sub_order_number: `SUB-${Date.now().toString().slice(-6)}`
    }).returning('*');

    // Mark parent as split
    await db('orders').where({ id: req.params.id }).update({ is_split: true });
    res.status(201).json(sub);
  }));

router.patch('/sub-orders/:id', requireAuth, loadContext, resolveClientContext, adminOnly,
  auditMiddleware({ action: 'sub_order.updated', resourceType: 'sub_order' }),
  asyncHandler(async (req, res) => {
    const [sub] = await db('sub_orders').where({ id: req.params.id }).update({...req.body,
      items: JSON.stringify(req.body.items ?? []),}).returning('*');
    res.json(sub);
  }));
router.get('/sub-orders', requireAuth, loadContext, adminOnly,
  asyncHandler(async (req, res) => {
    let subs = db('sub_orders').orderBy('created_at', 'desc');
    if (req.query.parent_order_id) subs = subs.where({ parent_order_id: req.query.parent_order_id })
    res.json(await subs);
  }));

module.exports = router;