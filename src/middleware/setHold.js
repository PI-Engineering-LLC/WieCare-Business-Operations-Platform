// Blocks submissions for clients on_hold
const db = require('../db');

module.exports = async function setClientHold(req, res, next) {

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 60);
  const overdueInvoices = await db('invoices')
        .where(function() {
            this.where('issue_date', '<', cutoff)
                .orWhere('due_date', '<', new Date());
        })
        .whereNotIn('status', ['paid', 'cancelled', 'draft'])
        .where('balance_due', '>', 0)
        .select('client_id', 'id');
  const invIds = [...new Set(overdueInvoices.map(i => i.id))];
  const clientIds = [...new Set(overdueInvoices.map(i => i.client_id))];
  if (invIds?.length > 0) {
    await db('invoices').whereIn('id', invIds).update({ status: 'overdue' });
    await db('invoices').where('status', 'overdue').where('balance_due', '>', 0).whereNotIn('id', invIds).update({ status: 'sent' });
    await db('invoices').where('status', 'overdue').where('balance_due', '<=', 0).whereNotIn('id', invIds).update({ status: 'paid' });
}else{
   await db('invoices').where('status', 'overdue').where('balance_due', '>', 0).update({ status: 'sent' });
    await db('invoices').where('status', 'overdue').where('balance_due', '<=', 0).update({ status: 'paid' });
    await db('clients')
            .where({ on_hold: true })
            .update({ on_hold: false });

}
if (clientIds?.length > 0) {
  await db('clients').whereIn('id', clientIds).update({ on_hold: true });
  await db('clients')
            .whereNotIn('id', clientIds )
            .where({ on_hold: true })
            .update({ on_hold: false });
}

  next();
};