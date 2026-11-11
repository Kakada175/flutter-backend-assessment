# Flutter + Backend Technical Assessment
**Company:** Tonaire Digital Co., Ltd.  
**Role:** Junior Flutter & Backend Developer  
**Candidate:** Chhem Kakada  
**Topic:** Product Price Change with Old Mobile App Versions (Backward-Compatible Architecture)  
**Tech Stack:** Flutter • Node.js / Express • Microsoft SQL Server

---

## 📌 Submission Overview

This repository contains the complete technical assessment solution prepared by **Chhem Kakada** for **Tonaire Digital Co., Ltd.**

The core challenge addresses a real-world enterprise problem: allowing authorized staff to update product prices in Microsoft SQL Server via a Node.js/Express API, without breaking existing older Flutter mobile app clients active in production.

### Deliverables:
- **`Chhem_Kakada_Assessment.pdf`**: The complete, submission-ready PDF containing the system architecture diagram, database schema, API design, parameterized T-SQL procedures, design reasoning, crash post-mortem, implementation code, and interview defense answers.
- **`database/schema.sql`**: T-SQL script containing the 5-table relational schema (3NF) and the parameterized atomic price update script with transaction-first isolation (`BEGIN TRANSACTION` before `SELECT` with `UPDLOCK, HOLDLOCK`), optimistic concurrency (`ROWVERSION`), and append-only audit logging.
- **`src/`**: Node.js/Express implementation:
  - `productController.js`: Route handler with strict validation (coercion-resistant price checking, integer regex for IDs), atomic database transactions, optimistic lock checks, error code mapping (50001 &rarr; 404, 50003 &rarr; 409), and backward-compatible responses.
  - `app.js`: Express app wiring, JWT authentication, and Role-Based Access Control (RBAC) middleware.
- **`flutter/product_model.dart`**: Executable Dart script reproducing the exact Sound Null Safety failure (`type 'Null' is not a subtype of type 'num' in type cast`) when `price` is renamed to `unitPrice`, alongside the resilient defensive parsing pattern (`rawPrice is! num`, `.toDouble()`).

---

## 🏗️ Architecture Summary

```
[Old Flutter App v1.x]  ──(GET /api/v1/products)──┐
(Expects numeric 'price')                          │
                                                   ├──> [API Gateway / NGINX Proxy]
[Admin / Manager Client] ──(PATCH /price + JWT)────┤    • HTTPS Termination & Rate Limiting
(Role: Admin / PriceManager)                       │             │
                                                   │             ▼
                                                   └──> [Node.js / Express API]
                                                        • 1. JWT Auth & RBAC Middleware
                                                        • 2. Strict Input Validation
                                                        • 3. Product Service (Preserves 'price')
                                                        • 4. Tedious / mssql Connection Pool
                                                                 │
                                                                 ▼
                                                        [Microsoft SQL Server]
                                                        • Products (with ROWVERSION)
                                                        • ProductPriceAudit (Append-only)
                                                        • Users & Roles (Single-role model)
                                                        • ACID: BEGIN TRANSACTION before SELECT
                                                          with (UPDLOCK, HOLDLOCK)
```

---

## 🗄️ Database Design (5 Tables)

1. **`Roles`**: Role definitions (`Admin`, `PriceManager`, `Customer`).
2. **`Users`**: User credentials, email uniqueness, active status, single-role reference (`Users.RoleId -> Roles.RoleId`).
3. **`Categories`**: Product categorization hierarchy.
4. **`Products`**: Core catalog with `Price DECIMAL(18,2)`, `RowVersion` (8-byte monotonic optimistic concurrency token), and nonclustered indexes for read throughput.
5. **`ProductPriceAudit`**: Append-only audit history table capturing `OldPrice`, `NewPrice`, `ChangedByUserId`, `ChangeReason`, `ChangedAt (UTC)`, and `IpAddress`.

---

## 🔌 API Specification Highlights

### 1. `GET /api/v1/products` (Catalog Read)
- Used by older and modern Flutter clients.
- Returns JSON with the original `price` field preserved as a numeric type; `unitPrice` is provided as an additive alias if new clients require it.

