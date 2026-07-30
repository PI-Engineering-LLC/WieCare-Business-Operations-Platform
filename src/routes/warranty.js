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
const notificationService = require('../services/notifications.service');
const emailService = require('../services/email.service' );
const { getIO } = require('../config/socket');

router.get('/', requireAuth, loadContext, resolveClientContext,
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
  auditMiddleware({ action: 'warranty.created', resourceType: 'warranty' }),
  asyncHandler(async (req, res) => {
    const client = await db('clients').where({ id: req.clientId }).first();

    // Check warranty eligibility
    if (client?.no_warranty)
      return res.status(403).json({ error: 'No warranty coverage on this account' });
    if (!client.warranty_start_date)
      return res.status(403).json({ error: 'No warranty set on this account' });
    const start = new Date(client.warranty_start_date);
    const expiry = new Date(start);
    const year = client.subscription_tier === 'basic' ? 1 : 1;
    expiry.setFullYear(start.getFullYear() + year);
    const isValid = expiry > new Date();
    if (!isValid) return res.status(403).json({ error: 'Warranty expired. Cannot submit claim' });
    const [claim] = await db('warranty_claims').insert({
      ...req.body,
      images: JSON.stringify(req.body.images ?? []),
      client_id: client.id,
      client_name: req.body.client_name || client?.company_name,
      created_by: req.user.id,
      claim_number: `WC-${Date.now().toString().slice(-6)}`
    }).returning('*');
    const title= `Warranty Claim: ${claim.claim_number}`;
      const message= `A new warranty claim has been submitted by ${client?.company_name || 'a client'}`;
       
      await notificationService.notifyAllAdmins({
                title,
                message,
                type: 'info',
                category: 'warranty',
                resourceId: claim.id,
                resourceType: "warranty",
                is_email_sent: true
                // isSendEmail: true
              })
              const adminEmail = process.env.ADMIN_EMAIL
                      if (adminEmail) {
                        await emailService.queue({ to: adminEmail, type: "warranty", payload: { title, message } });
                    }
    res.status(201).json(claim);
  }));

router.patch('/:id', requireAuth, loadContext, adminOnly,
  auditMiddleware({ action: 'warranty.updated', resourceType: 'warranty' }),
  asyncHandler(async (req, res) => {
    const [claim] = await db('warranty_claims').where({ id: req.params.id }).update({
      ...req.body,
      images: JSON.stringify(req.body.images ?? []),
    }).returning('*');
    const client = await db('clients').where({ id: claim.client_id}).first();
  await notificationService.notifyClientUsers({
              clientId: claim.client_id,
              email: client?.contact_email,
              title: `Warranty Claim Update: ${claim.claim_number || ''} `,
              message: `Your warranty claim status has been updated .`,
              type: 'info',
              category: 'warranty',
              link: `/WarrantyClaims`,
              is_email_sent: !!client?.contact_email,
              resourceId: claim.id,
              resourceType: "warranty"
            });
          if(client) {
              await emailService.queue({ type: 'warranty_update', to: client?.contact_email, payload: {
                claim: claim,
                  client,
                } });
      
          }
    res.json(claim);
  }));

module.exports = router;