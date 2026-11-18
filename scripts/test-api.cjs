const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

function loadClient(fetch) {
  const source = fs.readFileSync(require.resolve('../src/api/client.ts'), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, {
    exports,
    require: (name) => {
      if (name === 'react-native') return { Platform: { OS: 'web' } };
      if (name === '@/api/mock') return { MOCK_ENABLED: false };
      throw new Error(`Unexpected dependency: ${name}`);
    },
    process: { env: { EXPO_PUBLIC_API_URL: 'http://localhost:8000' } },
    fetch,
    AbortController,
    Error,
    setTimeout,
    clearTimeout,
  });
  return exports;
}

function response(status, data) {
  return { ok: status < 400, status, text: async () => JSON.stringify(data) };
}

test('nested DRF field errors become readable messages', async () => {
  const client = loadClient(async () => response(400, {
    error: { status: 400, detail: { vehicle: ['Choose an approved vehicle'] } },
  }));
  await assert.rejects(client.request('/api/v1/rides/'), /Choose an approved vehicle/);
});

test('nested DRF non-field errors become readable messages', async () => {
  const client = loadClient(async () => response(400, {
    error: { status: 400, detail: ['Only drivers can publish rides'] },
  }));
  await assert.rejects(client.request('/api/v1/rides/'), /Only drivers can publish rides/);
});

test('concurrent expired requests share one refresh and use the rotated access token', async () => {
  let fetches = 0;
  let refreshes = 0;
  const client = loadClient(async (_url, options) => {
    fetches += 1;
    return options.headers.Authorization === 'Bearer rotated-access'
      ? response(200, { results: [] })
      : response(401, { detail: 'Token expired' });
  });
  client.setAuthToken('expired-access');
  client.setRefreshHandler(async () => {
    refreshes += 1;
    await new Promise(setImmediate);
    client.setAuthToken('rotated-access');
    return true;
  });
  const results = await Promise.all([
    client.request('/api/v1/rides/', { auth: true }),
    client.request('/api/v1/bookings/', { auth: true }),
  ]);
  assert.equal(results.length, 2);
  assert.equal(fetches, 4);
  assert.equal(refreshes, 1);
});

test('failed refresh clears the expired session and stops retries', async () => {
  let fetches = 0;
  let expirations = 0;
  const client = loadClient(async () => {
    fetches += 1;
    return response(401, { detail: 'Token expired' });
  });
  client.setRefreshHandler(async () => false);
  client.setAuthExpiredHandler(() => { expirations += 1; });
  await assert.rejects(client.request('/api/v1/users/me/', { auth: true }), /Session expired/);
  assert.equal(fetches, 1);
  assert.equal(expirations, 1);
});

