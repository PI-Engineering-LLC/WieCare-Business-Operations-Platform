const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const db = require('../db');
const cookie = require('cookie');

let io;

function initSocket(server) {
  io = new Server(server, {
    cors: {
      origin: process.env.ALLOWED_ORIGINS?.split(',') ,
      methods: ['GET', 'POST'],
      credentials: true,
    },
    transports: ['websocket', 'polling'],
  });

  // Auth middleware — runs before every connection
  io.use(async(socket, next) => {
    console.log('--- Socket.IO Auth Middleware ---');
    const headerValue = socket.request.headers.cookie;
    
    if (!headerValue) {
      return next(new Error('Authentication error: No cookies found'));
      
    }
    const rawCookies = socket.request.headers.cookie;
    console.log("===> COOKIES RECEIVED BY SOCKET:");
  
    if (!rawCookies) {
    return next(new Error('Authentication error: No cookies found'));
  }
   const cookies = cookie.parse(rawCookies);
   console.log("===> PARSED COOKIES:");
   
   const token = cookies.token || cookies.access_token || cookies.session || cookies.refresh_token;

    
    if (!token) {
      console.log('Reason for Unauthorized: No token provided.');
      return next(new Error('Unauthorized'));
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      const user = await db('users').where({id: decoded.userId, deleted_at: null}).first();
      
      if (!user) {
        return next(new Error('Unauthorized'));
      }
      socket.user = user;

      const memberships = await db('client_memberships')
        .where({ user_id: user.id, is_active: true })
        .select('client_id');
      socket.clientIds = memberships.map(m => m.client_id);
      next();
    } catch (err) {
      console.error('JWT Verification Error:', err.name, err.message);
      if (err.name === 'TokenExpiredError') {
          console.error('Token expired at:', err.expiredAt);
      } else if (err.name === 'JsonWebTokenError') {
          console.error('Invalid token details:', err.message);
      }
      console.error('Full JWT Error object:', err);
      next(new Error('Unauthorized'));
    }
  });

  io.on('connection', async (socket) => {
    console.log('Client connected:', socket.id, '| User:', socket.user.id);

    // Each user joins their own private room
    socket.join(`user:${socket.user.id}`);
    // Join client rooms for each client the user is a member of
    socket.clientIds.forEach(clientId => socket.join(`client:${clientId}`));

    // Admins also join the admin broadcast room
    if (['super_admin','internal_admin','internal_user'].includes(socket.user.platform_role)) {
      socket.join('admins');
    }

    socket.on('disconnect', () => {
      console.log('Client disconnected:', socket.id);
    });
  });

  return io;
}

function getIO() {
  if (!io) throw new Error('Socket.io not initialized');
  return io;
}

module.exports = { initSocket, getIO };