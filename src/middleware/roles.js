module.exports = function requireRoles (allowedRoleNames) { 
  return (req, res, next) => {
    // Allow internal admins to bypass role checks for client-scoped roles
    if (req.user && req.user.isInternalAdmin) {
      req.clientId = req.clientId || (req.body?.clientId || req.header('X-Tenant-Id')); // Ensure clientId is set for downstream if admin
      return next();
    }

    const clientId = req.clientId || (req.body?.clientId || req.header('X-Tenant-Id')); // Ensure clientId is retrieved if not set
    if (!clientId) {
      return res.status(400).json({ error: 'Client ID is required for role-based access.' });
    }

    const membership = req.user.memberships.find(m => m.clientId === clientId);

    if (!membership) {
      return res.status(403).json({ error: 'No client access: User is not a member of the specified client.' });
    }

    // Check if any of the user's roles within this membership match the allowedRoleNames
    const hasAllowedRole = membership.roles.some(role => allowedRoleNames.includes(role.name));

    if (!hasAllowedRole) {
      return res.status(403).send("Forbidden: Insufficient role permissions.");
    }

    req.clientId = clientId; // Ensure clientId is consistently set
    req.membership = membership; // Attach the specific membership

    next();
  };
};
