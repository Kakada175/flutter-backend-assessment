/**
 * Assessment: Junior Flutter & Backend Developer - Tonaire Digital Co., Ltd.
 * Candidate: Chhem Kakada
 * File: src/productController.js
 * Description: Node.js/Express route handler for PATCH /api/v1/products/:id/price
 * Demonstrates strict validation, atomic database transactions with (UPDLOCK, HOLDLOCK),
 * error mapping, and backward-compatible response serialization.
 */

const sql = require('mssql'); // Microsoft SQL Server client for Node.js

/**
 * PATCH /api/v1/products/:id/price
 * Updates a product price, records an audit log, and preserves backward compatibility.
 */
async function updateProductPrice(req, res, next) {
  const rawId = req.params.id;

  // 1. Strict Product ID Validation (disallow "42abc", decimals, negative numbers)
  if (!/^\d+$/.test(rawId)) {
    return res.status(400).json({
      success: false,
      code: 'INVALID_PRODUCT_ID',
      message: 'Product ID must be a valid positive integer.'
    });
  }
  const productId = parseInt(rawId, 10);
  if (productId <= 0) {
    return res.status(400).json({
      success: false,
      code: 'INVALID_PRODUCT_ID',
      message: 'Product ID must be greater than zero.'
    });
  }

  // 2. Strict Price Validation
  // Disallows strings ("29.99"), null, boolean (true -> 1), NaN, Infinity, negative, >2 decimals, >DECIMAL(18,2) max
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
      message: 'Price must be a valid non-negative number with up to 2 decimal places (max 9999999999999999.99).'
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

  // 4. Version (Optimistic Lock Token) Validation if provided
  let expectedVersionBuffer = null;
  if (version !== undefined && version !== null) {
    if (typeof version !== 'string' || version.trim().length === 0) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_VERSION',
        message: 'Concurrency version token must be a valid non-empty string.'
      });
    }
    try {
      expectedVersionBuffer = Buffer.from(version, 'base64');
    } catch (_) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_VERSION_ENCODING',
        message: 'Version token must be a valid Base64 string.'
      });
    }
  }

  const user = req.user; // Injected by authenticateJWT & requireRoles middleware

  let transaction;
  try {
    const pool = await sql.connect();
    transaction = new sql.Transaction(pool);

    // CRITICAL: Begin transaction BEFORE the SELECT so the lock is held across the entire sequence
    await transaction.begin(sql.ISOLATION_LEVEL.READ_COMMITTED);

    // Lock target row with UPDLOCK, HOLDLOCK to protect entire read-modify-audit sequence
    const selectReq = new sql.Request(transaction);
    selectReq.input('ProductId', sql.Int, productId);
    const existingResult = await selectReq.query(`
      SELECT Price, Currency, RowVersion, IsActive
      FROM dbo.Products WITH (UPDLOCK, HOLDLOCK)
      WHERE ProductId = @ProductId
    `);

    if (existingResult.recordset.length === 0) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        code: 'PRODUCT_NOT_FOUND',
        message: `No product found matching ID ${productId}.`
      });
    }

    const current = existingResult.recordset[0];

    // Check Active Status
    if (!current.IsActive) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        code: 'PRODUCT_INACTIVE',
        message: 'Cannot update the price of an inactive or archived product.'
      });
    }

    // Check Optimistic Concurrency Token
    if (expectedVersionBuffer) {
      if (Buffer.compare(current.RowVersion, expectedVersionBuffer) !== 0) {
        await transaction.rollback();
        return res.status(409).json({
          success: false,
          code: 'CONCURRENCY_CONFLICT',
          message: 'Product was modified by another transaction. Please reload and retry.'
        });
      }
    }

    const oldPrice = Number(current.Price);
    let newRowVersion = current.RowVersion;

    // No-Change Optimization: If price is identical, exit early without redundant audit record
    if (oldPrice === price) {
      await transaction.commit();
      return res.status(200).json({
        success: true,
        message: 'No-change optimization: Current price is already equal to requested price.',
        data: {
          id: productId,
          price: price,             // Preserves legacy contract for older Flutter clients
          unitPrice: price,         // Additive alias for modern clients if needed
          oldPrice: oldPrice,
          currency: current.Currency,
          version: Buffer.from(current.RowVersion).toString('base64'),
          updatedAt: new Date().toISOString()
        }
      });
    }

    // Atomic Update & Audit Log Insert
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

      INSERT INTO dbo.ProductPriceAudit (
        ProductId, OldPrice, NewPrice, Currency, ChangedByUserId, ChangeReason, ChangedAt, IpAddress
      )
      VALUES (
        @ProductId, @OldPrice, @NewPrice, @Currency, @UserId, @Reason, SYSUTCDATETIME(), @IpAddress
      );

      SELECT RowVersion, UpdatedAt FROM dbo.Products WHERE ProductId = @ProductId;
    `);

    newRowVersion = updateResult.recordset[0]?.RowVersion || newRowVersion;
    const updatedAt = updateResult.recordset[0]?.UpdatedAt || new Date();

    await transaction.commit();

    // Return backward-compatible response preserving 'price'
    return res.status(200).json({
      success: true,
      message: 'Product price updated successfully.',
      data: {
        id: productId,
        price: price,             // Essential legacy contract preserved
        unitPrice: price,         // Additive alias for new services
        oldPrice: oldPrice,
        currency: current.Currency,
        version: Buffer.from(newRowVersion).toString('base64'),
        updatedAt: updatedAt.toISOString()
      }
    });

  } catch (err) {
    if (transaction) {
      try {
        await transaction.rollback();
      } catch (_) { /* ignore rollback errors if already aborted */ }
    }

    // Detailed error code mapping
    if (err.number === 50001) {
      return res.status(404).json({ success: false, code: 'PRODUCT_NOT_FOUND', message: err.message });
    }
    if (err.number === 50002) {
      return res.status(400).json({ success: false, code: 'PRODUCT_INACTIVE', message: err.message });
    }
    if (err.number === 50003) {
      return res.status(409).json({ success: false, code: 'CONCURRENCY_CONFLICT', message: err.message });
    }

    console.error(`[PriceUpdateError] ProductId ${productId}:`, err);
    return res.status(500).json({
      success: false,
      code: 'DATABASE_ERROR',
      message: 'Failed to update product price due to an internal database error.'
    });
  }
}

module.exports = { updateProductPrice };
