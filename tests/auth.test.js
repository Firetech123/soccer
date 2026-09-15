const assert = require('assert');
const http = require('http');
const { app } = require('../server/index');

let testServer;

function makeRequest(path, method = 'GET', body = null, token = null) {
  return new Promise((resolve, reject) => {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const req = http.request(
      {
        hostname: 'localhost',
        port: 3005,
        path,
        method,
        headers
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode, body: data });
          }
        });
      }
    );
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runTests() {
  testServer = app.listen(3005, async () => {
    try {
      // 1. Signup User 1
      const signup1 = await makeRequest('/api/auth/signup', 'POST', {
        username: 'alice',
        displayName: 'Alice Smith',
        password: 'password123',
        bio: 'Hello world'
      });
      assert.strictEqual(signup1.status, 200);
      assert.ok(signup1.body.token);
      assert.strictEqual(signup1.body.user.username, 'alice');
      const token1 = signup1.body.token;

      // 2. Signup User 2
      const signup2 = await makeRequest('/api/auth/signup', 'POST', {
        username: 'bob',
        displayName: 'Bob Jones',
        password: 'password456',
        bio: 'Bob bio'
      });
      assert.strictEqual(signup2.status, 200);
      const token2 = signup2.body.token;

      // 3. Login User 1
      const login1 = await makeRequest('/api/auth/login', 'POST', {
        username: 'alice',
        password: 'password123'
      });
      assert.strictEqual(login1.status, 200);
      assert.strictEqual(login1.body.user.username, 'alice');

      // 4. Get Current User Profile
      const me = await makeRequest('/api/users/me', 'GET', null, token1);
      assert.strictEqual(me.status, 200);
      assert.strictEqual(me.body.displayName, 'Alice Smith');

      // 5. Update Profile
      const updateProfile = await makeRequest('/api/users/me', 'PUT', { bio: 'Updated bio!' }, token1);
      assert.strictEqual(updateProfile.status, 200);
      assert.strictEqual(updateProfile.body.bio, 'Updated bio!');

      // 6. Search Users
      const search = await makeRequest('/api/users/search?q=bob', 'GET', null, token1);
      assert.strictEqual(search.status, 200);
      assert.strictEqual(search.body.length, 1);
      assert.strictEqual(search.body[0].username, 'bob');

      // 7. Get Profile of Bob
      const getBob = await makeRequest(`/api/users/bob`, 'GET', null, token1);
      assert.strictEqual(getBob.status, 200);
      assert.strictEqual(getBob.body.displayName, 'Bob Jones');

      console.log('All backend Auth & Profile integration tests passed successfully!');
      testServer.close();
      process.exit(0);
    } catch (err) {
      console.error('Integration test failed:', err);
      if (testServer) testServer.close();
      process.exit(1);
    }
  });
}

runTests();
