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

// If a named instance is specified (e.g. MSSQLSERVER2022), set instanceName and omit static port
if (process.env.DB_INSTANCE && process.env.DB_INSTANCE.trim().length > 0) {
  config.options.instanceName = process.env.DB_INSTANCE.trim();
} else if (process.env.DB_PORT) {
  config.port = parseInt(process.env.DB_PORT, 10);
}

let pool = null;
let isConnected = false;

// In-Memory fallback store if SQL Server is not yet connected
let inMemoryProducts = [
  {
    ProductId: 101,
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
    ProductId: 102,
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
    ProductId: 103,
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
    const target = config.options.instanceName
      ? `${config.server}\\${config.options.instanceName}`
      : `${config.server}:${config.port || 1433}`;
    console.log(`Connecting to Microsoft SQL Server on [${target}]...`);
    pool = await sql.connect(config);
    isConnected = true;
    console.log(`[SQL Server] Connected successfully to database: ${config.database}`);
    return pool;
  } catch (err) {
    const target = config.options.instanceName
      ? `${config.server}\\${config.options.instanceName}`
      : `${config.server}:${config.port || 1433}`;
    console.warn(`\n======================================================`);
    console.warn(`[SQL Server Notice] Could not connect to SQL Server at [${target}]`);
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
