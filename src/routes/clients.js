const router = require('express').Router();
const db = require('../db');
const requireAuth = require('../middleware/auth');
const loadContext = require('../middleware/loadContext');
const adminOnly = require('../middleware/adminOnly');
const asyncHandler = require('../middleware/asyncHandler');
const auditMiddleware = require('../middleware/auditMiddleware');
const requireRoles = require('../middleware/roles');
const resolveClientContext = require('../middleware/resolveClientContext');
const { getIO } = require('../config/socket');
// GET /api/clients
router.get('/', requireAuth, loadContext, adminOnly, // Assuming only internal admins can list all clients
  asyncHandler(async (req, res) => {
    let q = db('clients')
    .whereNull('deleted_at')
    .orderBy('company_name');

    if (req.query.id) {
      // If an ID is provided, fetch a single client
      const client = await q.where({ id: req.query.id }).first();
      if (!client) return res.status(404).json({ error: 'Client not found' });
      return res.json(client);
    }

    // Otherwise, fetch all clients
    const clients = await q;
    res.json(clients);
  }));

// GET /api/clients/:id - Get single client details (more granular access)
router.get('/:id', requireAuth, loadContext, resolveClientContext, // Example: client_admin can view their client
  asyncHandler(async (req, res) => {
    const client = await db('clients').where({ id: req.params.id }).first();
    if (!client) return res.status(404).json({ error: 'Client not found' });

    // For client_admin, ensure they can only see their own client
    if (req.user && !req.user.isInternalAdmin && req.membership && req.membership.clientId !== client.id) {
      return res.status(403).json({ error: 'Forbidden: You can only access your own client data.' });
    }

    res.json(client);
  }));

// POST /api/clients  (admin only)
router.post('/', requireAuth, loadContext, adminOnly,
  auditMiddleware({ action: 'client.created', resourceType: 'client' }),
  asyncHandler(async (req, res) => {
    const clientData = { ...req.body };
    // Iterate and clean date fields
    const dateFields = [
      'contract_date',
      'warranty_start_date',
      'last_mandatory_inspection_date',
      'next_mandatory_inspection_due',
      'last_mandatory_training_date',
      'next_mandatory_training_due'
    ];

    dateFields.forEach(field => {
      if (clientData[field] === '') {
        clientData[field] = null;
      }
    });
    const [client] = await db('clients').insert({ ...clientData, created_at: new Date(), updated_at: new Date() }).returning('*');
    const io = getIO();
        if (io) {
          io.emit('notification:new', { category:'client'})
            io.to('admins').emit('notification:new', { category:'client'})
        }
    res.status(201).json(client);
  }));

// PATCH /api/clients/:id  (admin only)
router.patch('/:id', requireAuth, loadContext, adminOnly,
  auditMiddleware({ action: 'client.updated', resourceType: 'client' }),
  asyncHandler(async (req, res) => {
    const clientData = { ...req.body };
    // Iterate and clean date fields
    const dateFields = [
      'contract_date',
      'warranty_start_date',
      'last_mandatory_inspection_date',
      'next_mandatory_inspection_due',
      'last_mandatory_training_date',
      'next_mandatory_training_due'
    ];

    dateFields.forEach(field => {
      if (clientData[field] === '') {
        clientData[field] = null;
      }
    });
    const [client] = await db('clients').where({ id: req.params.id }).update({ ...clientData, updated_at: new Date() }).returning('*');
    if (!client) return res.status(404).json({ error: 'Client not found' });
    const io = getIO();
        if (io) {
          io.emit('notification:new', { category:'client'})
            io.to('admins').emit('notification:new', { category:'client'})
        }
    res.json(client);
  }));

// DELETE /api/clients/:id (admin only)
router.delete('/:id', requireAuth, loadContext, adminOnly,
  auditMiddleware({ action: 'client.deleted', resourceType: 'client' }),
  asyncHandler(async (req, res) => {
    const clientId = req.params.id ;
    // const deletedCount = await db('clients').where({ id: req.params.id }).del();
    // if (deletedCount === 0) return res.status(404).json({ error: 'Client not found' });
    await db.transaction(async (trx) => {
      // 1. Find orphaned users BEFORE deleting the client
      //    (because memberships will be gone after)
      const orphanedUserIds = await trx('client_memberships as tm')
        .join('users as u', 'tm.user_id', 'u.id')
        .where('tm.client_id', clientId)
        .whereNull('u.platform_role')
        .whereNotExists(function() {
          this.select(1)
            .from('client_memberships as tm2')
            .whereRaw('tm2.user_id = tm.user_id')
            .where('tm2.client_id', '!=', clientId);
        })
        .pluck('tm.user_id');
    
      // Soft- Delete the client (CASCADE will wipe client_memberships)
      await trx('clients').where({ id: clientId }).del();
      // await trx('clients').where({ id: clientId }).update({ status: 'inactive' ,deleted_at:db.fn.now(), updated_at: new Date()});
    
      // 3. Now soft-delete the orphaned users
      if (orphanedUserIds.length > 0) {
        await trx('users').whereIn('id', orphanedUserIds).del();
        // await trx('users').whereIn('id', orphanedUserIds).update({ status: 'inactive' ,deleted_at:db.fn.now(), updated_at: new Date()});
      }
    });
    const io = getIO();
        if (io) {
          io.emit('notification:new', { category:'client'})
          io.emit('notification:new', { category:'user'})
            io.to('admins').emit('notification:new', { category:'client'})
        }
    res.json({ message: 'Client deleted successfully.' });
  }));


module.exports = router;

