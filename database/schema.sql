-- ============================================================================
-- Assessment Submission: Tonaire Digital Co., Ltd.
-- Candidate: Chhem Kakada
-- Tech Stack: Flutter + Node.js/Express + SQL Server
-- File: database/schema.sql
-- Description: Complete idempotent DDL, seed data, and Stored Procedure for SSMS
-- ============================================================================

-- 1. Ensure Database Exists and Switch Context
IF NOT EXISTS (SELECT name FROM sys.databases WHERE name = N'TonaireCommerce')
BEGIN
    CREATE DATABASE [TonaireCommerce];
END;
GO

USE [TonaireCommerce];
GO

-- 2. Create Roles Table
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Roles')
BEGIN
    CREATE TABLE Roles (
        RoleId INT IDENTITY(1,1) NOT NULL,
        RoleName NVARCHAR(50) NOT NULL,
        Description NVARCHAR(255) NULL,
        CreatedAt DATETIME2(7) NOT NULL CONSTRAINT DF_Roles_CreatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_Roles PRIMARY KEY CLUSTERED (RoleId),
        CONSTRAINT UQ_Roles_RoleName UNIQUE (RoleName)
    );
END;
GO

-- 3. Create Users Table (Single-role model per user)
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Users')
BEGIN
    CREATE TABLE Users (
        UserId INT IDENTITY(1,1) NOT NULL,
        Email NVARCHAR(255) NOT NULL,
        PasswordHash NVARCHAR(255) NOT NULL,
        FullName NVARCHAR(100) NOT NULL,
        RoleId INT NOT NULL,
        IsActive BIT NOT NULL CONSTRAINT DF_Users_IsActive DEFAULT 1,
        CreatedAt DATETIME2(7) NOT NULL CONSTRAINT DF_Users_CreatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_Users PRIMARY KEY CLUSTERED (UserId),
        CONSTRAINT UQ_Users_Email UNIQUE (Email),
        CONSTRAINT FK_Users_Roles FOREIGN KEY (RoleId) REFERENCES Roles(RoleId)
    );
END;
GO

-- 4. Create Categories Table
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Categories')
BEGIN
    CREATE TABLE Categories (
        CategoryId INT IDENTITY(1,1) NOT NULL,
        CategoryName NVARCHAR(100) NOT NULL,
        IsActive BIT NOT NULL CONSTRAINT DF_Categories_IsActive DEFAULT 1,
        CreatedAt DATETIME2(7) NOT NULL CONSTRAINT DF_Categories_CreatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_Categories PRIMARY KEY CLUSTERED (CategoryId),
        CONSTRAINT UQ_Categories_CategoryName UNIQUE (CategoryName)
    );
END;
GO

-- 5. Create Products Table (Core Catalog with Optimistic Concurrency Control)
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Products')
BEGIN
    CREATE TABLE Products (
        ProductId INT IDENTITY(1,1) NOT NULL,
        SKU NVARCHAR(50) NOT NULL,
        Name NVARCHAR(200) NOT NULL,
        Description NVARCHAR(MAX) NULL,
        CategoryId INT NOT NULL,
        Price DECIMAL(18,2) NOT NULL,
        Currency NVARCHAR(3) NOT NULL CONSTRAINT DF_Products_Currency DEFAULT 'USD',
        IsActive BIT NOT NULL CONSTRAINT DF_Products_IsActive DEFAULT 1,
        RowVersion ROWVERSION NOT NULL, -- Automatic monotonic 8-byte token for concurrency
        CreatedAt DATETIME2(7) NOT NULL CONSTRAINT DF_Products_CreatedAt DEFAULT SYSUTCDATETIME(),
        UpdatedAt DATETIME2(7) NOT NULL CONSTRAINT DF_Products_UpdatedAt DEFAULT SYSUTCDATETIME(),
        UpdatedByUserId INT NULL,
        CONSTRAINT PK_Products PRIMARY KEY CLUSTERED (ProductId),
        CONSTRAINT UQ_Products_SKU UNIQUE (SKU),
        CONSTRAINT FK_Products_Categories FOREIGN KEY (CategoryId) REFERENCES Categories(CategoryId),
        CONSTRAINT FK_Products_Users_UpdatedBy FOREIGN KEY (UpdatedByUserId) REFERENCES Users(UserId),
        CONSTRAINT CK_Products_Price_Positive CHECK (Price >= 0.00)
    );
