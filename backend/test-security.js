import assert from 'assert';
import Redis from 'ioredis';

const BASE_URL = 'http://localhost:5000/api/share';

const logTest = (name, result) => {
  console.log(`[TEST] ${name}: ${result ? 'PASSED ✅' : 'FAILED ❌'}`);
};

const runTests = async () => {
  console.log('Starting Security Verification Tests...\n');

  // Clear existing rate limiters in Redis for a clean test run
  try {
    const redis = new Redis({
      host: process.env.REDIS_HOST || '127.0.0.1',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      password: process.env.REDIS_PASSWORD || undefined
    });
    const keys = await redis.keys('ratelimit:*');
    if (keys.length > 0) {
      await redis.del(keys); // del accepts array in ioredis
      console.log(`Cleared ${keys.length} rate limit keys from Redis.`);
    }
    await redis.quit();
  } catch (redisErr) {
    console.warn('Warning: Could not clear Redis rate limit keys:', redisErr.message);
  }

  // Test 1: Alphanumeric PIN Generation
  try {
    const res = await fetch(`${BASE_URL}/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'text',
        content: 'Verification test payload'
      })
    });
    
    const data = await res.json();
    assert.strictEqual(res.status, 201, `Expected 201 status, got ${res.status}`);
    assert.ok(data.success, 'Expected upload success');
    assert.strictEqual(data.pin.length, 5, 'PIN should be 5 characters long');
    
    // Check if the PIN is alphanumeric and contains letters (so it's not just a 5-digit number)
    const isAlphanumeric = /^[A-Z2-9]{5}$/.test(data.pin);
    const hasLetters = /[A-Z]/.test(data.pin);
    
    assert.ok(isAlphanumeric, `PIN ${data.pin} should match alphanumeric pattern [A-Z2-9]`);
    assert.ok(hasLetters, `PIN ${data.pin} should contain letters to prove it is not purely numeric`);
    
    logTest('Alphanumeric PIN Generation', true);
  } catch (err) {
    logTest('Alphanumeric PIN Generation', false);
    console.error(err.message);
  }

  // Test 2: Malicious Link Rejection (XSS Prevention)
  try {
    const res = await fetch(`${BASE_URL}/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'link',
        url: 'javascript:alert(1)'
      })
    });
    
    const data = await res.json();
    assert.strictEqual(res.status, 400, `Expected 400 status for javascript link, got ${res.status}`);
    assert.strictEqual(data.success, false, 'Expected success=false');
    assert.ok(data.message.includes('protocol') || data.message.includes('Invalid URL'), `Expected validation error message, got: "${data.message}"`);
    
    logTest('Malicious Link Rejection (XSS Prevention)', true);
  } catch (err) {
    logTest('Malicious Link Rejection (XSS Prevention)', false);
    console.error(err.message);
  }

  // Test 3: Safe Link Acceptance
  try {
    const res = await fetch(`${BASE_URL}/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'link',
        url: 'https://github.com'
      })
    });
    
    const data = await res.json();
    assert.strictEqual(res.status, 201, `Expected 201 status for safe URL, got ${res.status}`);
    assert.ok(data.success, 'Expected success=true');
    
    logTest('Safe Link Acceptance', true);
  } catch (err) {
    logTest('Safe Link Acceptance', false);
    console.error(err.message);
  }

  // Test 4: Download Verification Requires PIN
  try {
    // We try to request download with a random UUID
    const randomFileId = 'a0000000-0000-0000-0000-000000000000';
    const res = await fetch(`${BASE_URL}/download/${randomFileId}`);
    
    assert.strictEqual(res.status, 400, `Expected 400 when requesting download without PIN, got ${res.status}`);
    const text = await res.text();
    assert.ok(text.includes('PIN is required'), `Expected error message about PIN, got: "${text}"`);
    
    logTest('Download Requires PIN Verification', true);
  } catch (err) {
    logTest('Download Requires PIN Verification', false);
    console.error(err.message);
  }

  // Test 5: Retrieval PIN Rate Limiter
  try {
    // Attempt to verify an invalid PIN multiple times (limit is 5 attempts per minute)
    let reachedRateLimit = false;
    for (let i = 0; i < 7; i++) {
      const res = await fetch(`${BASE_URL}/retrieve/12345`);
      if (res.status === 429) {
        reachedRateLimit = true;
        break;
      }
    }
    
    assert.ok(reachedRateLimit, 'Expected rate limiter (429) to trigger on retrieval endpoint');
    logTest('Retrieval Rate Limiter', true);
  } catch (err) {
    logTest('Retrieval Rate Limiter', false);
    console.error(err.message);
  }

  // Test 6: Upload Rate Limiter
  try {
    // Attempt to upload repeatedly (limit is 10 uploads per 1 minute)
    let reachedUploadRateLimit = false;
    for (let i = 0; i < 15; i++) {
      const res = await fetch(`${BASE_URL}/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'text',
          content: `Bulk upload test #${i}`
        })
      });
      if (res.status === 429) {
        reachedUploadRateLimit = true;
        break;
      }
    }
    
    assert.ok(reachedUploadRateLimit, 'Expected rate limiter (429) to trigger on upload endpoint after 10 requests');
    logTest('Upload Rate Limiter', true);
  } catch (err) {
    logTest('Upload Rate Limiter', false);
    console.error(err.message);
  }
};

runTests();
