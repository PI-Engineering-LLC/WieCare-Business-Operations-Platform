const NodeCache = require('node-cache');

// Cache will store user-specific permission sets for a short period (e.g., 5 minutes).
// Adjust stdTTL (standard Time-To-Live) as appropriate for the application's
// consistency requirements. A shorter TTL means more frequent DB hits but fresher data.
const permissionCache = new NodeCache({
  stdTTL: 300, // Cache entries expire after 300 seconds (5 minutes)
  checkperiod: 60 // Check for expired keys every 60 seconds
});

module.exports = permissionCache;