// Blocks submissions for clients on_hold
const db = require('../db');


const holdCheck = async function holdCheck(req, res, next) {

  const clientId = req.clientId
  if (!clientId) return next();
  await updateClientHold(clientId)


  const client = await db('clients').where({ id: clientId }).first();
  if (client?.on_hold) {
    return res.status(403).json({
      error: 'Account on hold',
      message: 'Your account has been placed on hold due to overdue invoices. Please contact support.'
    });
  }

  next();
};
const updateClientHold = async function updateClientHold(clientId){
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 60);
  const overdueInvoices = await db('invoices')
        .where(function() {
            this.where('issue_date', '<', cutoff)
                .orWhere('due_date', '<', new Date());
        })
        .where('client_id', clientId)
        .whereNotIn('status', ['paid', 'cancelled', 'draft'])
        .where('balance_due', '>', 0)
  const invIds = [...new Set(overdueInvoices.map(i => i.id))];
  const clientIds = [...new Set(overdueInvoices.map(i => i.client_id))];
  if (invIds?.length > 0) {
    await db('invoices').where('client_id', clientId).whereIn('id', invIds).update({ status: 'overdue' });
    await db('invoices').where('client_id', clientId).where('status', 'overdue').where('balance_due', '>', 0).whereNotIn('id', invIds).update({ status: 'sent' });
    await db('invoices').where('client_id', clientId).where('status', 'overdue').where('balance_due', '<=', 0).whereNotIn('id', invIds).update({ status: 'paid' });
    await db('clients').whereIn('id', clientIds).update({ on_hold: true });
}else{
  const client = await db('clients').where('id', clientId).where({ on_hold: true }).update({ on_hold: false }).returning('*');
}
}
module.exports ={holdCheck, updateClientHold}