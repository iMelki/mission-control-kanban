import http from 'node:http';

const host = '127.0.0.1';
const port = Number(process.env.MCK_GATE_NEGATIVE_PORT || 5392);

const server = http.createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end('<!doctype html><title>Gate fixture</title><p>Not Mission Control</p>');
});

server.listen(port, host, () => {
  process.stdout.write(`GATE_NEGATIVE_SERVER_READY pid=${process.pid} url=http://${host}:${port}\n`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
