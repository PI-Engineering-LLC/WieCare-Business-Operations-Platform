const db = require('../db');

module.exports = async function audit ({
  actorUserId,
  clientId,
  action,
  resourceType,
  resourceId,
  metadata,
  req
})  {
  await db('audit_logs')
    .insert({

      user_id:
        actorUserId,

      client_id:
        clientId,

      action,

      resource_type:
        resourceType,

      resource_id:
        resourceId,

      metadata:
        JSON.stringify(metadata),

      ip_address:
        req.ip,

      user_agent:
        req.headers['user-agent']
    });
};