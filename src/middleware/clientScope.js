// Attach to queries to auto-filter client data
module.exports = (query, req, field = 'client_id') => {
  if (req.user.isInternalAdmin) return query;
  //  Safeguard: Prevent Knex from crashing if clientId is missing
  if (!req.clientId) {
    console.error(`ERROR: Tenant filter failed. req.clientId is missing for route: ${req.originalUrl}`);
    
    // Force the query to return zero results safely, or throw an error
    return query.whereRaw('1 = 0'); 
  }
  return query.where({ [field]: req.clientId });
};