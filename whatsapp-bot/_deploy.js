// Quick deploy script — uploads bot files to server and restarts PM2
var { Client } = require('ssh2');
var fs = require('fs');
var path = require('path');

var SERVER = '212.80.206.148';
var PASSWORD = process.argv[2] || 'psRHL2DlV26t9qPO';
var REMOTE_DIR = '/opt/hachnasovitz';

var FILES = ['index.js', 'agent.js', 'firebase.js', 'package.json', 'ecosystem.config.js', '.env', 'firebase-service-account.json'];

var conn = new Client();

conn.on('ready', function() {
    console.log('Connected to server');

    conn.sftp(function(err, sftp) {
        if (err) { console.error('SFTP error:', err.message); conn.end(); return; }

        var uploaded = 0;
        FILES.forEach(function(file) {
            var localPath = path.resolve(__dirname, file);
            var remotePath = REMOTE_DIR + '/' + file;

            if (!fs.existsSync(localPath)) {
                console.log('  SKIP ' + file + ' (not found)');
                uploaded++;
                if (uploaded === FILES.length) restartBot(conn);
                return;
            }

            sftp.fastPut(localPath, remotePath, function(err) {
                if (err) {
                    console.error('  FAIL ' + file + ': ' + err.message);
                } else {
                    console.log('  OK   ' + file);
                }
                uploaded++;
                if (uploaded === FILES.length) restartBot(conn);
            });
        });
    });
});

conn.on('error', function(err) {
    console.error('Connection error:', err.message);
});

function restartBot(conn) {
    console.log('\nRestarting PM2...');
    conn.exec('cd ' + REMOTE_DIR + ' && pm2 restart hachnasovitz 2>&1', function(err, stream) {
        if (err) { console.error('Exec error:', err.message); conn.end(); return; }
        stream.on('data', function(data) { process.stdout.write(data); });
        stream.stderr.on('data', function(data) { process.stderr.write(data); });
        stream.on('close', function() {
            console.log('\nDone! Bot restarted.');
            conn.end();
        });
    });
}

conn.connect({
    host: SERVER,
    port: 22,
    username: 'root',
    password: PASSWORD
});
