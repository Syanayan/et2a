import { createServer } from 'node:http';

function sendJson(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
}

function unauthorized(res) {
  sendJson(res, 401, { error: 'unauthorized' });
}

function blocked(res) {
  sendJson(res, 429, { error: 'too_many_auth_failures' });
}

function notFound(res) {
  sendJson(res, 404, { error: 'not_found' });
}

function projectNotFound(res) {
  sendJson(res, 404, { error: 'project_not_found' });
}

function readJsonBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        resolve({});
      }
    });
  });
}

function matchProjectRoute(req) {
  const path = req?.url?.split('?')[0] ?? '';
  const matched = path.match(/^\/api\/v1\/projects\/([^/]+)\/(progress|effort|holidays\/sync)$/);
  if (!matched) {
    return null;
  }
  return { projectId: decodeURIComponent(matched[1]), action: matched[2] };
}

export async function createLocalApiServer({ config, http = { createServer }, now = Date.now, handlers = {} }) {
  if (!config?.enabled) {
    return { started: false, reason: 'disabled' };
  }
  if (!config?.token) {
    return { started: false, reason: 'token_missing' };
  }

  let failedCount = 0;
  let blockedUntil = 0;

  const server = http.createServer(async (req, res) => {
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

    const route = matchProjectRoute(req);
    if (!route) {
      notFound(res);
      return;
    }

    const { projectId, action } = route;

    if (req.method === 'GET' && action === 'progress') {
      const progress = await handlers.getProgress?.(projectId);
      if (!progress) {
        projectNotFound(res);
        return;
      }
      sendJson(res, 200, progress);
      return;
    }

    if (req.method === 'PATCH' && action === 'effort') {
      const payload = await readJsonBody(req);
      const updated = await handlers.updateEffort?.(projectId, payload);
      if (updated?.error === 'validation_error') {
        sendJson(res, 400, { error: 'validation_error' });
        return;
      }
      sendJson(res, 200, updated ?? {});
      return;
    }

    if (req.method === 'POST' && action === 'holidays/sync') {
      const payload = await readJsonBody(req);
      const result = await handlers.syncHolidays?.(projectId, payload);
      if (result?.error === 'source_unavailable') {
        sendJson(res, 503, { error: 'source_unavailable' });
        return;
      }
      sendJson(res, 202, result ?? { accepted: true });
      return;
    }

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
