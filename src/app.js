/**
 * Assessment: Junior Flutter & Backend Developer - Tonaire Digital Co., Ltd.
 * Candidate: Chhem Kakada
 * File: src/app.js
 * Description: Express application setup showing route definitions, JWT auth, and RBAC permissions.
 */

const express = require('express');
const { updateProductPrice } = require('./productController');

const app = express();
app.use(express.json());

// Simulated Authentication & RBAC Middleware
function authenticateJWT(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, code: 'UNAUTHORIZED', message: 'Missing Bearer token.' });
  }

  // Simulated decoded JWT token payload
  const token = authHeader.split(' ')[1];
  if (token === 'admin-valid-token') {
    req.user = { id: 1, email: 'admin@tonaire.com', roles: ['Admin'] };
    return next();
  } else if (token === 'manager-valid-token') {
    req.user = { id: 2, email: 'manager@tonaire.com', roles: ['PriceManager'] };
    return next();
  } else if (token === 'customer-valid-token') {
    req.user = { id: 99, email: 'customer@mobile.com', roles: ['Customer'] };
    return next();
  }

  return res.status(401).json({ success: false, code: 'INVALID_TOKEN', message: 'Token is invalid or expired.' });
}

function requireRoles(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !req.user.roles.some(r => allowedRoles.includes(r))) {
      return res.status(403).json({
        success: false,
        code: 'FORBIDDEN',
        message: `Forbidden: Requires one of the following roles: ${allowedRoles.join(', ')}.`
      });
    }
    next();
  };
}

// 1. Endpoint for Mobile Apps & Web (Read Catalog)
// Preserves the essential 'price' field for legacy Flutter apps; 'unitPrice' is an optional additive alias
app.get('/api/v1/products', (req, res) => {
  res.json({
    success: true,
    data: [
      {
        id: 101,
        sku: 'PROD-101',
        name: 'Classic Cotton T-Shirt',
        price: 24.99,      // Essential legacy contract preserved
        unitPrice: 24.99,  // Additive alias if modern v2 consumers require it
        currency: 'USD',
        isActive: true
      }
    ]
  });
});

// 2. Endpoint for Authorized Price Updates
app.patch(
  '/api/v1/products/:id/price',
  authenticateJWT,
  requireRoles('Admin', 'PriceManager'),
  updateProductPrice
);

module.exports = app;
