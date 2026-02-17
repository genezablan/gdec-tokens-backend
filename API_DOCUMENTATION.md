# GDEC Tokens Backend System

A comprehensive NestJS backend system for managing employee tokens within an internal company system. Each employee receives 6 tokens at the beginning of the year to use for Task Offloading, Internal Coaching, and Learning Subsidies, with an integrated approval workflow.

## 📋 Table of Contents

- [Features](#features)
- [System Architecture](#system-architecture)
- [User Roles](#user-roles)
- [Token Types](#token-types)
- [Setup](#setup)
- [API Documentation](#api-documentation)
- [Database Schema](#database-schema)
- [Environment Variables](#environment-variables)

## ✨ Features

- **User Management**: Registration, authentication, and role-based access control
- **Token Allocation**: Automatic allocation of 6 tokens per employee annually
- **Token Requests**: Employees can create requests for different token usage types
- **Approval Workflow**: Multi-role approval system with approvers and admins
- **Transaction History**: Complete audit trail of all token transactions
- **Role Management**: Flexible role assignment (Employee, Coach, Approver, Admin)
- **Token Types**:
  - Task Offloading
  - Internal Coaching
  - Learning Subsidy

## 🏗️ System Architecture

### Modules

1. **Auth Module**: JWT-based authentication and authorization
2. **Users Module**: User management and role assignment
3. **Tokens Module**: Token balance and transaction management
4. **Requests Module**: Token request and approval workflow

### Database Entities

- **User**: Employee information and roles
- **TokenBalance**: Annual token balance per user
- **TokenRequest**: Token usage requests
- **TokenTransaction**: Transaction history and audit trail

## 👥 User Roles

### 1. Employee (Base Role)
- Create token usage requests
- View own token balance and history
- Update/cancel pending requests
- View available coaches

### 2. Coach
- All Employee permissions
- Can be selected for Internal Coaching requests
- Employees with specialized knowledge

### 3. Approver
- All Employee permissions
- Approve/reject token requests
- View all pending requests
- Access approval dashboard

### 4. Admin
- All permissions
- User management (create, update, deactivate)
- Role assignment
- Token allocation and adjustment
- System statistics and reports

**Note**: An employee can have multiple roles simultaneously (e.g., Employee + Coach + Approver)

## 🎫 Token Types

### 1. Task Offloading
Request tokens to offload tasks to other team members or external resources.

**Required Fields**:
- Description
- Tokens required
- Justification (optional)

### 2. Internal Coaching
Request coaching sessions from designated internal coaches.

**Required Fields**:
- Description
- Tokens required
- Coach selection
- Justification (optional)

### 3. Learning Subsidy
Request tokens for learning and development activities.

**Required Fields**:
- Description
- Tokens required
- Justification (optional)

## 🚀 Setup

### Prerequisites

- Node.js (v18 or higher)
- PostgreSQL (v14 or higher)
- npm or yarn

### Installation

1. **Clone the repository**
```bash
git clone <repository-url>
cd gdec-tokens-backend
```

2. **Install dependencies**
```bash
npm install
```

3. **Setup PostgreSQL Database**
```bash
# Create database
createdb gdec_tokens

# Or using psql
psql -U postgres
CREATE DATABASE gdec_tokens;
```

4. **Configure Environment Variables**
```bash
cp .env.example .env
```

Edit `.env` with your configuration:
```env
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_USER=postgres
DATABASE_PASSWORD=your_password
DATABASE_NAME=gdec_tokens

JWT_SECRET=your-super-secret-jwt-key
JWT_EXPIRES_IN=24h

PORT=3000
NODE_ENV=development
```

5. **Run the application**
```bash
# Development mode
npm run start:dev

# Production mode
npm run build
npm run start:prod
```

The API will be available at `http://localhost:3000/api`

## 📚 API Documentation

### Authentication Endpoints

#### Register
```http
POST /api/auth/register
Content-Type: application/json

{
  "email": "john.doe@company.com",
  "password": "SecurePass123",
  "firstName": "John",
  "lastName": "Doe",
  "department": "Engineering",
  "position": "Senior Developer"
}
```

#### Login
```http
POST /api/auth/login
Content-Type: application/json

{
  "email": "john.doe@company.com",
  "password": "SecurePass123"
}

Response:
{
  "user": { ... },
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

#### Get Profile
```http
GET /api/auth/profile
Authorization: Bearer <token>
```

#### Change Password
```http
POST /api/auth/change-password
Authorization: Bearer <token>
Content-Type: application/json

{
  "oldPassword": "OldPass123",
  "newPassword": "NewPass123"
}
```

### User Management Endpoints

#### Get All Users (Admin Only)
```http
GET /api/users?includeInactive=false
Authorization: Bearer <token>
```

#### Get User by ID
```http
GET /api/users/:id
Authorization: Bearer <token>
```

#### Get All Coaches
```http
GET /api/users/coaches
Authorization: Bearer <token>
```

#### Create User (Admin Only)
```http
POST /api/users
Authorization: Bearer <token>
Content-Type: application/json

{
  "email": "jane.smith@company.com",
  "firstName": "Jane",
  "lastName": "Smith",
  "department": "Marketing",
  "position": "Manager",
  "roles": ["employee", "coach"]
}
```

#### Update User Roles (Admin Only)
```http
PUT /api/users/:id/roles
Authorization: Bearer <token>
Content-Type: application/json

{
  "roles": ["employee", "coach", "approver"]
}
```

#### Update User Status (Admin Only)
```http
PUT /api/users/:id/status
Authorization: Bearer <token>
Content-Type: application/json

{
  "isActive": false
}
```

### Token Management Endpoints

#### Get My Token Balance
```http
GET /api/tokens/my-balance
Authorization: Bearer <token>
```

#### Get My Balance History
```http
GET /api/tokens/my-history
Authorization: Bearer <token>
```

#### Get My Transactions
```http
GET /api/tokens/my-transactions
Authorization: Bearer <token>
```

#### Get All Balances (Admin Only)
```http
GET /api/tokens/balances
Authorization: Bearer <token>
```

#### Allocate Tokens to All Users (Admin Only)
```http
POST /api/tokens/allocate-all
Authorization: Bearer <token>
Content-Type: application/json

{
  "tokens": 6,
  "year": 2026
}
```

#### Adjust User Tokens (Admin Only)
```http
POST /api/tokens/adjust/:userId
Authorization: Bearer <token>
Content-Type: application/json

{
  "adjustment": 2,
  "notes": "Bonus tokens for exceptional performance"
}
```

### Request Management Endpoints

#### Create Token Request
```http
POST /api/requests
Authorization: Bearer <token>
Content-Type: application/json

{
  "type": "task_offloading",
  "tokensRequired": 2,
  "description": "Need help with debugging production issue",
  "justification": "Critical bug affecting customers"
}

// For coaching requests
{
  "type": "internal_coaching",
  "tokensRequired": 1,
  "description": "React performance optimization coaching",
  "coachId": "uuid-of-coach"
}
```

#### Get My Requests
```http
GET /api/requests/my-requests
Authorization: Bearer <token>
```

#### Get All Requests (Approver/Admin Only)
```http
GET /api/requests?status=pending&type=task_offloading
Authorization: Bearer <token>
```

#### Get Pending Requests (Approver/Admin Only)
```http
GET /api/requests/pending
Authorization: Bearer <token>
```

#### Update Request
```http
PUT /api/requests/:id
Authorization: Bearer <token>
Content-Type: application/json

{
  "description": "Updated description",
  "tokensRequired": 3
}
```

#### Approve Request (Approver/Admin Only)
```http
POST /api/requests/:id/approve
Authorization: Bearer <token>
Content-Type: application/json

{
  "approvalNote": "Approved. Good justification."
}
```

#### Reject Request (Approver/Admin Only)
```http
POST /api/requests/:id/reject
Authorization: Bearer <token>
Content-Type: application/json

{
  "approvalNote": "Please provide more details about the learning course."
}
```

#### Cancel Request
```http
DELETE /api/requests/:id
Authorization: Bearer <token>
```

#### Get Request Statistics (Admin Only)
```http
GET /api/requests/statistics
Authorization: Bearer <token>
```

## 🗄️ Database Schema

### Users Table
- id (UUID, Primary Key)
- email (Unique)
- password (Hashed)
- firstName
- lastName
- department
- position
- roles (Array of UserRole enum)
- isActive
- createdAt
- updatedAt

### Token Balances Table
- id (UUID, Primary Key)
- userId (Foreign Key)
- totalTokens
- availableTokens
- usedTokens
- pendingTokens
- year
- createdAt
- updatedAt

### Token Requests Table
- id (UUID, Primary Key)
- type (Enum: task_offloading, internal_coaching, learning_subsidy)
- tokensRequired
- description
- justification
- status (Enum: pending, approved, rejected, cancelled)
- approvalNote
- approvedAt
- requesterId (Foreign Key)
- approverId (Foreign Key, nullable)
- coachId (Foreign Key, nullable)
- createdAt
- updatedAt

### Token Transactions Table
- id (UUID, Primary Key)
- type (Enum: allocation, usage, refund)
- amount
- balanceBefore
- balanceAfter
- notes
- userId (Foreign Key)
- requestId (Foreign Key, nullable)
- createdAt

## 🔐 Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| DATABASE_HOST | PostgreSQL host | localhost |
| DATABASE_PORT | PostgreSQL port | 5432 |
| DATABASE_USER | Database username | postgres |
| DATABASE_PASSWORD | Database password | - |
| DATABASE_NAME | Database name | gdec_tokens |
| JWT_SECRET | JWT signing secret | - |
| JWT_EXPIRES_IN | JWT expiration time | 24h |
| PORT | Application port | 3000 |
| NODE_ENV | Environment | development |

## 🧪 Testing

```bash
# Unit tests
npm run test

# E2E tests
npm run test:e2e

# Test coverage
npm run test:cov
```

## 📝 Workflow Example

1. **Admin Setup** (Start of Year)
   - Admin allocates 6 tokens to all active employees
   - Admin assigns Coach and Approver roles to designated employees

2. **Employee Creates Request**
   - Employee checks available token balance
   - Creates a token request (e.g., 2 tokens for Task Offloading)
   - Tokens are immediately reserved (pending)

3. **Approval Process**
   - Approver reviews pending requests
   - Approver can approve or reject with notes
   - If approved: tokens move from pending to used
   - If rejected: tokens are refunded to available balance

4. **Token Usage**
   - Employee can track all transactions
   - Admin can generate reports and statistics
   - Balance automatically updates with each approval/rejection

## 🛠️ Development

### Project Structure
```
src/
├── auth/              # Authentication module
├── common/            # Shared decorators, guards, enums
├── config/            # Configuration files
├── entities/          # TypeORM entities
├── requests/          # Request management module
├── tokens/            # Token management module
├── users/             # User management module
├── app.module.ts      # Root module
└── main.ts            # Application entry point
```

## 📄 License

UNLICENSED - Internal Company Use Only

## 🤝 Support

For issues or questions, contact the development team.
