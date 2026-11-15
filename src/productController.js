/**
 * Assessment: Junior Flutter & Backend Developer - Tonaire Digital Co., Ltd.
 * Candidate: Chhem Kakada
 * File: src/productController.js
 * Description: Controller handling GET /api/v1/products and PATCH /api/v1/products/:id/price
 * Supports both live Microsoft SQL Server and in-memory fallback.
 */

const sql = require('mssql');
const { getPool, isDbConnected, inMemoryProducts, inMemoryAudit } = require('./db');

/**
 * GET /api/v1/products
 * Reads the active product catalog.
 * Preserves the original 'price' field for older Flutter mobile apps.
 */
async function getProducts(req, res) {
  try {
    if (isDbConnected()) {
      const pool = getPool();
      const result = await pool.request().query(`
        SELECT ProductId, SKU, Name, Description, CategoryId, Price, Currency, IsActive, RowVersion, UpdatedAt
        FROM dbo.Products
        WHERE IsActive = 1
        ORDER BY ProductId ASC
      `);

      const formatted = result.recordset.map(row => ({
        id: row.ProductId,
        sku: row.SKU,
        name: row.Name,
        description: row.Description,
        categoryId: row.CategoryId,
        price: Number(row.Price),            // Original legacy field
        unitPrice: Number(row.Price),        // Additive alias for modern clients
        currency: row.Currency,
        isActive: Boolean(row.IsActive),
        version: row.RowVersion ? Buffer.from(row.RowVersion).toString('base64') : null,
        updatedAt: row.UpdatedAt
      }));

      return res.status(200).json({
        success: true,
        data: formatted,
        count: formatted.length,
        source: 'sql-server'
      });
    } else {
      // In-Memory Fallback
      const formatted = inMemoryProducts.filter(p => p.IsActive).map(p => ({
        id: p.ProductId,
        sku: p.SKU,
        name: p.Name,
        description: p.Description,
        categoryId: p.CategoryId,
        price: Number(p.Price),
        unitPrice: Number(p.Price),
        currency: p.Currency,
        isActive: p.IsActive,
        version: Buffer.from(p.RowVersion).toString('base64'),
        updatedAt: p.UpdatedAt
      }));

      return res.status(200).json({
        success: true,
        data: formatted,
        count: formatted.length,
        source: 'in-memory-simulation'
      });
    }
  } catch (err) {
    console.error('[GetProductsError]', err);
    return res.status(500).json({
      success: false,
      code: 'SERVER_ERROR',
      message: 'Failed to retrieve products from database.'
    });
  }
}

/**
 * PATCH /api/v1/products/:id/price
 * Updates a product price, records an audit log, and preserves backward compatibility.
 */
