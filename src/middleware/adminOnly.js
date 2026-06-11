
module.exports = (req, res, next) => {
  // Rely on flags set by loadContext for platform_role checks
  if (!req.user || !req.user.isInternalAdmin) {
    return res
      .status(403)
      .json({
        error:
          'Platform admin access required'
      });
  }
  next();
};