module.exports = function tenantIsolation(req, res, next) {
  const clientId = req.header('X-Tenant-Id') || req.body.clientId || req.body.client_id;

  // Internal admin bypass: if they are an admin, they can specify a client or operate broadly
  if (req.user && req.user.isInternalAdmin) {
    req.clientId = clientId; // Admin can specify client for operations
    return next();
  }

  // For regular users, clientId must be provided and they must be a member
  if (!clientId) {
    return res.status(400).json({ error: 'Client ID is required for tenant-scoped operations.' });
  }

  const membership = req.user.memberships.find(m => m.clientId === clientId);
  if (!membership) {
    return res.status(403).json({ error: 'No client access: User is not a member of the specified client.' });
  }

  req.clientId = clientId;
  req.membership = membership; // Attach the membership for the current context

  next();
};
