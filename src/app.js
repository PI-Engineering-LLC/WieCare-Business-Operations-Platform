require('dotenv').config();
const express = require('express');
const helmet = require('helmet'); 
const cors = require('cors');
const passport = require('./config/passport');  
const errorHandler= require('./middleware/errorHandler');
const { apiLimiter, authLimiter } = require('./middleware/rateLimit');
const cookieParser = require('cookie-parser');
const { logger, httpLogger } = require('./config/logger'); 

const app = express();

// ─── Security ───
app.use(helmet());
app.use(cors({ origin: process.env.ALLOWED_ORIGINS?.split(',') || 'http://localhost:5173', 
  credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser())

// ─── Rate Limiting ───
// Apply specific authLimiter to /api/auth routes
// app.use('/api/auth', authLimiter);
// Apply general apiLimiter to all /api routes (this will apply to all /api routes *except* those already handled by /api/auth)
// app.use('/api', apiLimiter);

// ─── Auth ───
app.use(passport.initialize()); // no sessions — we use JWT

// ─── Logs ───
// Use the HTTP request logger middleware
app.use(httpLogger);
// ─── Public files ───
app.use("/static", express.static("public"));

// ─── API Routes ───
app.use('/api/auth',          require('./routes/auth'));
app.use('/api/invites',          require('./routes/invites'));
app.use('/api/users',         require('./routes/users'));
app.use('/api/roles',         require('./routes/roles'));
app.use('/api/permissions',   require('./routes/permissions'));
app.use('/api/clients',       require('./routes/clients'));
app.use('/api/departments',       require('./routes/departments'));
app.use('/api/memberships',   require('./routes/memberships'));
app.use('/api/quotes',        require('./routes/quotes'));
app.use('/api/orders',        require('./routes/orders'));
app.use('/api/invoices',      require('./routes/invoices'));
app.use('/api/parts',         require('./routes/parts'));
app.use('/api/maintenance',   require('./routes/maintenance'));
app.use('/api/training',      require('./routes/training'));
app.use('/api/courses',       require('./routes/courses'));
app.use('/api/documents',     require('./routes/documents'));
app.use('/api/warranty',      require('./routes/warranty'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/upload',        require('./routes/upload'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/payments', require('./routes/payments'));
app.get('/', (req, res) => {
  res.send('Server is running');
});
// ─── Health check ───
app.get('/api/health', (req, res) => res.json({ status: 'ok', ts: Date.now() }));

// ─── Logging ─── for manual application logs
app.get('/api/test', (req, res) => {
  logger.info('Test endpoint was triggered manually'); 
  res.json({ success: true });
});

app.use(errorHandler);
module.exports = app;