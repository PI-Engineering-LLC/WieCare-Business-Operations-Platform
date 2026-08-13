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
// const validate = (schema) => (req, res, next) => {
//   const result = schema.safeParse(req.body);
  
//   if (!result.success) {
//     // This provides a detailed object format showing exactly which fields failed
//     console.error("Zod Validation Error:", result.error.format());
    
//     return res.status(422).json({
//       error: "Validation failed",
//       details: result.error.format()
//     });
//   }
  
//   // Replace req.body with the parsed/coerced data
//   req.body = result.data;
//   next();
// };

// module.exports = { validate };