require('dotenv').config()

module.exports = {
  port: parseInt(process.env.PORT || '4000', 10),
  host: process.env.HOST || '0.0.0.0',
  jwtSecret: process.env.JWT_SECRET || 'change-me',
  keySalt: process.env.KEY_SALT || 'change-me',
  adminUsername: process.env.ADMIN_USERNAME || 'admin',
  adminPassword: process.env.ADMIN_PASSWORD || 'admin123',
  corsOrigins: process.env.CORS_ORIGINS || '*',
  databasePath: process.env.DATABASE_PATH || './data/licenses.db',
}
