const winston = require('winston');
const morgan = require('morgan');


const logger = winston.createLogger({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json() 
  ),
  transports: [
    new winston.transports.Console(), 
    // new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    // new winston.transports.File({ filename: 'logs/combined.log' })
  ]
});


// Production Cloud Shipping
if (process.env.NODE_ENV === 'production') {
//   logger.add(new winston.transports.Loggly({
//     token: process.env.LOGGLY_TOKEN, // Your secure API token
//     subdomain: process.env.LOGGLY_SUBDOMAIN, // Your Loggly account name
//     tags: ['express-app', 'production'],
//     json: true
//   }));
// } else {
  // Local Development: Keep it simple and colorized in the terminal
  logger.add(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple()
    )
  }));
}


// 2. Configure Morgan Custom Format & Stream
const jsonFormat = (tokens, req, res) => {
    return JSON.stringify({
      method: tokens.method(req, res),
      url: tokens.url(req, res),
      status: Number(tokens.status(req, res)),
      responseTime: Number(tokens['response-time'](req, res))
    });
  };
  
  const httpLogger = morgan(jsonFormat, {
    stream: {
      write: (message) => {
        const logObject = JSON.parse(message);
        logger.info(`HTTP ${logObject.method} ${logObject.url}`, logObject);
      }
    }
  });
  

module.exports = {logger, httpLogger};