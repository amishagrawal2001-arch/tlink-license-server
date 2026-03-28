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
  // HTTPS
  httpsEnabled: process.env.HTTPS_ENABLED === 'true',
  httpsPort: parseInt(process.env.HTTPS_PORT || '4443', 10),
  sslCertPath: process.env.SSL_CERT_PATH || './certs/cert.pem',
  sslKeyPath: process.env.SSL_KEY_PATH || './certs/key.pem',
  sslCaPath: process.env.SSL_CA_PATH || '',
  // Auto-generate self-signed cert if none exists
  sslAutoGenerate: process.env.SSL_AUTO_GENERATE !== 'false',
}
