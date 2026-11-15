/**
 * SQL Server Database Initialization & Seeding Script
 * Usage: npm run seed
 */
const sql = require('mssql');
require('dotenv').config();

const masterConfig = {
  user: process.env.DB_USER || 'sa',
  password: process.env.DB_PASSWORD || 'YourStrong@Passw0rd',
  server: process.env.DB_SERVER || 'localhost',
  database: 'master',
  port: parseInt(process.env.DB_PORT || '1433', 10),
  options: {
    encrypt: process.env.DB_ENCRYPT === 'true',
    trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE !== 'false'
  }
};

const appDbName = process.env.DB_DATABASE || 'TonaireCommerce';

async function seed() {
  console.log(`\n=== SQL Server Seeder for ${appDbName} ===`);
  let masterPool;
  try {
    console.log(`1. Connecting to SQL Server master database...`);
    masterPool = await sql.connect(masterConfig);
    
    // Create database if not exists
    console.log(`2. Ensuring database [${appDbName}] exists...`);
    await masterPool.query(`
      IF NOT EXISTS (SELECT name FROM sys.databases WHERE name = N'${appDbName}')
      BEGIN
          CREATE DATABASE [${appDbName}];
          PRINT 'Created database ${appDbName}';
      END
    `);
    await masterPool.close();

    // Now connect to the application database
    const appConfig = { ...masterConfig, database: appDbName };
    const appPool = await sql.connect(appConfig);
    console.log(`3. Connected to [${appDbName}]. Creating tables...`);

    // Create Tables
    await appPool.query(`
      IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Roles')
      CREATE TABLE Roles (
          RoleId INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
          RoleName NVARCHAR(50) NOT NULL UNIQUE,
          Description NVARCHAR(255) NULL,
          CreatedAt DATETIME2(7) NOT NULL DEFAULT SYSUTCDATETIME()
      );

      IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Users')
      CREATE TABLE Users (
          UserId INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
          Email NVARCHAR(255) NOT NULL UNIQUE,
          PasswordHash NVARCHAR(255) NOT NULL,
          FullName NVARCHAR(100) NOT NULL,
          RoleId INT NOT NULL FOREIGN KEY REFERENCES Roles(RoleId),
          IsActive BIT NOT NULL DEFAULT 1,
          CreatedAt DATETIME2(7) NOT NULL DEFAULT SYSUTCDATETIME()
      );

      IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Categories')
      CREATE TABLE Categories (
          CategoryId INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
          CategoryName NVARCHAR(100) NOT NULL UNIQUE,
          IsActive BIT NOT NULL DEFAULT 1,
          CreatedAt DATETIME2(7) NOT NULL DEFAULT SYSUTCDATETIME()
      );

      IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Products')
      CREATE TABLE Products (
          ProductId INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
          SKU NVARCHAR(50) NOT NULL UNIQUE,
          Name NVARCHAR(200) NOT NULL,
          Description NVARCHAR(MAX) NULL,
          CategoryId INT NOT NULL FOREIGN KEY REFERENCES Categories(CategoryId),
          Price DECIMAL(18,2) NOT NULL CHECK (Price >= 0.00),
          Currency NVARCHAR(3) NOT NULL DEFAULT 'USD',
          IsActive BIT NOT NULL DEFAULT 1,
          RowVersion ROWVERSION NOT NULL,
          CreatedAt DATETIME2(7) NOT NULL DEFAULT SYSUTCDATETIME(),
          UpdatedAt DATETIME2(7) NOT NULL DEFAULT SYSUTCDATETIME(),
          UpdatedByUserId INT NULL FOREIGN KEY REFERENCES Users(UserId)
      );

      IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'ProductPriceAudit')
      CREATE TABLE ProductPriceAudit (
          AuditId BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
          ProductId INT NOT NULL FOREIGN KEY REFERENCES Products(ProductId),
          OldPrice DECIMAL(18,2) NOT NULL,
          NewPrice DECIMAL(18,2) NOT NULL,
          Currency NVARCHAR(3) NOT NULL,
          ChangedByUserId INT NOT NULL FOREIGN KEY REFERENCES Users(UserId),
          ChangeReason NVARCHAR(500) NOT NULL,
          ChangedAt DATETIME2(7) NOT NULL DEFAULT SYSUTCDATETIME(),
          IpAddress NVARCHAR(45) NULL
      );
    `);

    console.log(`4. Inserting initial seed data (Roles, Categories, Products)...`);
    await appPool.query(`
      -- Seed Roles
      IF NOT EXISTS (SELECT * FROM Roles WHERE RoleName = 'Admin')
          INSERT INTO Roles (RoleName, Description) VALUES ('Admin', 'System Administrator');
      IF NOT EXISTS (SELECT * FROM Roles WHERE RoleName = 'PriceManager')
          INSERT INTO Roles (RoleName, Description) VALUES ('PriceManager', 'Catalog and Pricing Manager');
      IF NOT EXISTS (SELECT * FROM Roles WHERE RoleName = 'Customer')
          INSERT INTO Roles (RoleName, Description) VALUES ('Customer', 'Mobile Storefront Customer');

      -- Seed Users
      DECLARE @AdminRoleId INT = (SELECT RoleId FROM Roles WHERE RoleName = 'Admin');
      DECLARE @ManagerRoleId INT = (SELECT RoleId FROM Roles WHERE RoleName = 'PriceManager');
      IF NOT EXISTS (SELECT * FROM Users WHERE Email = 'admin@tonaire.com')
          INSERT INTO Users (Email, PasswordHash, FullName, RoleId) VALUES ('admin@tonaire.com', 'hashed_pass_admin', 'Admin User', @AdminRoleId);
      IF NOT EXISTS (SELECT * FROM Users WHERE Email = 'manager@tonaire.com')
          INSERT INTO Users (Email, PasswordHash, FullName, RoleId) VALUES ('manager@tonaire.com', 'hashed_pass_manager', 'Pricing Manager', @ManagerRoleId);

      -- Seed Categories
      IF NOT EXISTS (SELECT * FROM Categories WHERE CategoryName = 'Apparel')
          INSERT INTO Categories (CategoryName) VALUES ('Apparel');
      IF NOT EXISTS (SELECT * FROM Categories WHERE CategoryName = 'Footwear')
          INSERT INTO Categories (CategoryName) VALUES ('Footwear');

      -- Seed Products
      DECLARE @ApparelId INT = (SELECT CategoryId FROM Categories WHERE CategoryName = 'Apparel');
      DECLARE @FootwearId INT = (SELECT CategoryId FROM Categories WHERE CategoryName = 'Footwear');
      IF NOT EXISTS (SELECT * FROM Products WHERE SKU = 'TSHIRT-BLK-01')
          INSERT INTO Products (SKU, Name, Description, CategoryId, Price, Currency) VALUES ('TSHIRT-BLK-01', 'Classic Black T-Shirt', 'Premium 100% cotton casual t-shirt', @ApparelId, 24.99, 'USD');
      IF NOT EXISTS (SELECT * FROM Products WHERE SKU = 'JEANS-BLU-02')
          INSERT INTO Products (SKU, Name, Description, CategoryId, Price, Currency) VALUES ('JEANS-BLU-02', 'Slim Fit Blue Jeans', 'Classic denim slim fit stretch jeans', @ApparelId, 49.99, 'USD');
      IF NOT EXISTS (SELECT * FROM Products WHERE SKU = 'SHOES-RUN-03')
          INSERT INTO Products (SKU, Name, Description, CategoryId, Price, Currency) VALUES ('SHOES-RUN-03', 'Pro Running Shoes', 'High performance breathable athletic sneakers', @FootwearId, 89.99, 'USD');
    `);

    console.log(`\nSUCCESS: Database [${appDbName}] schema & seed data ready!`);
    await appPool.close();
    process.exit(0);
  } catch (err) {
    console.error(`\nERROR Seeding Database:`, err.message);
    console.error(`Please verify your SQL Server is running and check .env settings.\n`);
    process.exit(1);
  }
}

seed();
