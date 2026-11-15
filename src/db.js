/**
 * Database connection & management module for SQL Server
 */
const sql = require('mssql');
require('dotenv').config();

const config = {
  user: process.env.DB_USER || 'sa',
  password: process.env.DB_PASSWORD || 'YourStrong@Passw0rd',
  server: process.env.DB_SERVER || 'localhost',
  database: process.env.DB_DATABASE || 'TonaireCommerce',
  port: parseInt(process.env.DB_PORT || '54602', 10),
  options: {
    encrypt: process.env.DB_ENCRYPT === 'true',
    trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE !== 'false'
  },
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000
  }
};

let pool = null;
let isConnected = false;

// In-Memory fallback store if SQL Server is not reachable
let inMemoryProducts = [
  {
    ProductId: 1,
    SKU: 'TSHIRT-BLK-01',
    Name: 'Classic Black T-Shirt',
    Description: 'Premium cotton t-shirt',
    CategoryId: 1,
    Price: 24.99,
    Currency: 'USD',
    IsActive: true,
    RowVersion: Buffer.from([0, 0, 0, 0, 0, 0, 0, 1]),
    UpdatedAt: new Date()
  },
  {
    ProductId: 2,
    SKU: 'JEANS-BLU-02',
    Name: 'Slim Fit Blue Jeans',
    Description: 'Comfortable denim jeans',
    CategoryId: 1,
    Price: 49.99,
    Currency: 'USD',
    IsActive: true,
    RowVersion: Buffer.from([0, 0, 0, 0, 0, 0, 0, 2]),
    UpdatedAt: new Date()
  },
  {
    ProductId: 3,
    SKU: 'SHOES-RUN-03',
    Name: 'Pro Running Shoes',
    Description: 'Lightweight athletic sneakers',
    CategoryId: 2,
    Price: 89.99,
    Currency: 'USD',
    IsActive: true,
    RowVersion: Buffer.from([0, 0, 0, 0, 0, 0, 0, 3]),
    UpdatedAt: new Date()
  }
];
let inMemoryAudit = [];

async function connectDB() {
  try {
    console.log(`Connecting to Microsoft SQL Server on [${config.server}:${config.port}]...`);
    pool = await sql.connect(config);
    isConnected = true;
    console.log(`\n======================================================`);
    console.log(`[SQL Server] Connected successfully to database: ${config.database}!`);
    console.log(`   Connected to live Microsoft SQL Server instance!`);
    console.log(`======================================================\n`);
    return pool;
  } catch (err) {
    console.warn(`\n======================================================`);
    console.warn(`[SQL Server Notice] Could not connect to SQL Server at [${config.server}:${config.port}]`);
    console.warn(`Reason: ${err.message}`);
    console.warn(`Running in In-Memory Simulation Mode so API & Flutter apps work immediately!`);
    console.warn(`======================================================\n`);
    isConnected = false;
    return null;
  }
}

function getPool() {
  return pool;
}

function isDbConnected() {
  return isConnected;
}

module.exports = {
  config,
  connectDB,
  getPool,
  isDbConnected,
  inMemoryProducts,
  inMemoryAudit
};
