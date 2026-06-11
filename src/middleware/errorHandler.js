// Global error handler
module.exports = function errorHandler(err, req, res, next) {
    console.error(`[${new Date().toISOString()}] ${req.method} ${req.path}`, err);
  
    if (err.name === 'UnauthorizedError') {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    if (err.code === '23505') { // Postgres unique violation
      return res.status(409).json({ error: 'Duplicate record', detail: err.detail });
    }
    if (err.code === '23503') { // Postgres FK violation
      return res.status(400).json({ error: 'Referenced record does not exist' });
    }
    if (err.name === 'ZodError') {
      return res.status(400).json({ error: 'Validation error' });
    }
  
    const status = err.status || err.statusCode || 500;
    res.status(status).json({
      error: err.message || 'Internal server error',
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    });
  };