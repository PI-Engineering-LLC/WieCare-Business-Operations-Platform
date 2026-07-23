// Blocks submissions for clients on_hold
const db = require('../db');

module.exports = async function holdCheck(req, res, next) {
  // Super admin bypass - relies on isInternalAdmin flag from loadContext
  // if (req.user && req.user.isInternalAdmin) {
  //   return next();
  // }
  const clientId = req.clientId
  if (!clientId) return next();

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 60);
  const overdueInvoices = await db('invoices')
        .where(function() {
            this.where('issue_date', '<', cutoff)
                .orWhere('due_date', '<', new Date());
        })
        .where('client_id', clientId)
        .whereNotIn('status', ['paid', 'cancelled'])
        .where('balance_due', '>', 0)
  const invIds = [...new Set(overdueInvoices.map(i => i.id))];
  if (invIds.length) {
    await db('invoices').whereIn('id', invIds).update({ status: 'overdue' });
    await db('clients').whereIn('id', clientId).update({ on_hold: true });
}


  const client = await db('clients').where({ id: clientId }).first();
  if (client?.on_hold) {
    return res.status(403).json({
      error: 'Account on hold',
      message: 'Your account has been placed on hold due to overdue invoices. Please contact support.'
    });
  }

  next();
};