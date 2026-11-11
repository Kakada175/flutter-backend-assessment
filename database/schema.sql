-- ============================================================================
-- Assessment Submission: Tonaire Digital Co., Ltd.
-- Candidate: Chhem Kakada
-- Tech Stack: Flutter + Node.js/Express + SQL Server
-- File: database/schema.sql
-- Description: Database schema DDL and parameterized T-SQL price update script
-- ============================================================================

-- 1. Create Roles Table
CREATE TABLE Roles (
    RoleId INT IDENTITY(1,1) NOT NULL,
    RoleName NVARCHAR(50) NOT NULL,
    Description NVARCHAR(255) NULL,
    CreatedAt DATETIME2(7) NOT NULL CONSTRAINT DF_Roles_CreatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_Roles PRIMARY KEY CLUSTERED (RoleId),
    CONSTRAINT UQ_Roles_RoleName UNIQUE (RoleName)
);

-- 2. Create Users Table
-- Assumption: Single-role model per user (Users.RoleId -> Roles.RoleId) for clear, 
-- lightweight junior assessment scope. For multi-role scenarios, a UserRoles junction 
-- table (UserId, RoleId) can be introduced.
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

-- 3. Create Categories Table
CREATE TABLE Categories (
    CategoryId INT IDENTITY(1,1) NOT NULL,
    CategoryName NVARCHAR(100) NOT NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_Categories_IsActive DEFAULT 1,
    CreatedAt DATETIME2(7) NOT NULL CONSTRAINT DF_Categories_CreatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_Categories PRIMARY KEY CLUSTERED (CategoryId),
    CONSTRAINT UQ_Categories_CategoryName UNIQUE (CategoryName)
);

-- 4. Create Products Table (Core Catalog with Optimistic Concurrency Control)
CREATE TABLE Products (
    ProductId INT IDENTITY(1,1) NOT NULL,
    SKU NVARCHAR(50) NOT NULL,
    Name NVARCHAR(200) NOT NULL,
    Description NVARCHAR(MAX) NULL,
    CategoryId INT NOT NULL,
    Price DECIMAL(18,2) NOT NULL,
    Currency NVARCHAR(3) NOT NULL CONSTRAINT DF_Products_Currency DEFAULT 'USD',
    IsActive BIT NOT NULL CONSTRAINT DF_Products_IsActive DEFAULT 1,
    RowVersion ROWVERSION NOT NULL, -- Automatic 8-byte binary token for optimistic concurrency control
    CreatedAt DATETIME2(7) NOT NULL CONSTRAINT DF_Products_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedAt DATETIME2(7) NOT NULL CONSTRAINT DF_Products_UpdatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedByUserId INT NULL,
    CONSTRAINT PK_Products PRIMARY KEY CLUSTERED (ProductId),
    CONSTRAINT UQ_Products_SKU UNIQUE (SKU),
    CONSTRAINT FK_Products_Categories FOREIGN KEY (CategoryId) REFERENCES Categories(CategoryId),
    CONSTRAINT FK_Products_Users_UpdatedBy FOREIGN KEY (UpdatedByUserId) REFERENCES Users(UserId),
    CONSTRAINT CK_Products_Price_Positive CHECK (Price >= 0.00)
);

-- 5. Create ProductPriceAudit Table (Append-only Financial Audit History)
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

-- Performance Indexes
CREATE NONCLUSTERED INDEX IX_Products_CategoryId ON Products(CategoryId) INCLUDE (Name, Price, IsActive);
CREATE NONCLUSTERED INDEX IX_Products_IsActive_Price ON Products(IsActive, Price) INCLUDE (Name, SKU, Currency);
CREATE NONCLUSTERED INDEX IX_ProductPriceAudit_ProductId_ChangedAt ON ProductPriceAudit(ProductId, ChangedAt DESC);