async function updateProductPrice(req, res) {
  const rawId = req.params.id;

  // 1. Strict Product ID Validation
  if (!/^\d+$/.test(rawId)) {
    return res.status(400).json({
      success: false,
      code: 'INVALID_ID',
      message: 'Product ID must be a positive integer.'
    });
  }
  const productId = parseInt(rawId, 10);
  if (productId <= 0) {
    return res.status(400).json({
      success: false,
      code: 'INVALID_ID',
      message: 'Product ID must be greater than zero.'
    });
  }

  // 2. Strict Price Validation
  const { price, reason, version } = req.body;
  if (
    typeof price !== 'number' ||
    !Number.isFinite(price) ||
    price < 0 ||
    price > 9999999999999999.99 ||
    Math.round(price * 100) !== price * 100
  ) {
    return res.status(400).json({
      success: false,
      code: 'INVALID_PRICE',
      message: 'Price must be a valid non-negative number with up to 2 decimal places.'
    });
  }

  // 3. Strict Reason Validation
  if (typeof reason !== 'string' || reason.trim().length < 5 || reason.trim().length > 500) {
    return res.status(400).json({
      success: false,
      code: 'INVALID_REASON',
      message: 'A business reason of 5 to 500 characters is required for audit compliance.'
    });
  }

  const user = req.user || { id: 1, email: 'admin@tonaire.com' };

  // ==========================================
  // Path A: Microsoft SQL Server Execution
  // ==========================================
  if (isDbConnected()) {
    let transaction;
    try {
      const pool = getPool();
      transaction = new sql.Transaction(pool);

      // Begin transaction BEFORE the select to hold UPDLOCK, HOLDLOCK
      await transaction.begin(sql.ISOLATION_LEVEL.READ_COMMITTED);

      const selectReq = new sql.Request(transaction);
      selectReq.input('ProductId', sql.Int, productId);
      const existing = await selectReq.query(`
        SELECT Price, Currency, RowVersion, IsActive 
        FROM dbo.Products WITH (UPDLOCK, HOLDLOCK) 
        WHERE ProductId = @ProductId
      `);

      if (existing.recordset.length === 0) {
        await transaction.rollback();
        return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'Product not found.' });
      }

      const current = existing.recordset[0];
      if (!current.IsActive) {
        await transaction.rollback();
        return res.status(400).json({ success: false, code: 'INACTIVE', message: 'Cannot update inactive product.' });
      }

      // Optimistic Lock Check
      if (version) {
        const currentVer = Buffer.from(current.RowVersion).toString('base64');
        if (currentVer !== version) {
          await transaction.rollback();
          return res.status(409).json({
            success: false,
            code: 'CONFLICT',
            message: 'Product was modified by another transaction. Please reload.'
          });
        }
      }

      const oldPrice = Number(current.Price);

      // No-Change Optimization
      if (oldPrice === price) {
        await transaction.commit();
        return res.status(200).json({
          success: true,
          message: 'No-change optimization: Price is already up to date.',
          data: {
            id: productId,
            price: price,
            unitPrice: price,
            oldPrice: oldPrice,
            currency: current.Currency,
            version: Buffer.from(current.RowVersion).toString('base64')
          }
        });
      }

      // Atomic Update & Audit Log
      const updateReq = new sql.Request(transaction);
      updateReq.input('ProductId', sql.Int, productId);
      updateReq.input('NewPrice', sql.Decimal(18, 2), price);
      updateReq.input('OldPrice', sql.Decimal(18, 2), oldPrice);
      updateReq.input('Currency', sql.NVarChar(3), current.Currency);
      updateReq.input('UserId', sql.Int, user.id);
      updateReq.input('Reason', sql.NVarChar(500), reason.trim());
      updateReq.input('IpAddress', sql.NVarChar(45), req.ip || null);

      const updateResult = await updateReq.query(`
        UPDATE dbo.Products 
        SET Price = @NewPrice, UpdatedAt = SYSUTCDATETIME(), UpdatedByUserId = @UserId 
        WHERE ProductId = @ProductId;

        INSERT INTO dbo.ProductPriceAudit (ProductId, OldPrice, NewPrice, Currency, ChangedByUserId, ChangeReason, ChangedAt, IpAddress)
        VALUES (@ProductId, @OldPrice, @NewPrice, @Currency, @UserId, @Reason, SYSUTCDATETIME(), @IpAddress);

        SELECT RowVersion, UpdatedAt FROM dbo.Products WHERE ProductId = @ProductId;
      `);

      const newRowVersion = updateResult.recordset[0]?.RowVersion;
      await transaction.commit();

      return res.status(200).json({
        success: true,
        message: 'Product price updated successfully.',
        data: {
          id: productId,
          price: price,
          unitPrice: price,
          oldPrice: oldPrice,
          currency: current.Currency,
          version: Buffer.from(newRowVersion).toString('base64'),
          updatedAt: updateResult.recordset[0]?.UpdatedAt
        }
      });
    } catch (err) {
      if (transaction) { try { await transaction.rollback(); } catch (_) {} }
      console.error('[PriceUpdateError]', err);
      return res.status(500).json({ success: false, code: 'SERVER_ERROR', message: 'Database transaction failed.' });
    }
  }

  // ==========================================
  // Path B: In-Memory Simulation Execution
  // ==========================================
  const targetProduct = inMemoryProducts.find(p => p.ProductId === productId);
  if (!targetProduct) {
    return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'Product not found.' });
  }
  if (!targetProduct.IsActive) {
    return res.status(400).json({ success: false, code: 'INACTIVE', message: 'Cannot update inactive product.' });
  }

  const currentVerBase64 = Buffer.from(targetProduct.RowVersion).toString('base64');
  if (version && version !== currentVerBase64) {
    return res.status(409).json({
      success: false,
      code: 'CONFLICT',
      message: 'Product was modified by another transaction. Please reload.'
    });
  }

  const oldPrice = targetProduct.Price;
  if (oldPrice === price) {
    return res.status(200).json({
      success: true,
      message: 'No-change optimization: Price is already up to date.',
      data: {
        id: productId,
        price: price,
        unitPrice: price,
        oldPrice: oldPrice,
        currency: targetProduct.Currency,
        version: currentVerBase64
      }
    });
  }

  // Atomically increment in-memory version counter
  const newVerNum = targetProduct.RowVersion.readUInt32BE(4) + 1;
  const newRowVersion = Buffer.alloc(8);
  newRowVersion.writeUInt32BE(newVerNum, 4);

  targetProduct.Price = price;
  targetProduct.RowVersion = newRowVersion;
  targetProduct.UpdatedAt = new Date();

  inMemoryAudit.push({
    AuditId: inMemoryAudit.length + 1,
    ProductId: productId,
    OldPrice: oldPrice,
    NewPrice: price,
    Currency: targetProduct.Currency,
    ChangedByUserId: user.id,
    ChangeReason: reason.trim(),
    ChangedAt: new Date(),
    IpAddress: req.ip || '127.0.0.1'
  });

  return res.status(200).json({
    success: true,
    message: 'Product price updated successfully (simulated store).',
    data: {
      id: productId,
      price: price,
      unitPrice: price,
      oldPrice: oldPrice,
      currency: targetProduct.Currency,
      version: Buffer.from(newRowVersion).toString('base64'),
      updatedAt: targetProduct.UpdatedAt
    }
  });
}

module.exports = {
  getProducts,
  updateProductPrice
};
