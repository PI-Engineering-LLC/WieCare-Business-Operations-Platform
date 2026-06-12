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
  ]
});

  logger.add(new winston.transports.Console({
    format: process.env.NODE_ENV === 'production'
    ? winston.format.simple() 
    : winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
  }));

// Configure Morgan Custom Format & Stream
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