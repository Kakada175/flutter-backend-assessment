/**
 * Automated Backend API Verification Suite
 * Usage: npm run test:api
 */
const http = require('http');
const app = require('./app');
const { connectDB } = require('./db');

function request(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, res => {
      let data = '';
      res.on('data', chunk => (data += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

async function runTests() {
  console.log('\n--- Starting Automated API Verification Suite ---');
  await connectDB();
  const server = app.listen(3099);

  let passed = 0;
  let failed = 0;

  function assert(condition, testName, details = '') {
    if (condition) {
      console.log(`✅ PASS: ${testName}`);
      passed++;
    } else {
      console.error(`❌ FAIL: ${testName} - ${details}`);
      failed++;
    }
  }

  try {
    // Test 1: GET /api/v1/products
    const t1 = await request({ port: 3099, path: '/api/v1/products', method: 'GET' });
    assert(t1.status === 200, 'GET /api/v1/products returns 200 OK', `Status: ${t1.status}`);
    assert(Array.isArray(t1.body.data) && t1.body.data.length > 0, 'Catalog returns non-empty product list');
    const firstProduct = t1.body.data[0];
    assert(
      typeof firstProduct.price === 'number' && typeof firstProduct.unitPrice === 'number',
      'Catalog preserves dual-fields: price AND unitPrice as numbers'
    );
    const initialPrice = firstProduct.price;
    const initialVersion = firstProduct.version;

    // Test 2: PATCH without Authorization token -> 401 Unauthorized
    const t2 = await request(
      {
        port: 3099,
        path: `/api/v1/products/${firstProduct.id}/price`,
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' }
      },
      { price: 35.50, reason: 'Valid reason string' }
    );
    assert(t2.status === 401, 'PATCH without token returns 401 Unauthorized', `Status: ${t2.status}`);

    // Test 3: PATCH with Customer role -> 403 Forbidden
    const t3 = await request(
      {
        port: 3099,
        path: `/api/v1/products/${firstProduct.id}/price`,
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer customer-token'
        }
      },
      { price: 35.50, reason: 'Customer trying to edit' }
    );
    assert(t3.status === 403, 'PATCH with Customer token returns 403 Forbidden', `Status: ${t3.status}`);

    // Test 4: PATCH with invalid price (negative or non-numeric) -> 400 Bad Request
    const t4 = await request(
      {
        port: 3099,
        path: `/api/v1/products/${firstProduct.id}/price`,
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer admin-token'
        }
      },
      { price: -10, reason: 'Negative price test' }
    );
    assert(t4.status === 400, 'PATCH with negative price returns 400 Bad Request', `Status: ${t4.status}`);

    // Test 5: PATCH with Admin token -> 200 OK (Price Updated)
    const newTargetPrice = 29.99;
    const t5 = await request(
      {
        port: 3099,
        path: `/api/v1/products/${firstProduct.id}/price`,
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer admin-token'
        }
      },
      {
        price: newTargetPrice,
        reason: 'Q4 Seasonal price adjustment',
        version: initialVersion
      }
    );
    assert(t5.status === 200, 'PATCH with Admin token updates price (200 OK)', `Status: ${t5.status}`);
    assert(t5.body.data.price === newTargetPrice, 'Response contains updated price value');
    const newVersion = t5.body.data.version;

    // Test 6: Verify updated price appears in GET catalog
    const t6 = await request({ port: 3099, path: '/api/v1/products', method: 'GET' });
    const refreshedProduct = t6.body.data.find(p => p.id === firstProduct.id);
    assert(refreshedProduct.price === newTargetPrice, 'GET catalog reflects the newly updated price');

    // Test 7: Concurrency Conflict -> 409 Conflict when submitting stale version
    const t7 = await request(
      {
        port: 3099,
        path: `/api/v1/products/${firstProduct.id}/price`,
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer admin-token'
        }
      },
      {
        price: 39.99,
        reason: 'Stale update attempt',
        version: initialVersion // Passing outdated version!
      }
    );
    assert(t7.status === 409, 'PATCH with stale version returns 409 Conflict', `Status: ${t7.status}`);

  } catch (err) {
    console.error('Test execution error:', err);
    failed++;
  } finally {
    server.close();
    console.log(`\n--- Verification Summary: ${passed} Passed, ${failed} Failed ---`);
    process.exit(failed > 0 ? 1 : 0);
  }
}

runTests();