END;
GO

-- 6. Create ProductPriceAudit Table (Append-only Financial Audit History)
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'ProductPriceAudit')
BEGIN
    CREATE TABLE ProductPriceAudit (
        AuditId BIGINT IDENTITY(1,1) NOT NULL,
        ProductId INT NOT NULL,
        OldPrice DECIMAL(18,2) NOT NULL,
        NewPrice DECIMAL(18,2) NOT NULL,
        Currency NVARCHAR(3) NOT NULL,
        ChangedByUserId INT NOT NULL,
        ChangeReason NVARCHAR(500) NOT NULL,
        ChangedAt DATETIME2(7) NOT NULL CONSTRAINT DF_ProductPriceAudit_ChangedAt DEFAULT SYSUTCDATETIME(),
        IpAddress NVARCHAR(45) NULL,
        CONSTRAINT PK_ProductPriceAudit PRIMARY KEY CLUSTERED (AuditId),
        CONSTRAINT FK_ProductPriceAudit_Products FOREIGN KEY (ProductId) REFERENCES Products(ProductId),
        CONSTRAINT FK_ProductPriceAudit_Users FOREIGN KEY (ChangedByUserId) REFERENCES Users(UserId)
    );
END;
GO

-- Performance Indexes
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Products_CategoryId')
    CREATE NONCLUSTERED INDEX IX_Products_CategoryId ON Products(CategoryId) INCLUDE (Name, Price, IsActive);
GO

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Products_IsActive_Price')
    CREATE NONCLUSTERED INDEX IX_Products_IsActive_Price ON Products(IsActive, Price) INCLUDE (Name, SKU, Currency);
GO

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_ProductPriceAudit_ProductId_ChangedAt')
    CREATE NONCLUSTERED INDEX IX_ProductPriceAudit_ProductId_ChangedAt ON ProductPriceAudit(ProductId, ChangedAt DESC);
GO

-- ============================================================================
-- 7. Seed Data (Initial Roles, Users, Categories, and Products)
-- ============================================================================
-- Seed Roles
IF NOT EXISTS (SELECT * FROM Roles WHERE RoleName = 'Admin')
    INSERT INTO Roles (RoleName, Description) VALUES ('Admin', 'System Administrator');
IF NOT EXISTS (SELECT * FROM Roles WHERE RoleName = 'PriceManager')
    INSERT INTO Roles (RoleName, Description) VALUES ('PriceManager', 'Catalog and Pricing Manager');
IF NOT EXISTS (SELECT * FROM Roles WHERE RoleName = 'Customer')
    INSERT INTO Roles (RoleName) VALUES ('Customer');

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

-- Seed Sample Products
DECLARE @ApparelId INT = (SELECT CategoryId FROM Categories WHERE CategoryName = 'Apparel');
DECLARE @FootwearId INT = (SELECT CategoryId FROM Categories WHERE CategoryName = 'Footwear');

IF NOT EXISTS (SELECT * FROM Products WHERE SKU = 'TSHIRT-BLK-01')
    INSERT INTO Products (SKU, Name, Description, CategoryId, Price, Currency)
    VALUES ('TSHIRT-BLK-01', 'Classic Black T-Shirt', 'Premium 100% cotton casual t-shirt', @ApparelId, 24.99, 'USD');

IF NOT EXISTS (SELECT * FROM Products WHERE SKU = 'JEANS-BLU-02')
    INSERT INTO Products (SKU, Name, Description, CategoryId, Price, Currency)
    VALUES ('JEANS-BLU-02', 'Slim Fit Blue Jeans', 'Classic denim slim fit stretch jeans', @ApparelId, 49.99, 'USD');