test('session keeps successive rotated refresh tokens and injects new access tokens', async () => {
  const client = loadClient(async (_url, options) => (
    options.headers.Authorization?.startsWith('Bearer access-')
      ? response(200, { results: [] })
      : response(401, { detail: 'Token expired' })
  ));
  const usedRefreshes = [];
  let state;
  const sessionSource = fs.readFileSync(require.resolve('../src/store/session.ts'), 'utf8');
  const compiled = ts.transpileModule(sessionSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  const modules = {
    zustand: {
      create: () => (initialize) => {
        const set = (patch) => { Object.assign(state, patch); };
        state = initialize(set, () => state);
        const store = (select) => select(state);
        store.getState = () => state;
        store.setState = set;
        return store;
      },
    },
    'zustand/middleware': { persist: (initialize) => initialize, createJSONStorage: () => ({}) },
    '@/api/client': client,
    '@/api/mock': { MOCK_ENABLED: false },
    '@/lib/notifications': { cleanupNotificationSession: async () => undefined },
    '@/lib/secure-storage': { persistentStorage: {} },
    '@/services/users': { me: async () => ({ id: 'synthetic-user' }) },
    '@/services/auth': {
      refreshToken: async (refresh) => {
        usedRefreshes.push(refresh);
        return { access: `access-${usedRefreshes.length}`, refresh: `refresh-${usedRefreshes.length}` };
      },
    },
  };
  vm.runInNewContext(compiled, {
    exports,
    require: (name) => {
      if (modules[name]) return modules[name];
      throw new Error(`Unexpected dependency: ${name}`);
    },
  });
  state.refresh = 'initial-refresh';
  client.setAuthToken('expired');
  await client.request('/api/v1/users/me/', { auth: true });
  assert.equal(state.access, 'access-1');
  assert.equal(state.refresh, 'refresh-1');
  client.setAuthToken('expired-again');
  await client.request('/api/v1/users/me/', { auth: true });
  assert.deepEqual(usedRefreshes, ['initial-refresh', 'refresh-1']);
  assert.equal(state.access, 'access-2');
  assert.equal(state.refresh, 'refresh-2');
});

test('matching services unwrap paginated scored results, including empty feeds', async () => {
  const source = fs.readFileSync(require.resolve('../src/services/interests.ts'), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const rows = [{ id: 'synthetic-result', score: 91 }];
  let results = rows;
  const calls = [];
  const exports = {};
  vm.runInNewContext(compiled, {
    exports,
    require: (name) => {
      if (name === '@/api/client') return { request: async (path, options) => {
        calls.push({ path, options });
        return { count: results.length, next: null, previous: null, results };
      } };
      if (name === '@/lib/geo') return {};
      throw new Error(`Unexpected dependency: ${name}`);
    },
  });
  assert.equal(await exports.matchingRidesForInterest('interest-id'), rows);
  assert.equal(await exports.matchingInterestsForRide('ride-id'), rows);
  results = [];
  assert.equal((await exports.matchingRidesForInterest('interest-id')).length, 0);
  assert.equal(calls[0].path, '/api/v1/matching/interests/interest-id/rides/');
  assert.equal(calls[1].path, '/api/v1/matching/rides/ride-id/interests/');
  assert.equal(calls.every(({ options }) => options.auth === true), true);
});

function loadModule(path, modules = {}, globals = {}) {
  const source = fs.readFileSync(require.resolve(path), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, {
    exports,
    Error,
    require: (name) => {
      if (Object.hasOwn(modules, name)) return modules[name];
      throw new Error(`Unexpected dependency: ${name}`);
    },
    ...globals,
  });
  return exports;
}

function plain(value) {
  // VM objects have different prototypes; compare their data in the host realm.
  return JSON.parse(JSON.stringify(value));
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function loadSession({ auth = {}, me = async () => ({ id: 'synthetic-user', role: 'PASSENGER' }), fetch } = {}) {
  const calls = { auth: [], me: 0, tokens: [] };
  const client = loadClient(fetch ?? (async () => response(200, {})));
  const setAuthToken = client.setAuthToken;
  client.setAuthToken = (token) => {
    calls.tokens.push(token);
    setAuthToken(token);
  };
  const services = {};
  for (const name of ['requestOtp', 'requestEmailOtp', 'verifyOtp', 'verifyEmailOtp', 'refreshToken', 'logout']) {
    services[name] = async (...args) => {
      calls.auth.push({ name, args });
      if (auth[name]) return auth[name](...args);
      return name.startsWith('verify') || name === 'refreshToken'
        ? { access: 'verified-access', refresh: 'verified-refresh' }
        : { detail: 'OK' };
    };
  }
  let state;
  const { useSession: store } = loadModule('../src/store/session.ts', {
    zustand: {
      create: () => (initialize) => {
        const set = (patch) => {
          state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
        };
        state = initialize(set, () => state);
        const store = (select) => select(state);
        store.getState = () => state;
        store.setState = set;
        return store;
      },
    },
    'zustand/middleware': { persist: (initialize) => initialize, createJSONStorage: () => ({}) },
    '@/api/client': client,
    '@/api/mock': { MOCK_ENABLED: false },
    '@/lib/notifications': { cleanupNotificationSession: async () => undefined },
    '@/lib/secure-storage': { persistentStorage: {} },
    '@/services/auth': services,
    '@/services/users': { me: async () => { calls.me += 1; return me(); } },
  });
  return { store, client, calls };
}

const phoneCases = [
  ['22123456', '+21622123456'],
  ['022123456', '+21622123456'],
  ['21622123456', '+21622123456'],
  ['+21622123456', '+21622123456'],
  [' 22 123 456 ', '+21622123456'],
  ['+216 (22) 123-456', '+21622123456'],
  ['(022) 123-456', '+21622123456'],
  ['216\t22\n123456', '+21622123456'],
];
for (const [raw, expected] of phoneCases) {
  test(`normalizeContact normalizes Tunisian phone ${JSON.stringify(raw)}`, () => {
    const { normalizeContact } = loadModule('../src/lib/contact.ts');
    assert.equal(normalizeContact(raw, 'PHONE'), expected);
  });
}

for (const [raw, expected] of [
  ['  USER@Example.COM  ', 'user@example.com'],
  ['First.Last+LOGIN@Sub.Example.TN', 'first.last+login@sub.example.tn'],
]) {
  test(`normalizeContact trims and lowercases email ${JSON.stringify(raw)}`, () => {
    const { normalizeContact } = loadModule('../src/lib/contact.ts');
    assert.equal(normalizeContact(raw, 'EMAIL'), expected);
  });
}

for (const [channel, values] of [
  ['PHONE', ['', '   ', '2212345', '221234567', '+2162212345', '+216221234567',
    '+3322123456', '0021622123456', '22.123.456', '22abc456', 'user@example.tn']],
  ['EMAIL', ['', '   ', 'user', 'user@example', '@example.tn', 'user@.tn',
    'user@@example.tn', 'user name@example.tn', 'user@exam ple.tn', '22123456']],
]) {
  test(`normalizeContact rejects invalid ${channel} contacts`, () => {
    const { normalizeContact } = loadModule('../src/lib/contact.ts');
    for (const raw of values) assert.equal(normalizeContact(raw, channel), null, raw);
  });
}

for (const { name, args, path, auth, body } of [
  { name: 'requestOtp', args: ['+21622123456'], path: 'otp/request', auth: false, body: { phone_number: '+21622123456' } },
  { name: 'verifyOtp', args: ['+21622123456', '123456'], path: 'otp/verify', auth: false, body: { phone_number: '+21622123456', code: '123456' } },
  { name: 'requestEmailOtp', args: ['user@example.tn'], path: 'email/request', auth: false, body: { email: 'user@example.tn' } },
  { name: 'verifyEmailOtp', args: ['user@example.tn', '654321'], path: 'email/verify', auth: false, body: { email: 'user@example.tn', code: '654321' } },
  { name: 'requestContactCode', args: ['EMAIL', 'user@example.tn'], path: 'contact/request', auth: true, body: { channel: 'EMAIL', contact: 'user@example.tn' } },
  { name: 'verifyContactCode', args: ['EMAIL', 'user@example.tn', '123456'], path: 'contact/verify', auth: true, body: { channel: 'EMAIL', contact: 'user@example.tn', code: '123456' } },
  { name: 'requestContactCode', args: ['PHONE', '+21622123456'], path: 'contact/request', auth: true, body: { channel: 'PHONE', contact: '+21622123456' } },
  { name: 'verifyContactCode', args: ['PHONE', '+21622123456', '123456'], path: 'contact/verify', auth: true, body: { channel: 'PHONE', contact: '+21622123456', code: '123456' } },
  { name: 'refreshToken', args: ['synthetic-refresh'], path: 'token/refresh', auth: false, body: { refresh: 'synthetic-refresh' } },
  { name: 'logout', args: ['synthetic-refresh'], path: 'logout', auth: true, body: { refresh: 'synthetic-refresh' } },
]) {
  test(`auth ${name} ${args[0]} uses the correct route, payload and auth flag`, async () => {
    const calls = [];
    const result = { detail: 'OK', access: 'access', refresh: 'refresh', id: 'user' };
    const service = loadModule('../src/services/auth.ts', {
      '@/api/client': { request: async (route, options) => { calls.push({ route, options }); return result; } },
    });
    assert.equal(await service[name](...args), result);
    assert.deepEqual(plain(calls), [{ route: `/api/v1/auth/${path}/`, options: { method: 'POST', auth, body } }]);
  });
}

for (const [channel, contact, requestName, verifyName] of [
  ['EMAIL', 'user@example.tn', 'requestEmailOtp', 'verifyEmailOtp'],
  ['PHONE', '+21622123456', 'requestOtp', 'verifyOtp'],
]) {
  test(`session dispatches ${channel} login and verification, trimming the OTP`, async () => {
    const { store, calls } = loadSession();
    assert.equal(await store.getState().requestLoginCode(contact, channel), true);
    assert.deepEqual(plain(store.getState().pendingContact), { channel, contact });
    assert.equal(store.getState().authPending, false);
    assert.equal(await store.getState().verifyLoginCode(' 123456\n'), true);
    assert.deepEqual(calls.auth, [
      { name: requestName, args: [contact] },
      { name: verifyName, args: [contact, '123456'] },
    ]);
    assert.equal(calls.me, 1);
    assert.equal(store.getState().user.id, 'synthetic-user');
    assert.equal(store.getState().access, 'verified-access');
    assert.equal(store.getState().refresh, 'verified-refresh');
    assert.equal(store.getState().pendingContact, undefined);
    assert.equal(store.getState().authPending, false);
    assert.equal(store.getState().authError, undefined);
  });

  test(`session preserves pending ${channel} contact and allows retry after an invalid OTP`, async () => {
    let attempts = 0;
    const { store, calls } = loadSession({ auth: {
      [verifyName]: async () => {
        if (++attempts === 1) throw new Error('Invalid or expired code');
        return { access: 'verified-access', refresh: 'verified-refresh' };
      },
    } });
    await store.getState().requestLoginCode(contact, channel);
    assert.equal(await store.getState().verifyLoginCode('000000'), false);
    assert.deepEqual(plain(store.getState().pendingContact), { channel, contact });
    assert.equal(store.getState().authPending, false);
    assert.equal(store.getState().authError, 'Invalid or expired code');
    assert.equal(store.getState().access, undefined);
    assert.equal(store.getState().refresh, undefined);
    assert.equal(store.getState().user, undefined);
    assert.equal(calls.me, 0);
    assert.deepEqual(calls.tokens, [undefined]);
    assert.equal(await store.getState().verifyLoginCode('123456'), true);
    assert.equal(attempts, 2);
    assert.equal(store.getState().pendingContact, undefined);
    assert.equal(store.getState().authError, undefined);
  });

  test(`successful ${channel} code request clears old unauthenticated tokens`, async () => {
    const fetches = [];
    const { store, client, calls } = loadSession({ fetch: async (_url, options) => {
      fetches.push(options);
      return response(200, {});
    } });
    store.setState({ access: 'stale-access', refresh: 'stale-refresh', user: undefined,
      pendingContact: { channel: 'PHONE', contact: '+21699123456' }, authError: 'Old error' });
    client.setAuthToken('stale-access');
    assert.equal(await store.getState().requestLoginCode(contact, channel), true);
    assert.equal(store.getState().access, undefined);
    assert.equal(store.getState().refresh, undefined);
    assert.equal(store.getState().user, undefined);
    assert.equal(store.getState().authError, undefined);
    assert.deepEqual(plain(store.getState().pendingContact), { channel, contact });
    assert.deepEqual(calls.tokens, ['stale-access', undefined]);
    await client.request('/api/v1/users/me/', { auth: true });
    assert.equal(Object.hasOwn(fetches[0].headers, 'Authorization'), false);
  });

  test(`${channel} OTP success followed by a transient me failure retains tokens and never consumes OTP twice`, async () => {
    const fetches = [];
    const { store, client, calls } = loadSession({
      me: async () => {
        if (calls.me === 1) throw new Error('Network request failed');
        return { id: 'recovered-user', role: 'PASSENGER' };
      },
      fetch: async (_url, options) => { fetches.push(options); return response(200, {}); },
    });
    await store.getState().requestLoginCode(contact, channel);
    assert.equal(await store.getState().verifyLoginCode('123456'), false);
    assert.equal(store.getState().authPending, false);
    assert.equal(store.getState().authError, 'Can’t reach the server. Make sure the backend is running.');
    assert.deepEqual(plain(store.getState().pendingContact), { channel, contact });
    assert.equal(store.getState().access, 'verified-access');
    assert.equal(store.getState().refresh, 'verified-refresh');
    assert.equal(store.getState().user, undefined);
    await client.request('/api/v1/users/me/', { auth: true });
    assert.equal(fetches[0].headers.Authorization, 'Bearer verified-access');
    assert.equal(await store.getState().verifyLoginCode('123456'), true);
    assert.deepEqual(calls.auth, [
      { name: requestName, args: [contact] },
      { name: verifyName, args: [contact, '123456'] },
    ]);
    assert.deepEqual(calls.tokens, [undefined, 'verified-access']);
    assert.equal(calls.me, 2);
    assert.equal(store.getState().user.id, 'recovered-user');
    assert.equal(store.getState().pendingContact, undefined);
    assert.equal(store.getState().authError, undefined);
    assert.equal(store.getState().authPending, false);
    assert.equal(store.getState().access, 'verified-access');
    assert.equal(store.getState().refresh, 'verified-refresh');
  });

  test(`session with existing access skips ${channel} OTP and retries me directly`, async () => {
    const { store, client, calls } = loadSession();
    store.setState({ access: 'existing-access', refresh: 'existing-refresh',
      pendingContact: { channel, contact }, authError: 'Previous me failure' });
    client.setAuthToken('existing-access');
    assert.equal(await store.getState().verifyLoginCode('already-consumed'), true);
    assert.deepEqual(calls.auth, []);
    assert.equal(calls.me, 1);
    assert.deepEqual(calls.tokens, ['existing-access']);
    assert.equal(store.getState().access, 'existing-access');
    assert.equal(store.getState().refresh, 'existing-refresh');
    assert.equal(store.getState().pendingContact, undefined);
    assert.equal(store.getState().authError, undefined);
  });
}

test('authPending guards code requests and verification while requesting a code', async () => {
  const gate = deferred();
  const { store, calls } = loadSession({ auth: { requestEmailOtp: () => gate.promise } });
  store.setState({ pendingContact: { channel: 'PHONE', contact: '+21622123456' }, authError: 'Old error' });
  const first = store.getState().requestLoginCode('user@example.tn', 'EMAIL');
  assert.equal(store.getState().authPending, true);
  assert.equal(store.getState().authError, undefined);
  assert.equal(await store.getState().requestLoginCode('+21699123456', 'PHONE'), false);
  assert.equal(await store.getState().verifyLoginCode('123456'), false);
  assert.deepEqual(calls.auth, [{ name: 'requestEmailOtp', args: ['user@example.tn'] }]);
  assert.equal(calls.me, 0);
  gate.resolve({ detail: 'OK' });
  assert.equal(await first, true);
  assert.equal(store.getState().authPending, false);
  assert.deepEqual(plain(store.getState().pendingContact), { channel: 'EMAIL', contact: 'user@example.tn' });
});

test('authPending guards duplicate verification and new requests while verifying', async () => {
  const gate = deferred();
  const { store, calls } = loadSession({ auth: { verifyOtp: () => gate.promise } });
  store.setState({ pendingContact: { channel: 'PHONE', contact: '+21622123456' }, authError: 'Old error' });
  const first = store.getState().verifyLoginCode('123456');
  assert.equal(store.getState().authPending, true);
  assert.equal(store.getState().authError, undefined);
  assert.equal(await store.getState().verifyLoginCode('654321'), false);
  assert.equal(await store.getState().requestLoginCode('user@example.tn', 'EMAIL'), false);
  assert.deepEqual(calls.auth, [{ name: 'verifyOtp', args: ['+21622123456', '123456'] }]);
  assert.equal(calls.me, 0);
  gate.resolve({ access: 'verified-access', refresh: 'verified-refresh' });
  assert.equal(await first, true);
  assert.equal(store.getState().authPending, false);
  assert.equal(store.getState().pendingContact, undefined);
  assert.equal(calls.me, 1);
});

test('verification without a pending contact fails without making service calls', async () => {
  const { store, calls } = loadSession();
  assert.equal(await store.getState().verifyLoginCode('123456'), false);
  assert.equal(store.getState().authError, 'No login request in progress.');
  assert.equal(store.getState().authPending, false);
  assert.deepEqual(calls.auth, []);
  assert.equal(calls.me, 0);
});

test('failed code request preserves pending contact and previous tokens', async () => {
  const { store, client, calls } = loadSession({ auth: {
    requestEmailOtp: async () => { throw new Error('Please wait before requesting another code'); },
  } });
  const pendingContact = { channel: 'PHONE', contact: '+21622123456' };
  store.setState({ access: 'old-access', refresh: 'old-refresh', pendingContact });
  client.setAuthToken('old-access');
  assert.equal(await store.getState().requestLoginCode('user@example.tn', 'EMAIL'), false);
  assert.equal(store.getState().pendingContact, pendingContact);
  assert.equal(store.getState().access, 'old-access');
  assert.equal(store.getState().refresh, 'old-refresh');
  assert.equal(store.getState().authPending, false);
  assert.equal(store.getState().authError, 'Please wait before requesting another code');
  assert.deepEqual(calls.tokens, ['old-access']);
});

for (const refresh of [undefined, 'old-refresh']) {
  test(`signOut clears pending contact, errors and local tokens ${refresh ? 'even if logout fails' : 'without a refresh token'}`, async () => {
    const { store, client, calls } = loadSession({ auth: {
      logout: async () => { throw new Error('Network request failed'); },
    } });
    store.setState({ user: { id: 'old-user' }, access: 'old-access', refresh,
      pendingContact: { channel: 'EMAIL', contact: 'user@example.tn' }, authError: 'Invalid code' });
    client.setAuthToken('old-access');
    await store.getState().signOut();
    assert.equal(store.getState().user, undefined);
    assert.equal(store.getState().access, undefined);
    assert.equal(store.getState().refresh, undefined);
    assert.equal(store.getState().pendingContact, undefined);
    assert.equal(store.getState().authError, undefined);
    assert.deepEqual(calls.tokens, ['old-access', undefined]);
    assert.deepEqual(calls.auth, refresh ? [{ name: 'logout', args: [refresh] }] : []);
    assert.equal(await store.getState().verifyLoginCode('123456'), false);
    assert.equal(calls.me, 0);
    // Allow the deliberately rejected best-effort logout to settle.
    await new Promise(setImmediate);
  });
}

for (const page of [1, 2]) {
  test(`verification list requests owned page ${page} without following external URLs`, async () => {
    const calls = [];
    const { listDocuments } = loadModule('../src/services/verification.ts', {
      '@/api/client': { request: async (...args) => { calls.push(args); return { results: [] }; } },
    });
    await listDocuments(page);
    assert.deepEqual(plain(calls), [[`/api/v1/verification/documents/${page > 1 ? `?page=${page}` : ''}`, { method: 'GET', auth: true }]]);
  });

  test(`vehicle list requests owned page ${page}`, async () => {
    const calls = [];
    const { listVehicles } = loadModule('../src/services/vehicles.ts', {
      '@/api/client': { request: async (...args) => { calls.push(args); return { results: [] }; } },
    });
    await listVehicles(page);
    assert.deepEqual(plain(calls), [[`/api/v1/vehicles/${page > 1 ? `?page=${page}` : ''}`, { method: 'GET', auth: true }]]);
  });
}

for (const { name, user, href } of [
  { name: 'missing login request', user: undefined, href: '/(auth)/phone' },
  { name: 'newly authenticated user', user: { profile: { full_name: '' } }, href: '/profile?onboarding=1' },
  { name: 'returning authenticated user', user: { profile: { full_name: 'Synthetic Passenger' } }, href: '/(tabs)' },
]) {
  test(`verification redirect handles ${name} without returning signed-in users to login`, () => {
    const { default: VerifyScreen } = loadModule('../src/app/(auth)/verify.tsx', {
      react: { useState: (initial) => [initial, () => {}], useRef: (initial) => ({ current: initial }) },
      'react/jsx-runtime': { jsx: (type, props) => ({ type, props }) },
      'expo-router': { Redirect: 'Redirect', router: {} },
      'react-native': {},
      'react-native-safe-area-context': {},
      '@/components': {},
      '@/store/session': { useSession: (select) => select({ user }) },
    });
    const rendered = VerifyScreen();
    assert.equal(rendered.type, 'Redirect');
    assert.equal(rendered.props.href, href);
  });
}

function loadUpload({ platform = 'web', pick, send = async () => ({ ok: true }), File } = {}) {
  return loadModule('../src/lib/upload.ts', {
    'expo-document-picker': { getDocumentAsync: pick },
    'react-native': { Platform: { OS: platform } },
    'expo/fetch': { fetch: send },
    'expo-file-system': { File },
  }, { fetch: send });
}

const uploadTypes = ['image/jpeg', 'image/png', 'application/pdf'];
const uploadMaxBytes = 5 * 1024 * 1024;

for (const platform of ['web', 'ios', 'android']) {
  test(`${platform} signed upload PUT sends only Content-Type, never Authorization`, async () => {
    const calls = [];
    const body = { synthetic: 'upload-body' };
    const url = 'https://storage.example/upload?signature=synthetic';
    const { uploadFile } = loadUpload({ platform, send: async (...args) => {
      calls.push(args);
      return { ok: true, status: 200 };
    } });
    await uploadFile(url, body, 'image/jpeg');
    assert.equal(calls.length, 1);
    const [sentUrl, options] = calls[0];
    assert.equal(sentUrl, url);
    assert.equal(options.method, 'PUT');
    assert.equal(options.body, body);
    assert.deepEqual(plain(options.headers), { 'Content-Type': 'image/jpeg' });
    assert.equal(Object.keys(options.headers).some((key) => key.toLowerCase() === 'authorization'), false);
  });

  test(`${platform} upload reports a failed signed PUT`, async () => {
    const { uploadFile } = loadUpload({ platform, send: async () => ({ ok: false, status: 403 }) });
    await assert.rejects(uploadFile('https://storage.example/upload', {}, 'application/pdf'), /Upload failed \(403\)/);
  });

  test(`${platform} upload reports a readable network failure`, async () => {
    const { uploadFile } = loadUpload({ platform, send: async () => { throw new TypeError('Failed to fetch'); } });
    await assert.rejects(uploadFile('https://storage.example/upload', {}, 'application/pdf'), /Unable to reach file storage/);
  });
}

test('canceled upload selection returns null without accessing assets or uploading', async () => {
  const options = [];
  const { pickUpload } = loadUpload({
    pick: async (value) => { options.push(value); return { canceled: true, assets: null }; },
    send: async () => { assert.fail('Canceled selection must not fetch'); },
  });
  assert.equal(await pickUpload(uploadTypes, uploadMaxBytes), null);
  assert.deepEqual(plain(options), [{ type: uploadTypes, copyToCacheDirectory: true, multiple: false }]);
});

for (const contentType of uploadTypes) {
  for (const size of [1, uploadMaxBytes]) {
    test(`upload selection accepts ${contentType} at the ${size}-byte boundary`, async () => {
      const file = { size };
      const { pickUpload } = loadUpload({ pick: async () => ({ canceled: false,
        assets: [{ name: 'synthetic-file', uri: 'blob:synthetic', mimeType: contentType, size, file }] }),
      send: async () => { assert.fail('An existing web File must not be fetched'); } });
      const selected = await pickUpload(uploadTypes, uploadMaxBytes);
      assert.equal(selected.name, 'synthetic-file');
      assert.equal(selected.contentType, contentType);
      assert.equal(selected.size, size);
      assert.equal(selected.body, file);
    });
  }
}

for (const { name, asset, message } of [
  { name: 'oversized file', asset: { size: uploadMaxBytes + 1, mimeType: 'image/jpeg' }, message: /smaller than 5 MB/ },
  { name: 'empty file', asset: { size: 0, mimeType: 'image/jpeg' }, message: /smaller than 5 MB/ },
  { name: 'unknown size', asset: { mimeType: 'image/jpeg' }, message: /smaller than 5 MB/ },
  { name: 'missing MIME type', asset: { size: 1 }, message: /supported file type/ },
  { name: 'unsupported MIME type', asset: { size: 1, mimeType: 'application/zip' }, message: /supported file type/ },
]) {
  test(`upload selection rejects ${name} before reading the body`, async () => {
    const { pickUpload } = loadUpload({ pick: async () => ({ canceled: false, assets: [asset] }),
      send: async () => { assert.fail('Invalid selection must not fetch'); } });
    await assert.rejects(pickUpload(uploadTypes, uploadMaxBytes), message);
  });
}

test('web upload selection falls back to File.size when picker size is absent', async () => {
  const file = { size: uploadMaxBytes };
  const { pickUpload } = loadUpload({ pick: async () => ({ canceled: false,
    assets: [{ name: 'synthetic.pdf', mimeType: 'application/pdf', file }] }) });
  const selected = await pickUpload(uploadTypes, uploadMaxBytes);
  assert.equal(selected.size, uploadMaxBytes);
  assert.equal(selected.body, file);
});

test('web upload selection rejects an oversized fallback File.size', async () => {
  const { pickUpload } = loadUpload({ pick: async () => ({ canceled: false,
    assets: [{ mimeType: 'application/pdf', file: { size: uploadMaxBytes + 1 } }] }) });
  await assert.rejects(pickUpload(uploadTypes, uploadMaxBytes), /smaller than 5 MB/);
});

test('web upload selection fetches the URI blob when the picker has no File', async () => {
  const body = { synthetic: 'blob' };
  const urls = [];
  const { pickUpload } = loadUpload({
    pick: async () => ({ canceled: false, assets: [{ name: 'synthetic.pdf', uri: 'blob:synthetic', mimeType: 'application/pdf', size: 1 }] }),
    send: async (url) => { urls.push(url); return { blob: async () => body }; },
  });
  const selected = await pickUpload(uploadTypes, uploadMaxBytes);
  assert.deepEqual(urls, ['blob:synthetic']);
  assert.equal(selected.body, body);
});

test('native upload selection constructs the File body without a web fetch', async () => {
  class File {
    constructor(uri) { this.uri = uri; }
  }
  const { pickUpload } = loadUpload({ platform: 'ios', File,
    pick: async () => ({ canceled: false, assets: [{ name: 'synthetic.jpg', uri: 'file:///synthetic.jpg', mimeType: 'image/jpeg', size: 1 }] }),
    send: async () => { assert.fail('Native selection must not use web fetch'); },
  });
  const selected = await pickUpload(uploadTypes, uploadMaxBytes);
  assert.ok(selected.body instanceof File);
  assert.equal(selected.body.uri, 'file:///synthetic.jpg');
  assert.equal(selected.contentType, 'image/jpeg');
  assert.equal(selected.size, 1);
});

function loadService(path) {
  const calls = [];
  const service = loadModule(path, {
    '@/api/client': { request: async (...args) => { calls.push(args); return { results: [] }; } },
    '@/lib/geo': { toGeoPoint: (lat, lng) => ({ type: 'Point', coordinates: [lng, lat] }) },
  }, { URLSearchParams });
  return { service, calls };
}

test('rideQuery sends only the search values that are set', () => {
  const { service } = loadService('../src/services/rides.ts');
  assert.equal(service.rideQuery(), '');
  assert.equal(service.rideQuery({ scope: 'bookable', minSeats: 1, ordering: 'departure', page: 1 }), '');
  const query = new URLSearchParams(service.rideQuery({
    from: { lat: 36.80651234, lng: 10.18149999, radiusKm: 15 },
    to: { lat: 35.8256, lng: 10.6084 },
    departureAfter: '2026-11-18T05:00:00.000Z',
    departureBefore: '2026-11-18T11:00:00.000Z',
    maxPrice: '12.500',
    minSeats: 2,
    ordering: 'pickup',
    page: 3,
  }).slice(1));
  assert.deepEqual(Object.fromEntries(query), {
    from_lat: '36.80651', from_lng: '10.18150', from_radius_km: '15',
    to_lat: '35.82560', to_lng: '10.60840',
    departure_after: '2026-11-18T05:00:00.000Z', departure_before: '2026-11-18T11:00:00.000Z',
    max_price: '12.500', min_seats: '2', ordering: 'pickup', page: '3',
  });
  assert.equal(service.rideQuery({ scope: 'mine', when: 'completed', page: 2 }), '?scope=mine&when=completed&page=2');
});

test('listBookings filters by ride only when one is given', async () => {
  const { service, calls } = loadService('../src/services/bookings.ts');
  await service.listBookings();
  await service.listBookings({ ride: 'ride a/1' });
  assert.deepEqual(plain(calls).map((c) => c[0]), ['/api/v1/bookings/', '/api/v1/bookings/?ride=ride%20a%2F1']);
});

test('departureWindow limits a chosen day and part, clamped to now', () => {
  const { departureWindow } = loadModule('../src/lib/search.ts');
  const now = new Date(2026, 10, 17, 14, 30);
  assert.deepEqual(plain(departureWindow(now, null, 'morning')), {});
  assert.deepEqual(plain(departureWindow(now, 1, 'morning')), {
    departureAfter: new Date(2026, 10, 18, 5).toISOString(),
    departureBefore: new Date(2026, 10, 18, 12).toISOString(),
  });
  assert.deepEqual(plain(departureWindow(now, 0, 'afternoon')), {
    departureAfter: now.toISOString(),
    departureBefore: new Date(2026, 10, 17, 18).toISOString(),
  });
  assert.deepEqual(plain(departureWindow(now, 0, 'any')), {
    departureAfter: now.toISOString(),
    departureBefore: new Date(2026, 10, 18, 0).toISOString(),
  });
});

test('groupByDay keeps order and splits on local day changes', () => {
  const { groupByDay } = loadModule('../src/lib/search.ts');
  const at = (d, h) => ({ id: `${d}-${h}`, departure_at: new Date(2026, 10, d, h).toISOString() });
  const sections = groupByDay([at(18, 9), at(18, 20), at(17, 8), at(18, 7)]);
  assert.deepEqual(plain(sections.map((s) => s.data.map((r) => r.id))), [['18-9', '18-20'], ['17-8'], ['18-7']]);
  assert.deepEqual(plain(groupByDay([])), []);
});

test('maxPriceError accepts empty or a positive TND amount', () => {
  const { maxPriceError } = loadModule('../src/lib/search.ts');
  for (const ok of ['', '  ', '15', '12.500', '7,5']) assert.equal(maxPriceError(ok), null, ok);
  for (const bad of ['0', '-3', 'abc', '1.2345', '12.']) assert.match(maxPriceError(bad), /TND amount above 0/, bad);
});

for (const { scope, path } of [
  { scope: undefined, path: '/api/v1/rides/' },
  { scope: 'bookable', path: '/api/v1/rides/' },
  { scope: 'mine', path: '/api/v1/rides/?scope=mine' },
  { scope: 'joined', path: '/api/v1/rides/?scope=joined' },
]) {
  test(`listRides scope ${scope ?? 'default'} requests ${path}`, async () => {
    const { service, calls } = loadService('../src/services/rides.ts');
    await service.listRides(scope ? { scope } : undefined);
    assert.deepEqual(plain(calls), [[path, { method: 'GET', auth: true }]]);
  });
}

test('ride lifecycle services hit the owner endpoints with the right methods', async () => {
  const { service, calls } = loadService('../src/services/rides.ts');
  await service.updateRide('r1', { seats_total: 2, notes: 'Synthetic note' });
  await service.startRide('r1');
  await service.completeRide('r1');
  await service.rideCancellationQuote('r1');
  await service.cancelRide('r1');
  assert.deepEqual(plain(calls), [
    ['/api/v1/rides/r1/', { method: 'PATCH', auth: true, body: { seats_total: 2, notes: 'Synthetic note' } }],
    ['/api/v1/rides/r1/start/', { method: 'POST', auth: true }],
    ['/api/v1/rides/r1/complete/', { method: 'POST', auth: true }],
    ['/api/v1/rides/r1/cancellation-quote/', { method: 'GET', auth: true }],
    ['/api/v1/rides/r1/cancel/', { method: 'POST', auth: true }],
  ]);
});

test('publishRide sends notes, defaulting to an empty string', async () => {
  const { service, calls } = loadService('../src/services/rides.ts');
  const input = { origin: { lat: 36.8, lng: 10.18 }, destination: { lat: 35.82, lng: 10.63 }, origin_label: 'A',
    destination_label: 'B', departure_at: '2026-12-01T08:00:00.000Z', seats_total: 3, price_per_seat: '12.500', vehicle: 'v1' };
  await service.publishRide(input);
  await service.publishRide({ ...input, notes: 'One bag each' });
  assert.equal(calls[0][1].body.notes, '');
  assert.equal(calls[1][1].body.notes, 'One bag each');
});

test('booking money services request quotes and send the approved total on confirm', async () => {
  const { service, calls } = loadService('../src/services/bookings.ts');
  await service.paymentQuote('b1');
  await service.confirmBooking('b1', '12.500');
  await service.cancellationQuote('b1');
  await service.transitionBooking('b1', 'cancel_passenger');
  await service.transitionBooking('b1', 'no_show');
  assert.deepEqual(plain(calls), [
    ['/api/v1/bookings/b1/payment-quote/', { method: 'GET', auth: true }],
    ['/api/v1/bookings/b1/transitions/confirm/', { method: 'POST', auth: true, body: { expected_out_of_pocket: '12.500' } }],
    ['/api/v1/bookings/b1/cancellation-quote/', { method: 'GET', auth: true }],
    ['/api/v1/bookings/b1/transitions/cancel_passenger/', { method: 'POST', auth: true }],
    ['/api/v1/bookings/b1/transitions/no_show/', { method: 'POST', auth: true }],
  ]);
});

test('rideQuery sends atmosphere and the shared-interest flag only when set', () => {
  const { service } = loadService('../src/services/rides.ts');
  assert.equal(service.rideQuery({ sharedInterests: false }), '');
  assert.equal(service.rideQuery({ atmosphere: 'QUIET', sharedInterests: true }), '?atmosphere=QUIET&shared_interests=true');
});

test('publishRide sends atmosphere and preferred interests, defaulting to none', async () => {
  const { service, calls } = loadService('../src/services/rides.ts');
  const input = { origin: { lat: 36.8, lng: 10.18 }, destination: { lat: 35.82, lng: 10.63 }, origin_label: 'A',
    destination_label: 'B', departure_at: '2026-12-01T08:00:00.000Z', seats_total: 3, price_per_seat: '12.500', vehicle: 'v1' };
  await service.publishRide(input);
  await service.publishRide({ ...input, atmosphere: 'MUSIC', preferred_interests: ['tech'] });
  assert.deepEqual(plain([calls[0][1].body.atmosphere, calls[0][1].body.preferred_interests]), ['', []]);
  assert.deepEqual(plain([calls[1][1].body.atmosphere, calls[1][1].body.preferred_interests]), ['MUSIC', ['tech']]);
});

test('listInterestTags fetches once, and retries after a failure', async () => {
  let calls = 0;
  let fail = true;
  const service = loadModule('../src/services/users.ts', {
    '@/api/client': { request: async (path) => {
      calls += 1;
      assert.equal(path, '/api/v1/users/interest-tags/');
      if (fail) throw new Error('offline');
      return [{ slug: 'music', labels: { en: 'Music', fr: 'Musique', ar: 'موسيقى' } }];
    } },
  });
  await assert.rejects(service.listInterestTags(), /offline/);
  fail = false;
  const [first, second] = await Promise.all([service.listInterestTags(), service.listInterestTags()]);
  assert.equal(first, second);
  assert.equal(calls, 2);
  assert.equal(service.tagLabel('music', first), 'Music');
  assert.equal(service.tagLabel('retired-tag', first), 'Retired-tag');
});

test('wallet services use owned routes, the kind filter and the Flouci topup payload', async () => {
  const { service, calls } = loadService('../src/services/wallet.ts');
  await service.ledgerEntries();
  await service.ledgerEntries({ kinds: ['VOUCHER_REDEEM', 'SPONSOR_SUBSIDY'], page: 2 });
  await service.walletEarnings();
  await service.createTopup('25.500');
  await service.listPaymentIntents();
  await service.getPaymentIntent('pi1');
  await service.cancelPaymentIntent('pi1');
  await service.listVouchers();
  await service.claimVoucher('SUMMER10');
  await service.listRewards();
  assert.deepEqual(plain(calls), [
    ['/api/v1/wallet/entries/', { method: 'GET', auth: true }],
    ['/api/v1/wallet/entries/?kind=VOUCHER_REDEEM%2CSPONSOR_SUBSIDY&page=2', { method: 'GET', auth: true }],
    ['/api/v1/wallet/earnings/', { method: 'GET', auth: true }],
    ['/api/v1/payments/topup/', { method: 'POST', auth: true, body: { amount: '25.500', gateway: 'FLOUCI' } }],
    ['/api/v1/payments/intents/', { method: 'GET', auth: true }],
    ['/api/v1/payments/intents/pi1/', { method: 'GET', auth: true }],
    ['/api/v1/payments/intents/pi1/cancel/', { method: 'POST', auth: true }],
    ['/api/v1/incentives/vouchers/', { method: 'GET', auth: true }],
    ['/api/v1/incentives/vouchers/claim/', { method: 'POST', auth: true, body: { code: 'SUMMER10' } }],
    ['/api/v1/incentives/rewards/', { method: 'GET', auth: true }],
  ]);
});

function socketHarness(base = 'ws://localhost:8000', development = true) {
  const connections = [];
  const timers = new Map();
  let timerId = 0;
  class FakeWebSocket {
    constructor(url) { this.url = url; connections.push(this); }
    close() { this.closed = true; }
  }
  const module = loadModule('../src/lib/chatSocket.ts', {
    '@/api/client': { wsUrl: (path) => `${base}${path}` },
    '@/api/mock': { MOCK_ENABLED: false },
  }, {
    URL, __DEV__: development, WebSocket: FakeWebSocket,
    setTimeout: (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    clearTimeout: (id) => timers.delete(id),
  });
  const runTimer = () => {
    const [id, { callback }] = timers.entries().next().value;
    timers.delete(id);
    callback();
  };
  return { ...module, connections, timers, runTimer };
}

for (const code of [4401, 4403, 1008]) {
  test(`chat socket stops permanently after close ${code}`, () => {
    const harness = socketHarness();
    const closes = [];
    harness.createChatSocket('conversation', 'synthetic-token', { onClose: (value) => closes.push(value) });
    harness.connections[0].onclose({ code });
    assert.deepEqual(closes, [code]);
    assert.equal(harness.timers.size, 0);
  });
}

test('chat transient reconnect uses backoff and disposal cancels callbacks', () => {
  const harness = socketHarness();
  let opens = 0;
  const socket = harness.createChatSocket('conversation', 'synthetic-token', { onOpen: () => { opens += 1; } });
  harness.connections[0].onclose({ code: 1006 });
  assert.equal([...harness.timers.values()][0].delay, 1000);
  harness.runTimer();
  assert.equal(harness.connections.length, 2);
  harness.connections[0].onopen();
  assert.equal(opens, 0);
  harness.connections[1].onclose({ code: 1006 });
  assert.equal([...harness.timers.values()][0].delay, 2000);
  socket.close();
  assert.equal(harness.timers.size, 0);
  harness.connections[1].onopen();
  assert.equal(opens, 0);
});

for (const [base, development] of [['ws://remote.example.test', true], ['ws://localhost:8000', false]]) {
  test(`chat refuses insecure endpoint ${base} dev=${development}`, () => {
    const harness = socketHarness(base, development);
    const errors = [];
    harness.createChatSocket('conversation', 'synthetic-secret', { onError: (message) => errors.push(message) });
    assert.equal(harness.connections.length, 0);
    harness.runTimer();
    assert.equal(errors.length, 1);
    assert.ok(!errors[0].includes('synthetic-secret') && !errors[0].includes(base));
  });
}

test('chat uses encoded credentials over TLS and ignores invalid or cross-conversation frames', () => {
  const harness = socketHarness('wss://api.example.test', false);
  const messages = [];
  harness.createChatSocket('conversation', 'synthetic&token', { onMessage: (message) => messages.push(message) });
  const ws = harness.connections[0];
  assert.equal(new URL(ws.url).searchParams.get('token'), 'synthetic&token');
  const message = { id: 'm1', conversation: 'conversation', sender: 'user', body: 'Hi', created_at: new Date().toISOString() };
  for (const frame of [null, { body: 'flat' }, { type: 'chat.message', message: { ...message, conversation: 'other' } },
    { type: 'chat.message', message: { ...message, created_at: 'invalid' } },
    { type: 'chat.message', message: { ...message, body: 'a'.repeat(2001) } }]) {
    ws.onmessage({ data: JSON.stringify(frame) });
  }
  assert.equal(messages.length, 0);
  ws.onmessage({ data: JSON.stringify({ type: 'chat.message', message }) });
  assert.deepEqual(plain(messages), [{ type: 'chat.message', message }]);
});

test('chat services unwrap flat history and require server permission fields', async () => {
  let result = [{ id: 'message' }];
  const { listMessages, getConversation } = loadModule('../src/services/conversations.ts', {
    '@/api/client': { request: async () => result },
  });
  assert.deepEqual(plain(await listMessages('conversation')), {
    count: 1, next: null, previous: null, results: [{ id: 'message' }],
  });
  result = {};
  await assert.rejects(listMessages('conversation'), /Could not read/);
  await assert.rejects(getConversation('conversation'), /Could not verify/);
  result = { id: 'conversation', booking_status: 'COMPLETED', can_send: false };
  assert.equal((await getConversation('conversation')).can_send, false);
});

// Phase 6: exercise the shipped notification modules, including transpiled native imports.
const notificationUuid = '12345678-1234-1234-abcd-1234567890ab';
const notificationDeviceKey = 'blasa.notification-device';

function notificationPreferencesFixture(overrides = {}) {
  return {
    push_enabled: false, email_enabled: true, sms_enabled: false, promotions_enabled: false,
    ...overrides,
    capabilities: { expo: true, fcm: false, email: true, sms: false, ...overrides.capabilities },
  };
}

function notificationZustand() {
  const initializeStore = (initialize) => {
    let state;
    const set = (patch) => { state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }; };
    state = initialize(set, () => state);
    const store = (select) => select(state);
    store.getState = () => state;
    store.setState = set;
    return store;
  };
  return { create: (initialize) => initialize ? initializeStore(initialize) : initializeStore };
}

function loadNotificationStore(wallet = {}) {
  return loadModule('../src/store/notifications.ts', {
    zustand: notificationZustand(),
    '@/services/wallet': {
      notificationUnreadCount: async () => ({ count: 0 }),
      notificationPreferences: async () => notificationPreferencesFixture(),
      ...wallet,
    },
  }).useNotifications;
}

function notificationHarness(options = {}) {
  const calls = {
    imports: [], permissionReads: 0, permissionPrompts: 0, expoRequests: [], nativeRequests: 0,
    channels: [], handlers: [], clearedResponses: 0, requests: [], routes: [],
  };
  const intervals = new Map();
  const timers = new Map();
  const appListeners = [];
  const receivedListeners = [];
  const responseListeners = [];
  const storage = new Map();
  if (options.savedDevice) storage.set(notificationDeviceKey, JSON.stringify(options.savedDevice));
  let timerId = 0;
  const subscribe = (listeners, callback) => {
    const subscription = { callback, removed: false, remove() { this.removed = true; } };
    listeners.push(subscription);
    return subscription;
  };
  const appState = {
    currentState: options.appState ?? 'active',
    addEventListener: (name, callback) => {
      assert.equal(name, 'change');
      return subscribe(appListeners, callback);
    },
  };
  const native = {
    IosAuthorizationStatus: { PROVISIONAL: 3 }, AndroidImportance: { DEFAULT: 3 },
    getPermissionsAsync: async () => { calls.permissionReads += 1; return options.permission ?? { granted: false }; },
    requestPermissionsAsync: async () => { calls.permissionPrompts += 1; return options.promptPermission ?? { granted: true }; },
    setNotificationChannelAsync: async (...args) => { calls.channels.push(args); },
    getExpoPushTokenAsync: async (args) => {
      calls.expoRequests.push(args);
      return { data: options.expoToken ?? 'ExpoPushToken[regression_fixture]' };
    },
    getDevicePushTokenAsync: async () => {
      calls.nativeRequests += 1;
      return { data: 'regression-native-fixture' };
    },
    setNotificationHandler: (handler) => { calls.handlers.push(handler); },
    addNotificationReceivedListener: (callback) => subscribe(receivedListeners, callback),
    addNotificationResponseReceivedListener: (callback) => subscribe(responseListeners, callback),
    getLastNotificationResponseAsync: async () => options.lastResponse ?? null,
    clearLastNotificationResponseAsync: async () => { calls.clearedResponses += 1; },
    ...options.native,
  };
  const preferences = options.preferences ?? notificationPreferencesFixture();
  const wallet = loadModule('../src/services/wallet.ts', {
    '@/api/client': { request: async (path, requestOptions) => {
      calls.requests.push({ path, options: requestOptions });
      if (options.request) return options.request(path, requestOptions);
      if (path === '/api/v1/notifications/preferences/') return preferences;
      if (path === '/api/v1/notifications/unread-count/') return { count: 4 };
      if (path.startsWith('/api/v1/notifications/?')) return { results: [], next: null };
      return {};
    } },
  }, { URLSearchParams });
  const store = loadNotificationStore(wallet);
  const constants = {
    executionEnvironment: options.executionEnvironment ?? 'standalone',
    expoConfig: { extra: { eas: { projectId: options.projectId === undefined ? 'regression-project' : options.projectId } } },
    easConfig: options.easConfig,
  };
  const modules = {
    'expo-constants': { default: constants },
    'expo-router': { router: { push: (route) => calls.routes.push(route) } },
    'react-native': { Platform: { OS: options.platform ?? 'web' }, AppState: appState },
    '@/lib/secure-storage': { persistentStorage: {
      getItem: async (key) => storage.get(key) ?? null,
      setItem: async (key, value) => { storage.set(key, value); },
      removeItem: async (key) => { storage.delete(key); },
    } },
    '@/services/wallet': wallet,
    '@/store/notifications': { useNotifications: store },
  };
  for (const [name, value] of [['expo-device', { isDevice: options.isDevice ?? true }], ['expo-notifications', native]]) {
    Object.defineProperty(modules, name, { get: () => { calls.imports.push(name); return value; } });
  }
  const lib = loadModule('../src/lib/notifications.ts', modules, {
    Date,
    setInterval: (callback, delay) => { const id = ++timerId; intervals.set(id, { callback, delay }); return id; },
    clearInterval: (id) => intervals.delete(id),
    setTimeout: (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    clearTimeout: (id) => timers.delete(id),
  });
  const activate = (owner = 'owner-a') => lib.startNotificationSession(owner);
  const changeAppState = (state) => {
    appState.currentState = state;
    for (const listener of appListeners) if (!listener.removed) listener.callback(state);
  };
  return { lib, wallet, store, calls, native, storage, intervals, timers, appListeners, receivedListeners, responseListeners, activate, changeAppState };
}

function loadSessionWithNotificationCleanup(cleanup) {
  const events = [];
  const client = loadClient(async () => response(200, {}));
  const originalSetToken = client.setAuthToken;
  let refreshSession;
  const originalSetRefreshHandler = client.setRefreshHandler;
  client.setAuthToken = (value) => { events.push(value === undefined ? 'clear-token' : 'set-token'); originalSetToken(value); };
  client.setRefreshHandler = (handler) => { refreshSession = handler; originalSetRefreshHandler(handler); };
  const { useSession: store } = loadModule('../src/store/session.ts', {
    zustand: notificationZustand(),
    'zustand/middleware': { persist: (initialize) => initialize, createJSONStorage: () => ({}) },
    '@/api/client': client,
    '@/api/mock': { MOCK_ENABLED: false },
    '@/lib/notifications': { cleanupNotificationSession: async (owner) => {
      events.push('cleanup-start');
      assert.equal(owner, 'owner-a');
      await cleanup(owner);
      events.push('cleanup-end');
    } },
    '@/lib/secure-storage': { persistentStorage: {} },
    '@/services/auth': {
      logout: async () => {
        assert.ok(store.getState().access !== undefined, 'Logout must start while the access token is held');
        events.push('logout');
      },
      requestOtp: async () => { events.push('request-phone'); },
      requestEmailOtp: async () => { events.push('request-email'); },
      refreshToken: async () => { events.push('refresh'); return { access: 'fixture-access', refresh: 'fixture-refresh' }; },
    },
    '@/services/users': { me: async () => ({ id: 'owner-a' }) },
  });
  store.setState({ user: { id: 'owner-a' }, access: 'fixture-access', refresh: 'fixture-refresh' });
  client.setAuthToken('fixture-access');
  events.length = 0;
  return { store, events, refreshSession };
}

const notificationTargets = [
  ['booking.created', 'booking_id', '/booking/[id]'],
  ['booking.status_changed', 'booking_id', '/booking/[id]'],
  ['ride.published', 'ride_id', '/ride/[id]'],
  ['ride.cancelled', 'ride_id', '/ride/[id]'],
  ['ride.reminder', 'ride_id', '/ride/[id]'],
  ['match.found', 'ride_id', '/ride/[id]'],
  ['verification.changed', 'document_id', '/verification'],
  ['payment.status_changed', 'intent_id', '/wallet'],
  ['incentive.awarded', 'award_id', '/wallet'],
  ['wallet.posted', 'entry_id', '/wallet'],
  ['wallet.posted', 'transaction_id', '/wallet'],
];
for (const [kind, key, pathname] of notificationTargets) {
  test(`notificationLink allowlists ${kind} with ${key} and ignores supplied URLs`, () => {
    const { lib } = notificationHarness();
    for (const id of [notificationUuid, notificationUuid.toUpperCase()]) {
      const target = lib.notificationLink(kind, {
        [key]: id, url: 'https://foreign.example.test/redirect', href: '//foreign.example.test', route: '/admin',
      });
      assert.deepEqual(plain(target), pathname.includes('[id]') ? { pathname, params: { id } } : pathname);
    }
  });
}

test('notificationLink rejects malformed UUIDs, wrong ID fields and non-object payloads for every kind', () => {
  const { lib } = notificationHarness();
  const badIds = ['', 'not-a-uuid', 123, null, {}, notificationUuid.slice(1), `${notificationUuid}0`,
    ` ${notificationUuid}`, `${notificationUuid}\n`, notificationUuid.replace('abcd', 'ghij'),
    `${notificationUuid}/../wallet`, `${notificationUuid}?next=/admin`, encodeURIComponent(`/${notificationUuid}`)];
  for (const [kind, key] of notificationTargets) {
    for (const value of badIds) assert.equal(lib.notificationLink(kind, { [key]: value }), undefined);
    for (const raw of [null, undefined, false, 1, 'https://foreign.example.test', [], [{ [key]: notificationUuid }], {}]) {
      assert.equal(lib.notificationLink(kind, raw), undefined);
    }
    assert.equal(lib.notificationLink(kind, { id: notificationUuid, url: '/wallet' }), undefined);
  }
});

test('notificationLink rejects unknown, case-changed and URL-shaped kinds even with all valid IDs', () => {
  const { lib } = notificationHarness();
  const payload = Object.fromEntries(notificationTargets.map(([, key]) => [key, notificationUuid]));
  for (const kind of ['', 'booking', 'booking.cancelled', 'Booking.created', 'RIDE.PUBLISHED',
    'ride.published ', 'https://foreign.example.test', '/wallet', '__proto__', 'constructor']) {
    assert.equal(lib.notificationLink(kind, payload), undefined);
  }
  assert.equal(lib.notificationLink('wallet.posted', { entry_id: 'invalid', transaction_id: notificationUuid }), '/wallet');
});

test('notificationDate formats valid timestamps and date-only values with safe locale fallback', () => {
  const { lib } = notificationHarness();
  const timestamp = '2026-11-18T08:15:00.000Z';
  assert.equal(lib.notificationDate(timestamp), new Date(timestamp).toLocaleString('en'));
  assert.equal(lib.notificationDate(timestamp, 'fr', true), new Date(timestamp).toLocaleDateString('fr'));
  assert.equal(lib.notificationDate('2026-11-18', 'en', true), new Date('2026-11-18T12:00:00').toLocaleDateString('en'));
  assert.equal(lib.notificationDate(timestamp, 'invalid_locale'), new Date(timestamp).toLocaleString('en'));
  assert.equal(lib.notificationDate('2026-11-18', 'invalid_locale', true), new Date('2026-11-18T12:00:00').toLocaleDateString('en'));
});

test('notificationDate returns undefined for missing, malformed and unparseable dates', () => {
  const { lib } = notificationHarness();
  for (const value of [undefined, null, 0, {}, new Date(), '', 'tomorrow', '11/18/2026',
    '2026-1-18', '2026-13-18', '2026-11-18Tinvalid', ' 2026-11-18']) {
    assert.equal(lib.notificationDate(value), undefined);
  }
});

for (const { name, options, preferences, message } of [
  { name: 'web', options: {}, message: /Web push is unavailable/ },
  { name: 'Expo Go', options: { platform: 'android', executionEnvironment: 'storeClient' }, message: /not Expo Go/ },
  { name: 'preferences not loaded', options: { platform: 'ios' }, message: /Load preferences/ },
  { name: 'no server transport', options: { platform: 'android' }, preferences: { capabilities: { expo: false, fcm: false } }, message: /not configured on the server/ },
  { name: 'Expo without project', options: { platform: 'ios', projectId: null }, preferences: {}, message: /configured EAS project/ },
  { name: 'APNs is not FCM', options: { platform: 'ios' }, preferences: { capabilities: { expo: false, fcm: true } }, message: /APNs, not FCM/ },
  { name: 'Expo supported', options: { platform: 'ios' }, preferences: {}, message: undefined },
  { name: 'Android FCM supported', options: { platform: 'android', projectId: null }, preferences: { capabilities: { expo: false, fcm: true } }, message: undefined },
  { name: 'EAS config fallback', options: { platform: 'ios', projectId: null, easConfig: { projectId: 'fallback-project' } }, preferences: {}, message: undefined },
]) {
  test(`pushUnavailableMessage describes ${name} without loading native code`, () => {
    const { lib, calls } = notificationHarness(options);
    const actual = lib.pushUnavailableMessage(preferences ? notificationPreferencesFixture(preferences) : undefined);
    if (message) assert.match(actual, message);
    else assert.equal(actual, undefined);
    assert.deepEqual(calls.imports, []);
    assert.equal(calls.permissionPrompts, 0);
  });
}

for (const [platform, executionEnvironment, message] of [
  ['web', 'standalone', /Web push is unavailable/],
  ['android', 'storeClient', /not Expo Go/],
]) {
  test(`unsupported ${platform}/${executionEnvironment} never imports or prompts during passive setup or opt-in`, async () => {
    const preferences = notificationPreferencesFixture({ push_enabled: true });
    const harness = notificationHarness({ platform, executionEnvironment, preferences });
    const stop = harness.activate();
    await new Promise(setImmediate);
    assert.match(harness.store.getState().pushMessage, message);
    await assert.rejects(harness.lib.ensurePushRegistration('owner-a', preferences, true), message);
    assert.deepEqual(harness.calls.imports, []);
    assert.equal(harness.calls.permissionReads, 0);
    assert.equal(harness.calls.permissionPrompts, 0);
    assert.equal(harness.calls.requests.some(({ path }) => path.endsWith('/devices/')), false);
    await harness.lib.cleanupNotificationSession('owner-a');
    assert.equal(harness.store.getState().owner, undefined);
    assert.equal(harness.timers.size, 0);
    stop();
  });
}

for (const { name, args, path, method, body } of [
  { name: 'listNotifications', args: [], path: '?page=1', method: 'GET' },
  { name: 'listNotifications', args: [{ page: 2, unread: true }], path: '?page=2&unread=true', method: 'GET' },
  { name: 'listNotifications', args: [{ page: 1, unread: false }], path: '?page=1', method: 'GET' },
  { name: 'markNotificationRead', args: ['id /?&'], path: 'id%20%2F%3F%26/read/', method: 'POST' },
  { name: 'notificationUnreadCount', args: [], path: 'unread-count/', method: 'GET' },
  { name: 'markAllNotificationsRead', args: [], path: 'read-all/', method: 'POST' },
  { name: 'notificationPreferences', args: [], path: 'preferences/', method: 'GET' },
  { name: 'updateNotificationPreferences', args: [{ push_enabled: false, promotions_enabled: true }], path: 'preferences/', method: 'PATCH', body: { push_enabled: false, promotions_enabled: true } },
]) {
  test(`notification service ${name} uses its authenticated local ${method} wrapper (${path})`, async () => {
    const calls = [];
    const result = { count: 1, updated: 1, results: [], next: 'https://foreign.example.test/page/2' };
    const service = loadModule('../src/services/wallet.ts', {
      '@/api/client': { request: async (...args) => { calls.push(args); return result; } },
    }, { URLSearchParams });
    assert.equal(await service[name](...args), result);
    assert.deepEqual(plain(calls), [[`/api/v1/notifications/${path}`, { method, auth: true, ...(body ? { body } : {}) }]]);
  });
}

for (const [platform, provider] of [['IOS', 'EXPO'], ['ANDROID', 'EXPO'], ['ANDROID', 'FCM']]) {
  test(`registerDevice ${platform}/${provider} and unregisterDevice use bounded non-refreshing requests`, async () => {
    const calls = [];
    const result = {};
    const fixture = 'regression-device-fixture';
    const service = loadModule('../src/services/wallet.ts', {
      '@/api/client': { request: async (...args) => { calls.push(args); return result; } },
    });
    assert.equal(await service.registerDevice(fixture, platform, provider), result);
    assert.equal(await service.unregisterDevice(fixture), result);
    assert.equal(calls.length, 2);
    for (const [index, method] of ['POST', 'DELETE'].entries()) {
      const [path, options] = calls[index];
      assert.equal(path, '/api/v1/notifications/devices/');
      assert.ok(options.body.token === fixture, 'Device identity must be passed only in the body');
      const { token: omitted, ...body } = options.body;
      assert.ok(omitted === fixture);
      assert.deepEqual(plain({ ...options, body }), {
        method, auth: true, timeoutMs: 1500, _retried: true,
        body: index === 0 ? { platform, provider } : {},
      });
    }
  });
}

test('bounded device wrappers do not refresh or replay expired authenticated requests', async () => {
  let fetches = 0;
  let refreshes = 0;
  const client = loadClient(async () => { fetches += 1; return response(401, { detail: 'Expired' }); });
  client.setAuthToken('fixture-access');
  client.setRefreshHandler(async () => { refreshes += 1; return true; });
  const service = loadModule('../src/services/wallet.ts', { '@/api/client': client });
  await assert.rejects(service.registerDevice('regression-fixture', 'ANDROID', 'FCM'));
  await assert.rejects(service.unregisterDevice('regression-fixture'));
  assert.equal(fetches, 2);
  assert.equal(refreshes, 0);
});

test('notification store deduplicates pending unread and preference loads for the current owner', async () => {
  const count = deferred();
  const preferences = deferred();
  let countCalls = 0;
  let preferenceCalls = 0;
  const store = loadNotificationStore({
    notificationUnreadCount: () => { countCalls += 1; return count.promise; },
    notificationPreferences: () => { preferenceCalls += 1; return preferences.promise; },
  });
  store.getState().setOwner('owner-a');
  const jobs = [store.getState().refreshUnread('owner-a'), store.getState().refreshUnread('owner-a'),
    store.getState().loadPreferences('owner-a'), store.getState().loadPreferences('owner-a')];
  assert.equal(countCalls, 1);
  assert.equal(preferenceCalls, 1);
  const expected = notificationPreferencesFixture();
  count.resolve({ count: 8 });
  preferences.resolve(expected);
  const results = await Promise.all(jobs);
  assert.equal(store.getState().unread, 8);
  assert.equal(store.getState().preferences, expected);
  assert.equal(results[2], expected);
  assert.equal(results[3], expected);
  await store.getState().refreshUnread('foreign-owner');
  assert.equal(await store.getState().loadPreferences('foreign-owner'), undefined);
  assert.equal(countCalls, 1);
  assert.equal(preferenceCalls, 1);
});

for (const sameOwner of [false, true]) {
  for (const fail of [false, true]) {
    test(`notification store isolates stale ${fail ? 'errors' : 'responses'} across ${sameOwner ? 'same-owner re-login' : 'owner changes'}`, async () => {
      const oldCount = deferred();
      const oldPreferences = deferred();
      let countCalls = 0;
      let preferenceCalls = 0;
      const fresh = notificationPreferencesFixture({ email_enabled: false });
      const store = loadNotificationStore({
        notificationUnreadCount: async () => {
          if (++countCalls > 1) return { count: 3 };
          await oldCount.promise;
          if (fail) throw new Error('Old count failed');
          return { count: 99 };
        },
        notificationPreferences: async () => {
          if (++preferenceCalls > 1) return fresh;
          await oldPreferences.promise;
          if (fail) throw new Error('Old preferences failed');
          return notificationPreferencesFixture({ push_enabled: true });
        },
      });
      store.getState().setOwner('owner-a');
      const epoch = store.getState().epoch;
      const staleCount = store.getState().refreshUnread('owner-a');
      const stalePreferences = store.getState().loadPreferences('owner-a');
      store.getState().setOwner(undefined);
      const owner = sameOwner ? 'owner-a' : 'owner-b';
      store.getState().setOwner(owner);
      assert.ok(store.getState().epoch > epoch);
      await Promise.all([store.getState().refreshUnread(owner), store.getState().loadPreferences(owner)]);
      oldCount.resolve();
      oldPreferences.resolve();
      await staleCount;
      assert.equal(await stalePreferences, undefined);
      assert.equal(store.getState().owner, owner);
      assert.equal(store.getState().unread, 3);
      assert.equal(store.getState().preferences, fresh);
      assert.equal(store.getState().countError, undefined);
      assert.equal(store.getState().preferencesError, undefined);
      assert.equal(countCalls, 2);
      assert.equal(preferenceCalls, 2);
    });
  }
}

test('notification store retries failed loads, clamps negative unread and clears previous errors', async () => {
  let countCalls = 0;
  let preferenceCalls = 0;
  const store = loadNotificationStore({
    notificationUnreadCount: async () => { if (++countCalls === 1) throw new Error('offline'); return { count: -5 }; },
    notificationPreferences: async () => { if (++preferenceCalls === 1) throw new Error('offline'); return notificationPreferencesFixture(); },
  });
  store.getState().setOwner('owner-a');
  await Promise.all([store.getState().refreshUnread('owner-a'), store.getState().loadPreferences('owner-a')]);
  assert.match(store.getState().countError, /Unread count unavailable/);
  assert.match(store.getState().preferencesError, /Could not load notification preferences/);
  await Promise.all([store.getState().refreshUnread('owner-a'), store.getState().loadPreferences('owner-a')]);
  assert.equal(store.getState().unread, 0);
  assert.equal(store.getState().countError, undefined);
  assert.equal(store.getState().preferencesError, undefined);
  assert.equal(countCalls, 2);
  assert.equal(preferenceCalls, 2);
});

for (const busy of [false, true]) {
  test(`notification preference ${busy ? 'busy mutation' : 'explicit update'} invalidates an older load`, async () => {
    const gate = deferred();
    let calls = 0;
    const store = loadNotificationStore({ notificationPreferences: () => { calls += 1; return gate.promise; } });
    store.getState().setOwner('owner-a');
    const stale = store.getState().loadPreferences('owner-a');
    const expected = notificationPreferencesFixture({ push_enabled: true });
    if (busy) {
      store.getState().setPreferencesBusy('owner-a', true);
      assert.equal(await store.getState().loadPreferences('owner-a'), undefined);
      assert.equal(calls, 1);
    }
    store.getState().setPreferences('owner-a', expected);
    gate.resolve(notificationPreferencesFixture());
    assert.equal(await stale, undefined);
    assert.equal(store.getState().preferences, expected);
    store.getState().setPreferencesBusy('owner-a', false);
    assert.equal(store.getState().preferencesBusy, false);
  });
}

test('notification owner reset clears private state and foreign setters cannot affect it', () => {
  const store = loadNotificationStore();
  store.getState().setOwner('owner-a');
  store.setState({ unread: 6, countError: 'old', preferencesError: 'old' });
  store.getState().setPreferences('owner-a', notificationPreferencesFixture());
  store.getState().setPreferencesBusy('owner-a', true);
  store.getState().setPushMessage('owner-a', 'registered');
  const before = store.getState();
  store.getState().setOwner('owner-a');
  store.getState().setPreferences('owner-b', notificationPreferencesFixture({ push_enabled: true }));
  store.getState().setPreferencesBusy('owner-b', false);
  store.getState().setPushMessage('owner-b', 'foreign');
  assert.equal(store.getState(), before);
  store.getState().setOwner(undefined);
  assert.deepEqual(plain(store.getState()), { epoch: before.epoch + 1, unread: 0, preferencesBusy: false });
});

for (const hasRefresh of [false, true]) {
  test(`signOut awaits notification cleanup before ${hasRefresh ? 'logout and' : ''} token clear and ignores duplicate logout`, async () => {
    const gate = deferred();
    const { store, events, refreshSession } = loadSessionWithNotificationCleanup(() => gate.promise);
    if (!hasRefresh) store.setState({ refresh: undefined });
    const first = store.getState().signOut();
    assert.deepEqual(events, ['cleanup-start']);
    assert.equal(store.getState().authPending, true);
    assert.equal(store.getState().user.id, 'owner-a');
    assert.ok(store.getState().access !== undefined);
    await store.getState().signOut();
    assert.equal(await refreshSession(), false);
    assert.deepEqual(events, ['cleanup-start']);
    gate.resolve();
    await first;
    assert.deepEqual(events, ['cleanup-start', 'cleanup-end', ...(hasRefresh ? ['logout'] : []), 'clear-token']);
    assert.equal(store.getState().user, undefined);
    assert.equal(store.getState().access, undefined);
    assert.equal(store.getState().refresh, undefined);
    assert.equal(store.getState().authPending, false);
  });
}

for (const channel of ['PHONE', 'EMAIL']) {
  test(`new ${channel} login awaits notification cleanup before discarding the previous session`, async () => {
    const gate = deferred();
    const { store, events } = loadSessionWithNotificationCleanup(() => gate.promise);
    const contact = channel === 'PHONE' ? '+21622123456' : 'user@example.tn';
    const job = store.getState().requestLoginCode(contact, channel);
    await new Promise(setImmediate);
    assert.deepEqual(events, [channel === 'PHONE' ? 'request-phone' : 'request-email', 'cleanup-start']);
    assert.ok(store.getState().access !== undefined);
    assert.equal(store.getState().user.id, 'owner-a');
    gate.resolve();
    assert.equal(await job, true);
    assert.equal(events.at(-2), 'cleanup-end');
    assert.equal(events.at(-1), 'clear-token');
    assert.equal(store.getState().user, undefined);
    assert.deepEqual(plain(store.getState().pendingContact), { channel, contact });
  });
}

test('signOut still clears local auth and releases the duplicate guard if notification cleanup rejects', async () => {
  const { store, events } = loadSessionWithNotificationCleanup(async () => { throw new Error('cleanup failed'); });
  await assert.rejects(store.getState().signOut(), /cleanup failed/);
  assert.deepEqual(events, ['cleanup-start', 'logout', 'clear-token']);
  assert.equal(store.getState().access, undefined);
  assert.equal(store.getState().authPending, false);
  store.setState({ user: { id: 'owner-a' } });
  await assert.rejects(store.getState().signOut(), /cleanup failed/);
  assert.equal(events.filter((event) => event === 'cleanup-start').length, 2);
});

test('notification polling runs only while active and disposal removes its timer and AppState listener', async () => {
  const harness = notificationHarness({ appState: 'background' });
  const stop = harness.activate();
  await new Promise(setImmediate);
  const countCalls = () => harness.calls.requests.filter(({ path }) => path.endsWith('/unread-count/')).length;
  assert.equal(countCalls(), 0);
  assert.equal(harness.intervals.size, 1);
  const poll = [...harness.intervals.values()][0];
  assert.equal(poll.delay, 60000);
  poll.callback();
  harness.changeAppState('inactive');
  assert.equal(countCalls(), 0);
  harness.changeAppState('active');
  await new Promise(setImmediate);
  assert.equal(countCalls(), 1);
  poll.callback();
  await new Promise(setImmediate);
  assert.equal(countCalls(), 2);
  harness.changeAppState('background');
  poll.callback();
  assert.equal(countCalls(), 2);
  stop();
  assert.equal(harness.intervals.size, 0);
  assert.equal(harness.appListeners[0].removed, true);
  assert.equal(harness.store.getState().owner, undefined);
  harness.changeAppState('active');
  poll.callback();
  assert.equal(countCalls(), 2);
});

test('an old notification disposer cannot reset or poll for a newer owner', async () => {
  const harness = notificationHarness();
  const stopOld = harness.activate('owner-a');
  const oldPoll = [...harness.intervals.values()][0].callback;
  const stopNew = harness.activate('owner-b');
  await new Promise(setImmediate);
  stopOld();
  assert.equal(harness.store.getState().owner, 'owner-b');
  assert.equal(harness.intervals.size, 1);
  const before = harness.calls.requests.length;
  oldPoll();
  assert.equal(harness.calls.requests.length, before);
  stopNew();
  assert.equal(harness.store.getState().owner, undefined);
  assert.ok(harness.appListeners.every((listener) => listener.removed));
});

test('late preferences after notification cleanup cannot trigger passive native registration', async () => {
  const gate = deferred();
  const harness = notificationHarness({ platform: 'ios', request: async (path) => {
    if (path.endsWith('/preferences/')) return gate.promise;
    return { count: 0 };
  } });
  const stop = harness.activate();
  await harness.lib.cleanupNotificationSession('owner-a');
  gate.resolve(notificationPreferencesFixture({ push_enabled: true }));
  await new Promise(setImmediate);
  assert.deepEqual(harness.calls.imports, []);
  assert.equal(harness.store.getState().preferences, undefined);
  assert.equal(harness.store.getState().owner, undefined);
  stop();
});

test('passive physical-device registration never prompts and explicit retry is the only permission request', async () => {
  const preferences = notificationPreferencesFixture({ push_enabled: true });
  const harness = notificationHarness({ platform: 'android', preferences });
  const stop = harness.activate();
  await new Promise(setImmediate);
  assert.match(harness.store.getState().pushMessage, /permission is not granted/);
  assert.equal(harness.calls.permissionReads, 1);
  assert.equal(harness.calls.permissionPrompts, 0);
  assert.equal(harness.calls.channels.length, 0);
  assert.equal(harness.calls.expoRequests.length, 0);
  await harness.lib.ensurePushRegistration('owner-a', preferences, true);
  assert.equal(harness.calls.permissionPrompts, 1);
  assert.equal(harness.calls.expoRequests.length, 1);
  assert.deepEqual(plain(harness.calls.channels), [['default', { name: 'Trip updates', importance: 3 }]]);
  await harness.lib.cleanupNotificationSession('owner-a');
  stop();
});

for (const [platform, capabilities, projectId, provider] of [
  ['ios', { expo: true, fcm: true }, 'regression-project', 'EXPO'],
  ['android', { expo: true, fcm: true }, 'regression-project', 'EXPO'],
  ['android', { expo: false, fcm: true }, null, 'FCM'],
]) {
  test(`physical ${platform} opt-in selects ${provider}, persists association and unregisters on cleanup`, async () => {
    const preferences = notificationPreferencesFixture({ capabilities });
    const harness = notificationHarness({ platform, projectId, preferences });
    const stop = harness.activate();
    await new Promise(setImmediate);
    await harness.lib.ensurePushRegistration('owner-a', preferences, true);
    assert.deepEqual(harness.calls.imports, ['expo-device', 'expo-notifications']);
    assert.equal(harness.calls.permissionPrompts, 1);
    assert.equal(harness.calls.expoRequests.length, provider === 'EXPO' ? 1 : 0);
    assert.equal(harness.calls.nativeRequests, provider === 'FCM' ? 1 : 0);
    if (provider === 'EXPO') assert.deepEqual(plain(harness.calls.expoRequests), [{ projectId }]);
    const requests = harness.calls.requests.filter(({ path }) => path.endsWith('/devices/'));
    assert.equal(requests.length, 1);
    assert.equal(requests[0].options.method, 'POST');
    assert.equal(requests[0].options.body.platform, platform.toUpperCase());
    assert.equal(requests[0].options.body.provider, provider);
    assert.equal(requests[0].options.timeoutMs, 1500);
    assert.equal(requests[0].options._retried, true);
    const saved = JSON.parse(harness.storage.get(notificationDeviceKey));
    assert.equal(saved.owner, 'owner-a');
    assert.ok(saved.token === requests[0].options.body.token, 'Saved association must match the registered identity');
    assert.equal(harness.receivedListeners.length, 1);
    assert.equal(harness.responseListeners.length, 1);
    await new Promise(setImmediate);
    const unreadBefore = harness.calls.requests.filter(({ path }) => path.endsWith('/unread-count/')).length;
    harness.receivedListeners[0].callback();
    await new Promise(setImmediate);
    assert.equal(harness.calls.requests.filter(({ path }) => path.endsWith('/unread-count/')).length, unreadBefore + 1);
    const beforeBanner = harness.calls.requests.length;
    assert.deepEqual(plain(await harness.calls.handlers.at(-1).handleNotification()), {
      shouldShowBanner: false, shouldShowList: false, shouldPlaySound: false, shouldSetBadge: false,
    });
    assert.equal(harness.calls.requests.length, beforeBanner);
    const cleanup = harness.lib.cleanupNotificationSession('owner-a');
    assert.equal(harness.store.getState().owner, undefined);
    assert.equal(harness.store.getState().unread, 0);
    assert.equal(harness.receivedListeners[0].removed, true);
    assert.equal(harness.responseListeners[0].removed, true);
    await cleanup;
    const deletion = harness.calls.requests.filter(({ options }) => options.method === 'DELETE');
    assert.equal(deletion.length, 1);
    assert.ok(deletion[0].options.body.token === saved.token, 'Cleanup must unregister the saved identity');
    assert.equal(harness.storage.has(notificationDeviceKey), false);
    assert.equal(harness.timers.size, 0);
    const beforeStaleListener = harness.calls.requests.length;
    harness.receivedListeners[0].callback();
    assert.equal(harness.calls.requests.length, beforeStaleListener);
    stop();
    assert.equal(harness.intervals.size, 0);
  });
}

test('provisional iOS permission supports passive Expo registration without prompting', async () => {
  const preferences = notificationPreferencesFixture({ push_enabled: true });
  const harness = notificationHarness({ platform: 'ios', preferences, permission: { granted: false, ios: { status: 3 } } });
  const stop = harness.activate();
  await new Promise(setImmediate);
  assert.equal(harness.calls.permissionPrompts, 0);
  assert.equal(harness.calls.expoRequests.length, 1);
  assert.match(harness.store.getState().pushMessage, /registered/);
  stop();
  assert.ok(harness.receivedListeners.every((listener) => listener.removed));
  assert.ok(harness.responseListeners.every((listener) => listener.removed));
  await harness.lib.cleanupNotificationSession('owner-a');
});

test('simulator opt-in rejects before loading notifications or requesting permission', async () => {
  const harness = notificationHarness({ platform: 'ios', isDevice: false });
  const stop = harness.activate();
  await assert.rejects(harness.lib.ensurePushRegistration('owner-a', notificationPreferencesFixture(), true), /physical device/);
  assert.deepEqual(harness.calls.imports, ['expo-device']);
  assert.equal(harness.calls.permissionPrompts, 0);
  assert.equal(harness.calls.requests.some(({ path }) => path.endsWith('/devices/')), false);
  stop();
});

test('denied native opt-in never obtains a token, persists a device or posts registration', async () => {
  const harness = notificationHarness({ platform: 'android', promptPermission: { granted: false } });
  const stop = harness.activate();
  await assert.rejects(harness.lib.ensurePushRegistration('owner-a', notificationPreferencesFixture(), true), /permission is not granted/);
  assert.equal(harness.calls.permissionPrompts, 1);
  assert.equal(harness.calls.expoRequests.length, 0);
  assert.equal(harness.calls.nativeRequests, 0);
  assert.equal(harness.storage.size, 0);
  assert.equal(harness.calls.requests.some(({ path }) => path.endsWith('/devices/')), false);
  stop();
});

test('concurrent native opt-ins share one permission prompt and registration', async () => {
  const gate = deferred();
  const harness = notificationHarness({ platform: 'ios', native: { requestPermissionsAsync: () => gate.promise } });
  const stop = harness.activate();
  const first = harness.lib.ensurePushRegistration('owner-a', notificationPreferencesFixture(), true);
  const second = harness.lib.ensurePushRegistration('owner-a', notificationPreferencesFixture(), true);
  await new Promise(setImmediate);
  gate.resolve({ granted: true });
  await Promise.all([first, second]);
  assert.equal(harness.calls.permissionReads, 1);
  assert.equal(harness.calls.expoRequests.length, 1);
  assert.equal(harness.calls.requests.filter(({ options }) => options.method === 'POST').length, 1);
  assert.equal(harness.receivedListeners.length, 1);
  await harness.lib.cleanupNotificationSession('owner-a');
  stop();
});

test('a persisted foreign device association cannot be registered or deleted by another owner', async () => {
  const harness = notificationHarness({ platform: 'ios', permission: { granted: true }, savedDevice: {
    owner: 'foreign-owner', token: 'regression-foreign-fixture', platform: 'IOS', provider: 'EXPO',
  } });
  const stop = harness.activate();
  await assert.rejects(harness.lib.ensurePushRegistration('owner-a', notificationPreferencesFixture(), false), /linked to another account/);
  assert.equal(harness.calls.expoRequests.length, 0);
  await harness.lib.cleanupNotificationSession('owner-a');
  assert.equal(harness.calls.requests.some(({ path }) => path.endsWith('/devices/')), false);
  assert.equal(harness.storage.has(notificationDeviceKey), true);
  stop();
});

test('native token rotation unregisters the previous association before posting its replacement', async () => {
  const harness = notificationHarness({ platform: 'ios', permission: { granted: true }, savedDevice: {
    owner: 'owner-a', token: 'ExpoPushToken[previous_fixture]', platform: 'IOS', provider: 'EXPO',
  } });
  const stop = harness.activate();
  await harness.lib.ensurePushRegistration('owner-a', notificationPreferencesFixture(), false);
  const requests = harness.calls.requests.filter(({ path }) => path.endsWith('/devices/'));
  assert.deepEqual(requests.map(({ options }) => options.method), ['DELETE', 'POST']);
  assert.ok(requests[0].options.body.token !== requests[1].options.body.token, 'Rotation must replace the old identity');
  await harness.lib.cleanupNotificationSession('owner-a');
  stop();
});

for (const failPost of [false, true]) {
  test(`notification cleanup awaits an in-flight ${failPost ? 'failed' : 'successful'} device POST before DELETE`, async () => {
    const gate = deferred();
    const harness = notificationHarness({ platform: 'ios', permission: { granted: true }, request: async (path, options) => {
      if (options.method === 'POST') {
        await gate.promise;
        if (failPost) throw new Error('Registration timed out');
      }
      if (path.endsWith('/preferences/')) return notificationPreferencesFixture();
      return { count: 0 };
    } });
    const stop = harness.activate();
    const registration = harness.lib.ensurePushRegistration('owner-a', notificationPreferencesFixture(), false);
    const failedRegistration = assert.rejects(registration, failPost ? /Registration timed out/ : /Session changed/);
    await new Promise(setImmediate);
    assert.equal(harness.storage.has(notificationDeviceKey), true);
    const cleanup = harness.lib.cleanupNotificationSession('owner-a');
    assert.equal(harness.store.getState().owner, undefined);
    await new Promise(setImmediate);
    assert.equal(harness.calls.requests.filter(({ options }) => options.method === 'DELETE').length, 0);
    gate.resolve();
    await Promise.all([cleanup, failedRegistration]);
    assert.deepEqual(harness.calls.requests.filter(({ path }) => path.endsWith('/devices/')).map(({ options }) => options.method), ['POST', 'DELETE']);
    assert.equal(harness.storage.has(notificationDeviceKey), false);
    assert.equal(harness.receivedListeners.length, 0);
    assert.equal(harness.timers.size, 0);
    stop();
  });
}

test('notification cleanup is bounded if unregister never responds and retains the retry association', async () => {
  const gate = deferred();
  const harness = notificationHarness({ platform: 'ios', savedDevice: {
    owner: 'owner-a', token: 'regression-cleanup-fixture', platform: 'IOS', provider: 'EXPO',
  }, request: async (path, options) => {
    if (options.method === 'DELETE') return gate.promise;
    if (path.endsWith('/preferences/')) return notificationPreferencesFixture();
    return { count: 0 };
  } });
  const stop = harness.activate();
  const cleanup = harness.lib.cleanupNotificationSession('owner-a');
  await new Promise(setImmediate);
  assert.equal(harness.calls.requests.filter(({ options }) => options.method === 'DELETE').length, 1);
  assert.equal(harness.timers.size, 1);
  const timeout = [...harness.timers.values()][0];
  assert.equal(timeout.delay, 3500);
  timeout.callback();
  await cleanup;
  assert.equal(harness.storage.has(notificationDeviceKey), true);
  assert.equal(harness.timers.size, 0);
  gate.resolve();
  await new Promise(setImmediate);
  assert.equal(harness.storage.has(notificationDeviceKey), false);
  stop();
});

function nativeNotificationTap(id = notificationUuid, identifier = 'regression-tap') {
  return { notification: { request: { identifier, content: { data: {
    notification_id: id, kind: 'ride.published', ride_id: notificationUuid, url: 'https://foreign.example.test',
  } } } } };
}

test('native taps navigate only from the owned inbox item, deduplicate taps and never trust push routes', async () => {
  const harness = notificationHarness({ platform: 'ios', permission: { granted: true }, request: async (path) => {
    if (path.startsWith('/api/v1/notifications/?')) return {
      results: [{ id: notificationUuid, kind: 'booking.created', payload: { booking_id: notificationUuid } }], next: null,
    };
    if (path.endsWith('/preferences/')) return notificationPreferencesFixture();
    return { count: 0 };
  } });
  const stop = harness.activate();
  await harness.lib.ensurePushRegistration('owner-a', notificationPreferencesFixture(), false);
  await new Promise(setImmediate);
  const tap = nativeNotificationTap();
  harness.responseListeners[0].callback(tap);
  harness.responseListeners[0].callback(tap);
  await new Promise(setImmediate);
  assert.deepEqual(plain(harness.calls.routes), [{ pathname: '/booking/[id]', params: { id: notificationUuid } }]);
  assert.equal(harness.calls.requests.filter(({ path }) => path.startsWith('/api/v1/notifications/?')).length, 1);
  await harness.lib.cleanupNotificationSession('owner-a');
  stop();
});

test('foreign native taps search at most three local inbox pages and fall back to the inbox', async () => {
  const harness = notificationHarness({ platform: 'android', permission: { granted: true }, request: async (path) => {
    if (path.startsWith('/api/v1/notifications/?')) return { results: [], next: 'https://foreign.example.test/page/999' };
    if (path.endsWith('/preferences/')) return notificationPreferencesFixture();
    return { count: 0 };
  } });
  const stop = harness.activate();
  await harness.lib.ensurePushRegistration('owner-a', notificationPreferencesFixture(), false);
  await new Promise(setImmediate);
  harness.responseListeners[0].callback(nativeNotificationTap());
  await new Promise(setImmediate);
  assert.deepEqual(harness.calls.requests.filter(({ path }) => path.startsWith('/api/v1/notifications/?')).map(({ path }) => path), [
    '/api/v1/notifications/?page=1', '/api/v1/notifications/?page=2', '/api/v1/notifications/?page=3',
  ]);
  assert.deepEqual(harness.calls.routes, ['/notifications']);
  assert.equal(harness.calls.requests.some(({ path }) => path.startsWith('http')), false);
  harness.responseListeners[0].callback(nativeNotificationTap('malformed', 'second-tap'));
  await new Promise(setImmediate);
  assert.equal(harness.calls.requests.filter(({ path }) => path.startsWith('/api/v1/notifications/?')).length, 3);
  assert.deepEqual(harness.calls.routes, ['/notifications', '/notifications']);
  await harness.lib.cleanupNotificationSession('owner-a');
  stop();
});

test('an in-flight native tap cannot navigate after cleanup and same-owner re-login', async () => {
  const gate = deferred();
  const harness = notificationHarness({ platform: 'ios', permission: { granted: true }, request: async (path) => {
    if (path.startsWith('/api/v1/notifications/?')) return gate.promise;
    if (path.endsWith('/preferences/')) return notificationPreferencesFixture();
    return { count: 0 };
  } });
  const stopOld = harness.activate();
  await harness.lib.ensurePushRegistration('owner-a', notificationPreferencesFixture(), false);
  await new Promise(setImmediate);
  harness.responseListeners[0].callback(nativeNotificationTap());
  await new Promise(setImmediate);
  await harness.lib.cleanupNotificationSession('owner-a');
  const stopNew = harness.activate();
  gate.resolve({ results: [{ id: notificationUuid, kind: 'ride.published', payload: { ride_id: notificationUuid } }], next: null });
  await new Promise(setImmediate);
  assert.deepEqual(harness.calls.routes, []);
  assert.equal(harness.responseListeners[0].removed, true);
  stopOld();
  assert.equal(harness.store.getState().owner, 'owner-a');
  stopNew();
});
