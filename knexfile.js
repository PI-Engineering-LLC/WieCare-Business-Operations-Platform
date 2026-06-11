require('dotenv').config();
//const databaseUrl = `${process.env.DB_PROTOCOL}://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}/${process.env.DB_NAME}?sslmode=require`;
const databaseUrl =`${process.env.DATABASE_URL}`
module.exports = {
  development: {
    client: 'pg',
    connection: databaseUrl,
    migrations: { directory: './src/migrations' },
    seeds: { directory: './src/seeds' }
  },
  production: {
    client: 'pg',
    connection: { connectionString: databaseUrl, ssl: { rejectUnauthorized: false } },
    migrations: { directory: './src/migrations' },
    seeds: { directory: './src/seeds' }
  }
};
