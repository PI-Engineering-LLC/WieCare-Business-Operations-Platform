const router    = require('express').Router();
const passport  = require('passport');
const db        = require('../db');
const requireAuth = require('../middleware/auth');
const tenantIso = require('../middleware/tenantIsolation');
const loadContext = require('../middleware/loadContext');
const clientContext = require('../middleware/clientContext');
const resolveClientContext = require('../middleware/resolveClientContext');
const adminOnly = require('../middleware/adminOnly');
const clientScope = require('../middleware/clientScope');
const asyncHandler = require('../middleware/asyncHandler');
const auditMiddleware = require('../middleware/auditMiddleware');

const auth = passport.authenticate('jwt', { session: false });

// GET /api/dashboard  — stats for the current user/client
  router.get('/', requireAuth,loadContext,resolveClientContext, 
    asyncHandler(async (req, res, next) => {
  const { clientId } = req;
  const isAdmin = req.user.isInternalAdmin;

  // Admin dashboard
  if (isAdmin) {
    const [
      totalClients,
      openInvoices,
      pendingMaintenance,
      pendingQuotes,
      recentActivity
    ] = await Promise.all([
      db('clients').count('id as c').first(),
      db('invoices').whereIn('status', ['sent','overdue','partial']).count('id as c').first(),
      db('maintenance_requests').where('status', 'pending').count('id as c').first(),
      db('quotes').where('status', 'pending').count('id as c').first(),
      db('notifications').orderBy('created_at', 'desc').limit(10),
    ]);
    return res.json({
      total_clients:       Number(totalClients.c),
      open_invoices:       Number(openInvoices.c),
      pending_maintenance: Number(pendingMaintenance.c),
      pending_quotes:      Number(pendingQuotes.c),
      recent_activity:     recentActivity,
    });
  }

  // Client dashboard
  const [invoices, maintenance, orders, notifications] = await Promise.all([
    db('invoices').where('client_id', clientId).orderBy('created_at', 'desc').limit(5),
    db('maintenance_requests').where('client_id', clientId).orderBy('created_at', 'desc').limit(5),
    db('orders').where('client_id', clientId).orderBy('created_at', 'desc').limit(5),
    db('notifications').where('client_id', clientId).where('is_read', false).orderBy('created_at', 'desc').limit(10),
  ]);

  const overdue  = invoices.filter(i => i.status === 'overdue').length;
  const pending  = maintenance.filter(m => m.status === 'pending').length;

  res.json({ invoices, maintenance, orders, notifications, overdue, pending_maintenance: pending });
}));

module.exports = router;