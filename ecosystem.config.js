module.exports = {
  apps: [{
    name: 'tlink-license',
    script: 'src/index.js',
    cwd: __dirname,
    env: {
      NODE_ENV: 'production',
    },
    restart_delay: 1000,
    max_restarts: 10,
    autorestart: true,
    watch: false,
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    error_file: './logs/error.log',
    out_file: './logs/out.log',
    merge_logs: true,
  }],
}
