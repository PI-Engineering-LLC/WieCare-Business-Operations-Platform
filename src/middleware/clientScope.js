module.exports = (query, req, field = 'client_id') => {
  // 1. Internal Admins skip scoping entirely
  if (req.user.isInternalAdmin) 
    return query
    .whereExists(function() {
      this.select('*')
        .from('clients')
        .where('clients.status', 'active')
        .whereNull('clients.deleted_at');
    });
    // return query;

  // 2. Safeguard: Client ID missing
  if (!req.clientId) {
    console.error(`ERROR: Client filter failed. req.clientId is missing for route: ${req.originalUrl}`);
    return query.whereRaw('1 = 0'); 
  }

  // 3. Filter by client_id AND verify client status
  return query
    .where({ [field]: req.clientId })
    .whereExists(function() {
      this.select('*')
        .from('clients')
        .where('clients.id', '=', `${req.clientId}`)
        .where('clients.status', 'active')
        .whereNull('clients.deleted_at');
    });
};