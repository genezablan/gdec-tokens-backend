# GDEC Tokens Backend

A NestJS-based backend system for managing internal company tokens. Employees receive 6 tokens at the beginning of each year to use for Task Offloading, Internal Coaching, or Learning Subsidies.

## 🎯 System Overview

The GDEC Tokens System allows employees to:

- Use tokens for various services (Task Offloading, Coaching, Learning Subsidy)
- Submit token requests with an approval workflow
- Track token usage and balance throughout the year
- Manage employee roles (Employee, Coach, Approver, Admin)

## 🚀 Tech Stack

- **Framework**: NestJS 11.0.1
- **Database**: PostgreSQL with TypeORM 0.3.28
- **Authentication**: JWT + Passport.js (Local & OAuth ready)
- **Validation**: class-validator & class-transformer
- **Password Hashing**: bcrypt
- **Excel Processing**: xlsx (for employee data import)

## 📚 Documentation

- **[Login API Guide](./docs/LOGIN_GUIDE.md)** - Simple, copy-paste ready login flow for AI agents or quick integration
- **[Authentication Module Guide](./docs/auth-module-guide.md)** - Complete frontend implementation guide for authentication, including API reference, data models, test commands, and integration requirements

## ⚡ Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Database Setup

Create a PostgreSQL database and configure your `.env` file:

```env
# Database Configuration
DB_HOST=127.0.0.1
DB_PORT=5432
DB_USERNAME=postgres
DB_PASSWORD=your_password
DB_NAME=gdec_tokens

# JWT Configuration
JWT_SECRET=your_jwt_secret_key_here
JWT_EXPIRES_IN=7d
JWT_REFRESH_EXPIRES_IN=7d

# OAuth (optional, currently disabled)
# GOOGLE_CLIENT_ID=your_google_client_id
# GOOGLE_CLIENT_SECRET=your_google_client_secret
# MICROSOFT_CLIENT_ID=your_microsoft_client_id
# MICROSOFT_CLIENT_SECRET=your_microsoft_client_secret
```

### 3. Run Migrations

```bash
npm run migration:run
```

### 4. Import Employee Data (Optional)

If you have employee data in Excel format:

```bash
npm run import:employees
npm run import:ops-gmail
npm run link:supervisors
npm run verify:data
```

### 5. Start the Server

```bash
# Development with watch mode
npm run start:dev

# Production mode
npm run start:prod
```

The API will be available at `http://localhost:3000/api`

### 6. Test Authentication

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "gm.zablan@greatdealscorp.com", "password": "TempPass123!"}'
```

## 🏗️ Project Structure

```
src/
├── auth/                    # Authentication module
│   ├── decorators/         # @Public, @Roles, @CurrentUser decorators
│   ├── dto/                # Login, ChangePassword DTOs
│   ├── guards/             # JWT, Local, Roles guards
│   ├── interfaces/         # JWT payload interfaces
│   └── strategies/         # Passport strategies (JWT, Local)
├── common/
│   └── enums/              # User roles, status, gender, etc.
├── entities/               # TypeORM entities
│   └── user.entity.ts      # User/Employee entity
├── migrations/             # TypeORM migrations
├── scripts/                # Data import scripts
├── app.module.ts           # Main application module
├── data-source.ts          # TypeORM configuration
└── main.ts                 # Application entry point

docs/
├── LOGIN_GUIDE.md         # Simple login API guide (copy-paste ready)
└── auth-module-guide.md   # Comprehensive frontend implementation guide
```

## 📦 Available NPM Scripts

### Development

```bash
npm run start           # Start application
npm run start:dev       # Start with watch mode
npm run start:debug     # Start with debug mode
```

### Database Migrations

```bash
npm run migration:generate  # Generate new migration
npm run migration:run       # Run pending migrations
npm run migration:revert    # Revert last migration
```

### Data Import

```bash
npm run import:employees    # Import from main employee sheet
npm run import:ops-gmail    # Import from Ops Gmail sheet
npm run link:supervisors    # Link supervisor relationships
npm run verify:data         # Verify data integrity
```

### Testing

```bash
npm test                # Unit tests
npm run test:e2e        # E2E tests
npm run test:cov        # Test coverage
```

### Build

```bash
npm run build           # Build for production
npm run start:prod      # Run production build
```

## 🔐 Authentication

The system uses JWT-based authentication with the following features:

- **Local Authentication**: Login with email
- **Password Management**: First-time password change enforcement
- **Token Refresh**: Automatic token refresh mechanism
- **Role-Based Access Control**: Employee, Coach, Approver, Admin roles
- **OAuth Ready**: Google and Microsoft OAuth prepared (currently disabled)
- **Long-lived Tokens**: Access tokens valid for 7 days

**Default Test Credentials:**

- Email: `gm.zablan@greatdealscorp.com`
- Employee ID: `202409-09`
- Password: `TempPass123!`

See [Authentication Module Guide](./docs/auth-module-guide.md) for complete API documentation and frontend implementation guide.

## 🔧 Current Features

### ✅ Completed

- User/Employee entity with relationships
- JWT authentication (access & refresh tokens)
- Local login (email or employee ID)
- Password change workflow with first-time detection
- Role-based access control with guards
- Supervisor hierarchy (356 relationships established)
- Employee data import from Excel (395 employees)
- Protected routes with decorators (@Public, @Roles, @CurrentUser)
- Global authentication guards

### 🚧 In Progress

- Token balance management
- Token request submission
- Approval workflow system

### 📋 Planned

- Token allocation (6 per employee per year)
- Request types: Task Offloading, Coaching, Learning Subsidy
- Multi-level approval routing
- Transaction history and audit trail
- Dashboard and reporting

## 📊 Database Schema

### Users Table

- Employee information and authentication
- Self-referencing supervisor relationship
- Role assignments (employee, coach, approver, admin)
- OAuth provider support (Google, Microsoft)
- Password change tracking

See [TypeORM migrations](./src/migrations) for complete schema.

## 🤝 Contributing

This is an internal company project. For questions or support, contact the development team.

## 📄 License

Proprietary - Great Deals E-Commerce Corporation
