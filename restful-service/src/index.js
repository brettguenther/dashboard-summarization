import http from 'node:http';
import dotenv from 'dotenv';
import { createApp, writeStructuredLog } from './app.js';

dotenv.config();

const PORT = Number(process.env.PORT || 5000);
// Cloud Run injects K_SERVICE and requires listening on 0.0.0.0; local dev/testing binds strictly to 127.0.0.1.
const HOST = process.env.HOST || (process.env.K_SERVICE ? '0.0.0.0' : '127.0.0.1');

const app = createApp();
const server = http.createServer(app);

server.listen(PORT, HOST, () => {
  writeStructuredLog('INFO', `Dashboard Summarization service listening on http://${HOST}:${PORT}`);
});
