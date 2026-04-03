// PM2 Ecosystem Configuration — Hachnasovitz Bot
// Usage: pm2 start ecosystem.config.js

module.exports = {
    apps: [{
        name: 'hachnasovitz',
        script: 'index.js',
        cwd: __dirname,

        // Auto-restart every day at 4:00 AM (fresh memory)
        cron_restart: '0 4 * * *',

        // Restart policy
        autorestart: true,
        max_restarts: 50,           // Max restarts in min_uptime window
        min_uptime: 10000,          // If crashes within 10s = real problem
        restart_delay: 5000,        // Wait 5s between restarts
        exp_backoff_restart_delay: 1000, // Exponential backoff on repeated crashes

        // Memory protection
        max_memory_restart: '500M', // Restart if RAM exceeds 500MB

        // Logs
        log_date_format: 'DD/MM HH:mm:ss',
        error_file: './logs/error.log',
        out_file: './logs/out.log',
        merge_logs: true,
        log_file: './logs/combined.log',

        // Environment
        env: {
            NODE_ENV: 'production'
        },

        // Don't watch files (we're not in dev mode)
        watch: false,

        // Kill timeout — give WhatsApp time to disconnect gracefully
        kill_timeout: 10000
    }]
};