-- ============================================================================
-- Section D: Targeted Parameterized T-SQL Price Update Pattern (CORRECTED)
-- ============================================================================
-- CRITICAL CONCURRENCY FIX:
-- Transaction starts BEFORE the initial SELECT with (UPDLOCK, HOLDLOCK) so that
-- the lock is acquired and held for the entire read-check-update-audit sequence.
-- ============================================================================

/*
DECLARE @ProductId INT = 101;
DECLARE @NewPrice DECIMAL(18,2) = 29.99;
DECLARE @UserId INT = 3;
DECLARE @Reason NVARCHAR(500) = N'Supplier price increase Q4';
DECLARE @ExpectedRowVersion BINARY(8) = NULL; -- Optional optimistic lock token
DECLARE @IpAddress NVARCHAR(45) = N'192.168.1.50';
*/

SET NOCOUNT ON;
SET XACT_ABORT ON; -- Ensure immediate rollback on fatal query abort

BEGIN TRY
    -- 1. Begin Transaction IMMEDIATELY before reading state
    BEGIN TRANSACTION;

        DECLARE @CurrentPrice DECIMAL(18,2);
        DECLARE @CurrentCurrency NVARCHAR(3);
        DECLARE @CurrentRowVersion BINARY(8);
        DECLARE @ProductIsActive BIT;

        -- 2. Lock and read product with UPDLOCK, HOLDLOCK
        -- HOLDLOCK ensures the update lock is held until the transaction completes,
        -- preventing any other concurrent transaction from acquiring an update or exclusive lock.
        SELECT 
            @CurrentPrice = Price,
            @CurrentCurrency = Currency,
            @CurrentRowVersion = RowVersion,
            @ProductIsActive = IsActive
        FROM dbo.Products WITH (UPDLOCK, HOLDLOCK)
        WHERE ProductId = @ProductId;

        -- Check 2a: Product Existence
        IF @CurrentPrice IS NULL
        BEGIN
            THROW 50001, 'ProductNotFound: The specified ProductId does not exist.', 1;
        END;

        -- Check 2b: Active Catalog Status
        IF @ProductIsActive = 0
        BEGIN
            THROW 50002, 'ProductInactive: Cannot update price of an inactive or archived product.', 1;
        END;

        -- Check 2c: Optimistic Concurrency Token Verification
        IF @ExpectedRowVersion IS NOT NULL AND @CurrentRowVersion <> @ExpectedRowVersion
        BEGIN
            THROW 50003, 'ConcurrencyConflict: Product was modified by another transaction. Please reload.', 1;
        END;

        -- Check 2d: No-Change Optimization (Early Exit)
        -- If price is already equal to target, commit and exit without generating redundant audit log
        IF @CurrentPrice = @NewPrice
        BEGIN
            COMMIT TRANSACTION;

            SELECT 
                ProductId,
                Name,
                Price,
                Currency,
                RowVersion,
                UpdatedAt,
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
            ProductId,
            OldPrice,
            NewPrice,
            Currency,
            ChangedByUserId,
            ChangeReason,
            ChangedAt,
            IpAddress
        )
        VALUES (
            @ProductId,
            @CurrentPrice,
            @NewPrice,
            @CurrentCurrency,
            @UserId,
            @Reason,
            SYSUTCDATETIME(),
            @IpAddress
        );

    -- 5. Commit Transaction cleanly
    COMMIT TRANSACTION;

    -- 6. Return refreshed product data with new RowVersion token
    SELECT 
        ProductId,
        Name,
        Price,
        @CurrentPrice AS OldPrice,
        Currency,
        RowVersion,
        UpdatedAt,
        'UPDATED' AS UpdateStatus
    FROM dbo.Products
    WHERE ProductId = @ProductId;

END TRY
BEGIN CATCH
    -- Clean transaction state check and rollback
    IF XACT_STATE() <> 0
    BEGIN
        ROLLBACK TRANSACTION;
    END;

    -- Re-throw the original error preserving error code, message and stack
    THROW;
END CATCH;
