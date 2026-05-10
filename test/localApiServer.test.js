import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalApiServer } from '../src/infrastructure/localApiServer.js';

function createFakeHttp() {
  const servers = [];
  return {
    servers,
    createServer(handler) {
      const state = { port: null, closed: false, handler };
      const server = {
        listen(port, host, cb) {
          state.port = port;
          state.host = host;
          if (state.listenError) {
            cb?.(state.listenError);
            return;
          }
          cb?.();
        },
        close(cb) {
          state.closed = true;
          cb?.();
        },
        on(event, fn) {
          if (event === 'error') {
            state.onError = fn;
          }
        }
      };
      state.server = server;
      servers.push(state);
      return server;
    }
  };
}

function createResponseRecorder() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    end(chunk = '') {
      this.body += chunk;
    }
  };
}

function createJsonRequest({ method, authorization, url, body }) {
  const handlers = {};
  return {
    method,
    url,
    headers: {
      authorization,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {})
    },
    on(event, handler) {
      handlers[event] = handler;
    },
    emitBody() {
      if (body !== undefined && handlers.data) {
        handlers.data(JSON.stringify(body));
      }
      if (handlers.end) {
        handlers.end();
      }
    }
  };
}

test('does not start when api is disabled or token missing', async () => {
  const http = createFakeHttp();

  const disabled = await createLocalApiServer({
    config: { enabled: false, port: 3000, token: 'abc' },
    http
  });
  assert.equal(disabled.started, false);
  assert.equal(disabled.reason, 'disabled');

  const missingToken = await createLocalApiServer({
    config: { enabled: true, port: 3000, token: '' },
    http
  });
  assert.equal(missingToken.started, false);
  assert.equal(missingToken.reason, 'token_missing');

  assert.equal(http.servers.length, 0);
});

test('starts server on 127.0.0.1 with fixed configured port', async () => {
  const http = createFakeHttp();
  const result = await createLocalApiServer({
    config: { enabled: true, port: 4567, token: 'secret' },
    http
  });

  assert.equal(result.started, true);
  assert.equal(http.servers.length, 1);
  assert.equal(http.servers[0].host, '127.0.0.1');
  assert.equal(http.servers[0].port, 4567);
});

test('returns explicit error on port conflict and does not auto-change port', async () => {
  const http = createFakeHttp();
  const custom = http.createServer(() => {});
  http.servers[0].listenError = Object.assign(new Error('busy'), { code: 'EADDRINUSE' });
  // make sure createLocalApiServer uses our first stubbed server
  http.createServer = () => custom;

  const result = await createLocalApiServer({
    config: { enabled: true, port: 4567, token: 'secret' },
    http
  });

  assert.equal(result.started, false);
  assert.equal(result.reason, 'port_in_use');
  assert.equal(result.port, 4567);
});

test('returns 401 for invalid auth and blocks with 429 after 5 failures for 5 minutes', async () => {
  const http = createFakeHttp();
  let now = 1_000;
  await createLocalApiServer({
    config: { enabled: true, port: 4567, token: 'secret' },
    http,
    now: () => now
  });

  const handler = http.servers[0].handler;

  for (let i = 0; i < 5; i += 1) {
    const res = createResponseRecorder();
    handler({ method: 'GET', headers: { authorization: 'Bearer bad' } }, res);
    assert.equal(res.statusCode, 401);
  }

  const blocked = createResponseRecorder();
  handler({ method: 'GET', headers: { authorization: 'Bearer secret' } }, blocked);
  assert.equal(blocked.statusCode, 429);

  now += 5 * 60 * 1000 + 1;
  const afterBlock = createResponseRecorder();
  handler({ method: 'GET', headers: { authorization: 'Bearer secret' } }, afterBlock);
  assert.equal(afterBlock.statusCode, 404);
});

test('GET /api/v1/projects/:id/progress returns 200 and 404', async () => {
  const http = createFakeHttp();
  await createLocalApiServer({
    config: { enabled: true, port: 4567, token: 'secret' },
    http,
    handlers: {
      getProgress: async (projectId) => {
        if (projectId === 'missing') {
          return null;
        }
        return { projectId, progressRate: 30 };
      }
    }
  });

  const handler = http.servers[0].handler;
  const okRes = createResponseRecorder();
  await handler({ method: 'GET', url: '/api/v1/projects/p-001/progress', headers: { authorization: 'Bearer secret' } }, okRes);
  assert.equal(okRes.statusCode, 200);
  assert.deepEqual(JSON.parse(okRes.body), { projectId: 'p-001', progressRate: 30 });

  const notFoundRes = createResponseRecorder();
  await handler({ method: 'GET', url: '/api/v1/projects/missing/progress', headers: { authorization: 'Bearer secret' } }, notFoundRes);
  assert.equal(notFoundRes.statusCode, 404);
  assert.equal(JSON.parse(notFoundRes.body).error, 'project_not_found');
});

test('PATCH /api/v1/projects/:id/effort returns 200 and 400', async () => {
  const http = createFakeHttp();
  await createLocalApiServer({
    config: { enabled: true, port: 4567, token: 'secret' },
    http,
    handlers: {
      updateEffort: async (projectId, payload) => {
        if (payload.actual < 0) {
          return { error: 'validation_error' };
        }
        return { projectId, effort: payload };
      }
    }
  });

  const handler = http.servers[0].handler;
  const okReq = createJsonRequest({ method: 'PATCH', authorization: 'Bearer secret', url: '/api/v1/projects/p-001/effort', body: { actual: 10 } });
  const okRes = createResponseRecorder();
  const okPromise = handler(okReq, okRes);
  okReq.emitBody();
  await okPromise;
  assert.equal(okRes.statusCode, 200);

  const badReq = createJsonRequest({ method: 'PATCH', authorization: 'Bearer secret', url: '/api/v1/projects/p-001/effort', body: { actual: -1 } });
  const badRes = createResponseRecorder();
  const badPromise = handler(badReq, badRes);
  badReq.emitBody();
  await badPromise;
  assert.equal(badRes.statusCode, 400);
  assert.equal(JSON.parse(badRes.body).error, 'validation_error');
});

test('POST /api/v1/projects/:id/holidays/sync returns 202 and 503', async () => {
  const http = createFakeHttp();
  await createLocalApiServer({
    config: { enabled: true, port: 4567, token: 'secret' },
    http,
    handlers: {
      syncHolidays: async (projectId, payload) => {
        if (payload.sources?.length === 0) {
          return { error: 'source_unavailable' };
        }
        return { accepted: true, projectId };
      }
    }
  });

  const handler = http.servers[0].handler;
  const okReq = createJsonRequest({ method: 'POST', authorization: 'Bearer secret', url: '/api/v1/projects/p-001/holidays/sync', body: { sources: [{ kind: 'company', type: 'file', path: '/tmp/a' }] } });
  const okRes = createResponseRecorder();
  const okPromise = handler(okReq, okRes);
  okReq.emitBody();
  await okPromise;
  assert.equal(okRes.statusCode, 202);

  const failReq = createJsonRequest({ method: 'POST', authorization: 'Bearer secret', url: '/api/v1/projects/p-001/holidays/sync', body: { sources: [] } });
  const failRes = createResponseRecorder();
  const failPromise = handler(failReq, failRes);
  failReq.emitBody();
  await failPromise;
  assert.equal(failRes.statusCode, 503);
  assert.equal(JSON.parse(failRes.body).error, 'source_unavailable');
});
