module.exports = (req, res, next) => {
  // This middleware assumes req.clientId has been set by a preceding middleware
  // like resolveClientContext or tenantIsolation.
  if (!req.clientId) {
    return res
      .status(400) // Bad Request if clientId is missing
      .json({ error: 'Client ID is required for this operation.' });
  }

  // req.user.memberships is populated by loadContext
  const membership = req.user.memberships.find(m => m.clientId === req.clientId);

  if (!membership) {
    return res
      .status(403)
      .json({
        error:
          'No client access: User is not a member of the specified client.'
      });
  }

  req.membership = membership; // Attach the specific membership object to req
  next();
};
