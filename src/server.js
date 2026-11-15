/**
 * Express Server Entry Point
 * Usage: npm start
 */
require('dotenv').config();
const app = require('./app');
const { connectDB } = require('./db');

const PORT = process.env.PORT || 3000;

async function startServer() {
  // Connect to Database
  await connectDB();

  app.listen(PORT, () => {
    console.log(`\n======================================================`);
    console.log(`🚀 Tonaire Digital Product API running on:`);
    console.log(`   Local URL:    http://localhost:${PORT}`);
    console.log(`   Catalog API:  http://localhost:${PORT}/api/v1/products`);
    console.log(`======================================================`);
    console.log(`\nTest API with curl:`);
    console.log(`1. Read Products:`);
    console.log(`   curl http://localhost:${PORT}/api/v1/products`);
    console.log(`\n2. Update Price (as Admin):`);
    console.log(`   curl -X PATCH http://localhost:${PORT}/api/v1/products/101/price \\`);
    console.log(`        -H "Content-Type: application/json" \\`);
    console.log(`        -H "Authorization: Bearer admin-token" \\`);
    console.log(`        -d "{\\"price\\": 29.99, \\"reason\\": \\"Seasonal supplier price increase\\"}"\n`);
  });
}

startServer();
