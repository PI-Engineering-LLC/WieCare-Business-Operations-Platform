module.exports = (
  req,
  res,
  next
) => {
  if (
    (req.user.platform_role !==
    'super_admin' ) 
  ) {
    return res
      .status(403)
      .json({
        error:
          'Super admin only'
      });
  }

  next();
};