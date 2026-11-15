/**
 * Assessment: Junior Flutter & Backend Developer - Tonaire Digital Co., Ltd.
 * File: src/app.js
 * Description: Express application setup with CORS, JWT Auth, RBAC, and Product routes.
 */

const express = require('express');
const cors = require('cors');
const { getProducts, updateProductPrice } = require('./productController');
const { isDbConnected } = require('./db');

const app = express();

// Enable CORS for all incoming client origins (Flutter Web / Android / iOS / Desktop)
app.use(cors());
app.use(express.json());

// Simulated Authentication Middleware
function authenticateJWT(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      code: 'UNAUTHORIZED',
      message: 'Missing or invalid Bearer authentication token.'
    });
  }

  const token = authHeader.split(' ')[1];
  if (token === 'admin-token' || token === 'admin-valid-token') {
    req.user = { id: 1, email: 'admin@tonaire.com', roles: ['Admin'] };
    return next();
  } else if (token === 'manager-token' || token === 'manager-valid-token') {
    req.user = { id: 2, email: 'manager@tonaire.com', roles: ['PriceManager'] };
    return next();
  } else if (token === 'customer-token' || token === 'customer-valid-token') {
    req.user = { id: 99, email: 'customer@mobile.com', roles: ['Customer'] };
    return next();
  }

  return res.status(401).json({
    success: false,
    code: 'INVALID_TOKEN',
    message: 'Token signature is invalid or has expired.'
  });
}

// Role-Based Access Control (RBAC) Guard
function requireRoles(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !req.user.roles.some(r => allowedRoles.includes(r))) {
      return res.status(403).json({
        success: false,
        code: 'FORBIDDEN',
        message: `Forbidden: This operation requires one of the following roles: [${allowedRoles.join(', ')}].`
      });
    }
    next();
  };
}

// Health & Info Endpoint
app.get('/', (req, res) => {
  res.json({
    project: 'Tonaire Digital - Flutter & Backend Assessment API',
    status: 'online',
    database: isDbConnected() ? 'Microsoft SQL Server (Connected)' : 'In-Memory Simulation (Active)',
    endpoints: {
      readProducts: 'GET /api/v1/products',
      updatePrice: 'PATCH /api/v1/products/:id/price'
    }
  });
});

// 1. Endpoint: Read Product Catalog (Legacy-compatible for old Flutter apps)
app.get('/api/v1/products', getProducts);

// 2. Endpoint: Update Product Price (Secured by JWT & RBAC)
app.patch(
  '/api/v1/products/:id/price',
  authenticateJWT,
  requireRoles('Admin', 'PriceManager'),
  updateProductPrice
);

module.exports = app;
