const router = require('express').Router();
const db = require('../db');
const requireAuth = require('../middleware/auth');
const loadContext = require('../middleware/loadContext');
const clientContext = require('../middleware/clientContext');
const requireClientMembership = require('../middleware/requireClientMembership');
const resolveClientContext = require('../middleware/resolveClientContext');
const permit = require('../middleware/permissions');
const adminOnly = require('../middleware/adminOnly');
const clientScope = require('../middleware/clientScope');
const asyncHandler = require('../middleware/asyncHandler');
const auditMiddleware = require('../middleware/auditMiddleware');


router.get('/', requireAuth, loadContext, resolveClientContext, 
//   permit(
//   'warranty.view_all',
//   'warranty.view_tenant',
//   'warranty.view_own'
// ),
asyncHandler(async (req, res) => {
  let q = db('warranty_claims').orderBy('created_at', 'desc');
  q = clientScope(q, req);
  let result;
    if (req.query.id) {
      result = await q.where({ id: req.query.id }).first();
      if (!result) return res.status(404).json({ error: 'Claim not found' });
    } else {
      result = await q;
    }
    res.json(result);
}));

// router.get('/:id', requireAuth, async (req, res) => {
//   const claim = await db('warranty_claims').where({ id: req.params.id }).first();
//   if (!claim) return res.status(404).json({ error: 'Not found' });
//   if (req.user.role !== 'admin' && claim.client_id !== req.user.client_id)
//     return res.status(403).json({ error: 'Forbidden' });
//   res.json(claim);
// });

router.post('/', requireAuth, loadContext, resolveClientContext,
  auditMiddleware({action: 'warranty.created', resourceType:'warranty'}),
  asyncHandler( async (req, res) => {
  const client = await db('clients').where({ id: req.clientId }).first();

  // Check warranty eligibility
  if (client?.no_warranty)
    return res.status(403).json({ error: 'No warranty coverage on this account' });
  const [claim] = await db('warranty_claims').insert({
    ...req.body,
    images: JSON.stringify(req.body.images ?? []),
    client_id: client.id,
    client_name: req.body.client_name || client?.company_name,
    created_by: req.user.id,
    claim_number: `WC-${Date.now().toString().slice(-6)}`
  }).returning('*');
  res.status(201).json(claim);
}));

router.patch('/:id', requireAuth,loadContext, adminOnly,
  auditMiddleware({action: 'warranty.updated', resourceType:'warranty'}),
  asyncHandler( async (req, res) => {
  const [claim] = await db('warranty_claims').where({ id: req.params.id }).update({...req.body,
    images: JSON.stringify(req.body.images ?? []),}).returning('*');
  res.json(claim);
}));

module.exports = router;