import { createServer } from 'node:http';

function unauthorized(res) {
  res.statusCode = 401;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ error: 'unauthorized' }));
}

function blocked(res) {
  res.statusCode = 429;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ error: 'too_many_auth_failures' }));
}

function notFound(res) {
  res.statusCode = 404;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ error: 'not_found' }));
}

export async function createLocalApiServer({ config, http = { createServer }, now = Date.now }) {
  if (!config?.enabled) {
    return { started: false, reason: 'disabled' };
  }
  if (!config?.token) {
    return { started: false, reason: 'token_missing' };
  }

  let failedCount = 0;
  let blockedUntil = 0;

  const server = http.createServer((req, res) => {
    const current = now();
    if (blockedUntil > current) {
      blocked(res);
      return;
    }

    const authorization = req?.headers?.authorization ?? '';
    const expected = `Bearer ${config.token}`;
    if (authorization !== expected) {
      failedCount += 1;
      if (failedCount >= 5) {
        blockedUntil = current + 5 * 60 * 1000;
        failedCount = 0;
      }
      unauthorized(res);
      return;
    }

    failedCount = 0;
    notFound(res);
  });

  const started = await new Promise((resolve) => {
    server.listen(config.port, '127.0.0.1', (err) => {
      if (err) {
        resolve({ ok: false, error: err });
        return;
      }
      resolve({ ok: true });
    });
  });

  if (!started.ok) {
    if (started.error?.code === 'EADDRINUSE') {
      return { started: false, reason: 'port_in_use', port: config.port };
    }
    return { started: false, reason: 'listen_failed', error: started.error };
  }

  return {
    started: true,
    host: '127.0.0.1',
    port: config.port,
    close: () => new Promise((resolve) => server.close(() => resolve()))
  };
}
