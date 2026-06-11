module.exports = (req, res, next) => {
  const clientId = req.body?.clientId || req.header('X-Tenant-Id');
  req.clientId = clientId; // Set req.clientId

  // Handle platform invite
  if (req.body.inviteType === 'platform') {
    // Check if the current user has permission to issue platform invites
    if (!req.user || !req.user.isInternalAdmin) { // Use flags from loadContext
      return res.status(403).json({ error: 'Forbidden: Only platform admins can issue platform invites.' });
    }
  } else {
    // Handle client invite
    if (!clientId) {
        return res.status(400).json({ error: 'Client ID is required for client invites.' });
    }
    // Find the membership for the specified clientId
    const membership = req.user.memberships.find(m => m.clientId === clientId);

    if (!(membership || req.user.isInternalAdmin)) {
      return res.status(403).json({ error: 'No client access: User is not a member of the specified client!.' });
    }

    // Check if the user has a role that allows inviting users for this client
    const hasInvitePermission = membership?.permissions?.includes('client:users.invite'); // Using resource:action format

    if (!(hasInvitePermission|| req.user.isInternalAdmin)) { // Check specific permission from the membership
      return res.status(403).json({ error: 'Access Denied: Insufficient permissions to invite users to this client.' });
    }

    req.membership = membership; // Attach the specific membership
  }

  next();
};
