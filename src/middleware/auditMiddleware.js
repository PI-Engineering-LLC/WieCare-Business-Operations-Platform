const auditService = require('../services/audit')

module.exports = ({
  action,
  resourceType
}) => {

  return async (
    req,
    res,
    next
  ) => {

    const original =
      res.json;

    res.json =
      async body => {

        if (
          res.statusCode < 400
        ) {

          await auditService({
            actorUserId:
              req.user?.id,

            clientId:
              req.header(
                'X-Tenant-Id'
              ),

            action,

            resourceType,

            resourceId:
              body?.id,

            metadata: {
              body:
                req.body
            },

            req
          });
        }

        return original.call(
          res,
          body
        );
      };

    next();
  };
};
  