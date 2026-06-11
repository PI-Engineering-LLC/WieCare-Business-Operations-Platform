// Blocks submissions for clients on_hold
const db = require('../db');

module.exports = async function holdCheck(req, res, next) {
  const clientId = req.clientId
  if (!clientId) return next();
  const client = await db('clients').where({ id: clientId }).first();
  if (client?.on_hold) {
    return res.status(403).json({
      error: 'Account on hold',
      message: 'Your account has been placed on hold due to overdue invoices. Please contact support.'
    });
  }
  next();
};