### 2. `PATCH /api/v1/products/:id/price` (Price Update)
- Protected by `Bearer <JWT>` with required roles: `Admin` or `PriceManager`.
- Validates price format (`typeof price === 'number'`, non-negative, finite, max 2 decimals, within `DECIMAL(18,2)` range), mandatory audit reason (5–500 chars), and optional optimistic concurrency `version`.
- Response status codes: `200 OK`, `400 Bad Request`, `401 Unauthorized`, `403 Forbidden`, `404 Not Found`, `409 Conflict`.

---

## 💥 Breaking Change Analysis: Why Old Clients Failed

### The Bug:
Backend renamed JSON key `price` to `unitPrice` in the response:
```json
{ "id": 101, "name": "T-Shirt", "unitPrice": 29.99 }
```

### The Crash:
In the older Flutter app's Dart model:
```dart
Product.fromJson(Map<String, dynamic> json)
  : price = (json['price'] as num).toDouble();
```
1. Because `'price'` is absent, `json['price']` returns `null`.
2. Under Dart Sound Null Safety, `null as num` throws:
   ```
   Unhandled Exception: type 'Null' is not a subtype of type 'num' in type cast
   ```
3. The Future fails, causing an unhandled exception and a blank screen or error screen on mobile devices.

### The Remediation:
1. **Immediate Backend Hotfix:** Restore `price` in the Express serializer (`{ price: p.price, unitPrice: p.price }`). Resolves 100% of mobile crashes instantly with zero client app updates required.
2. **Defensive Flutter Architecture:** Implement resilient parsing:
   ```dart
   final rawPrice = json['price'] ?? json['unitPrice'];
   if (rawPrice is! num) {
     throw FormatException('Missing or invalid product price in response: $json');
   }
   final double price = rawPrice.toDouble();
   ```

---

## 🎯 Interview Follow-Up Defense Answers

1. **Why do you need both a SQL transaction and ROWVERSION?**
   - **Transaction with `(UPDLOCK, HOLDLOCK)`:** Provides *short-term pessimistic isolation and atomicity*. Guarantees that the price update and audit insert succeed together without intermediate reads or deadlocks.
   - **`ROWVERSION`:** Provides *long-term optimistic concurrency control* across stateless HTTP requests. Prevents Manager B from overwriting Manager A's edits when both opened the edit form simultaneously.
2. **What happens if two managers update the same product price simultaneously?**
   - The first request acquires the `UPDLOCK, HOLDLOCK`. The second request waits. When the first commits, `ROWVERSION` increments. The second transaction resumes, detects `CurrentRowVersion <> ExpectedRowVersion`, rolls back, and returns `409 Conflict`.
3. **Why can an old Flutter application crash when the backend changes `price` to `unitPrice`?**
   - Because Dart Sound Null Safety rejects `null as num` at runtime with a `TypeError`. Since existing installed mobile binaries cannot be updated remotely, the backend must preserve the `price` property.

---

## 🛠️ Verification & Running the Samples

### 1. Run Flutter Dart Failure & Resilient Parsing Demo:
```bash
dart flutter/product_model.dart
```

### 2. Inspect Database DDL & T-SQL Procedure:
Review `database/schema.sql`.

### 3. Inspect Node.js Implementation:
Review `src/productController.js` and `src/app.js`.

### 4. Regenerate Submission PDF:
```bash
python generate_pdf.py
```

---

## 📝 Candidate Declaration & Tools Used Note
- **Candidate:** Chhem Kakada
- **Tools & Documentation Consulted:** ChatGPT/ AI assistant was used as an assistive tool solely for formatting the answer documentation, structuring the layout, and drawing the SVG architecture diagram.
- **Personal Verification & Independent Work:**
  1. The database schema (5 tables, primary/foreign keys, `DECIMAL(18,2)` financial constraints, and indexes) was custom designed and validated for referential integrity.
  2. The parameterized T-SQL update procedure was written with explicit transaction handling, `UPDLOCK` concurrency guards, and custom error codes.
  3. The step-by-step Flutter runtime crash analysis was verified against actual Dart 3.x runtime behavior via local script execution (`flutter/product_model.dart`), confirming the exact `type 'Null' is not a subtype of type 'num'` exception.
  4. The Express controller was implemented using parameterized queries, transactional rollback handling, and dual-field DTO mapping.
- **Candidate Confirmation:** I, Chhem Kakada, have verified every technical decision, SQL constraint, and code sample presented herein and am prepared to explain and defend every detail during the follow-up technical interview.
