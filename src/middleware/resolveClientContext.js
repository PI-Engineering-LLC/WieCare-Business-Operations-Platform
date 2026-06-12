module.exports = (req, res, next) => {
  const clientId = req.header('X-Tenant-Id') || req.body?.clientId || req.body?.client_id;
  // PLATFORM ADMIN bypass
  if (req.user && req.user.isInternalAdmin) { // Use the flags from loadContext
    req.clientId = clientId; // Admins can set context explicitly
    return next();
  }

  // CLIENT USER
  if (!clientId) {
    return res
      .status(400) // Client ID is required for non-admin users
      .json({ error: 'Client ID is required for client-scoped operations.' });
  }

  // Find the membership for the specified clientId
  const membership = req.user.memberships.find(m => m.clientId === clientId); // assumes loadContext has been run

  if (!membership) {
    return res
      .status(403)
      .json({
        error:
          'No client access: User is not a member of the specified client.'
      });
  }

  req.clientId = clientId;
  req.membership = membership; // Attach the specific membership for this context

  next();
};
