const knex = require('knex');
const config = require('../knexfile');

const env = process.env.NODE_ENV || 'development';
const db = knex(config[env]);
// db.on('query', q => {
//     console.log(q.sql);
// });

// db.on('query-error', (err, q) => {
//     console.error(err);
//     console.log(q.sql);
// });
module.exports = db;