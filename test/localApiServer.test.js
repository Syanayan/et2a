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