IF NOT EXISTS (SELECT * FROM Products WHERE SKU = 'SHOES-RUN-03')
    INSERT INTO Products (SKU, Name, Description, CategoryId, Price, Currency)
    VALUES ('SHOES-RUN-03', 'Pro Running Shoes', 'High performance breathable athletic sneakers', @FootwearId, 89.99, 'USD');
GO

-- ============================================================================
-- 8. Stored Procedure: dbo.sp_UpdateProductPrice (Parameterized & Atomic)
-- ============================================================================
CREATE OR ALTER PROCEDURE dbo.sp_UpdateProductPrice
    @ProductId          INT,
    @NewPrice           DECIMAL(18,2),
    @UserId             INT,
    @Reason             NVARCHAR(500),
    @ExpectedRowVersion BINARY(8) = NULL,
    @IpAddress          NVARCHAR(45) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    BEGIN TRY
        -- 1. Begin Transaction BEFORE reading to protect entire sequence
        BEGIN TRANSACTION;

            DECLARE @CurrentPrice DECIMAL(18,2);
            DECLARE @CurrentCurrency NVARCHAR(3);
            DECLARE @CurrentRowVersion BINARY(8);
            DECLARE @ProductIsActive BIT;

            -- 2. Lock and read product with (UPDLOCK, HOLDLOCK)
            SELECT 
                @CurrentPrice = Price,
                @CurrentCurrency = Currency,
                @CurrentRowVersion = RowVersion,
                @ProductIsActive = IsActive
            FROM dbo.Products WITH (UPDLOCK, HOLDLOCK)
            WHERE ProductId = @ProductId;

            -- Check 2a: Target Product Existence
            IF @CurrentPrice IS NULL
            BEGIN
                THROW 50001, 'ProductNotFound: The specified ProductId does not exist.', 1;
            END;

            -- Check 2b: Active Catalog Status
            IF @ProductIsActive = 0
            BEGIN
                THROW 50002, 'ProductInactive: Cannot update price of an inactive product.', 1;
            END;

            -- Check 2c: Optimistic Concurrency Token Verification
            IF @ExpectedRowVersion IS NOT NULL AND @CurrentRowVersion <> @ExpectedRowVersion
            BEGIN
                THROW 50003, 'ConcurrencyConflict: Product was modified by another transaction. Please reload.', 1;
            END;

            -- Check 2d: No-Change Optimization (Early Exit)
            IF @CurrentPrice = @NewPrice
            BEGIN
                COMMIT TRANSACTION;
                SELECT 
                    ProductId, Name, Price, Currency, RowVersion, UpdatedAt,
                    'NO_CHANGE' AS UpdateStatus
                FROM dbo.Products
                WHERE ProductId = @ProductId;
                RETURN;
            END;

            -- 3. Atomic Update: Product Table
            UPDATE dbo.Products
            SET 
                Price = @NewPrice,
                UpdatedAt = SYSUTCDATETIME(),
                UpdatedByUserId = @UserId
            WHERE ProductId = @ProductId;

            -- 4. Atomic Insert: Audit History Ledger
            INSERT INTO dbo.ProductPriceAudit (
                ProductId, OldPrice, NewPrice, Currency,
                ChangedByUserId, ChangeReason, ChangedAt, IpAddress
            )
            VALUES (
                @ProductId, @CurrentPrice, @NewPrice, @CurrentCurrency,
                @UserId, @Reason, SYSUTCDATETIME(), @IpAddress
            );

        COMMIT TRANSACTION;

        -- 5. Return updated product data with fresh RowVersion
        SELECT 
            ProductId, Name, Price, @CurrentPrice AS OldPrice,
            Currency, RowVersion, UpdatedAt,
            'UPDATED' AS UpdateStatus
        FROM dbo.Products
        WHERE ProductId = @ProductId;

    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0
        BEGIN
            ROLLBACK TRANSACTION;
        END;

        THROW;
    END CATCH;
END;
GO

PRINT '========================================================';
PRINT 'TonaireCommerce Database & sp_UpdateProductPrice Ready!';
PRINT '========================================================';
GO
