// Zod schema validation helper
const { z } = require('zod');

module.exports = function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(422).json({
        error: 'Validation failed',
        details: result.error.flatten().fieldErrors
      });
    }
    req.body = result.data; // use coerced/validated data
    next();
  };
};