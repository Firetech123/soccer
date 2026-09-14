const assert = require('assert');

// Simulate filterExpired functionality
const RETENTION_MS = 24 * 60 * 60 * 1000;

function filterExpired(data) {
  if (!data) return data;
  let parsed = data;
  if (typeof data === 'string') {
    try {
      parsed = JSON.parse(data);
    } catch {
      return data;
    }
  }
  if (Array.isArray(parsed)) {
    const now = Date.now();
    const filtered = parsed.filter((item) => {
      if (!item) return false;
      let time = item.timestamp ? new Date(item.timestamp).getTime() : null;
      if (!time && item.id && !isNaN(Number(item.id.slice(0, 13)))) {
        time = Number(item.id.slice(0, 13));
      }
      if (!time) return true;
      return now - time < RETENTION_MS;
    });
    return typeof data === 'string' ? JSON.stringify(filtered) : filtered;
  }
  return data;
}

function runTests() {
  const now = Date.now();
  const TWENTY_THREE_HOURS_AGO = new Date(now - 23 * 60 * 60 * 1000).toISOString();
  const TWENTY_FIVE_HOURS_AGO = new Date(now - 25 * 60 * 60 * 1000).toISOString();

  const testMessages = [
    { id: '1', sender: 'User1', text: 'Recent message', timestamp: TWENTY_THREE_HOURS_AGO },
    { id: '2', sender: 'User2', text: 'Old message', timestamp: TWENTY_FIVE_HOURS_AGO },
    { id: '3', sender: 'User3', text: 'Fresh message', timestamp: new Date(now).toISOString() }
  ];

  const filtered = filterExpired(testMessages);
  assert.strictEqual(filtered.length, 2, 'Should keep only messages under 24 hours old');
  assert.strictEqual(filtered[0].id, '1');
  assert.strictEqual(filtered[1].id, '3');

  // Test string input
  const jsonString = JSON.stringify(testMessages);
  const filteredString = filterExpired(jsonString);
  const parsedString = JSON.parse(filteredString);
  assert.strictEqual(parsedString.length, 2, 'Should work correctly with JSON string inputs');

  console.log('All 24-hour expiration tests passed successfully!');
}

runTests();
