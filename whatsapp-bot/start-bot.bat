@echo off
cd /d "C:\Users\haim\Downloads\OneDrive - Guy Hershkowitz Law\שולחן העבודה\TOFES OFFICE\whatsapp-bot"
pm2 resurrect
pm2 start index.js --name hachnasovitz --cron-restart="0 4 * * *"
