module.exports = (
  req,
  res,
  next
) => {
  const clientId =
    req.header('X-Tenant-Id');

  if (!clientId) {
    return res
      .status(400)
      .json({
        error:
          'Missing client context'
      });
  }

  req.clientId = clientId;

  next();
};