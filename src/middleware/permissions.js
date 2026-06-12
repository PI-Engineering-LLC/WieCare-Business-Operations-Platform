module.exports =
  (...requiredPermissions) => 
  (
    req,
    res,
    next
  ) => {
    // Super admin bypass - relies on isInternalAdmin flag from loadContext
    if (req.user && req.user.isInternalAdmin) {
      return next();
    }

    // Check if req.membership exists and has permissions
    if (!req.membership || !req.membership.permissions) {
      return res
        .status(403)
        .json({
          error:
            'Forbidden: No client context or permissions found'
        });
    }

    const availablePermissions = req.membership.permissions;

    const allowed =
      requiredPermissions.some(
        p =>
          availablePermissions.includes(p)
      );

    if (!allowed) {
      return res
        .status(403)
        .json({
          error:
            'Forbidden: Insufficient permissions'
        });
    }

    next();
  };