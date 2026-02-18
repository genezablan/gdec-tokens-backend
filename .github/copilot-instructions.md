# GitHub Copilot Instructions — GDEC Tokens Backend

## Project Overview

**GDEC Tokens** is an internal employee token management system for Great Deals Corporation.
Each employee receives 6 tokens at the start of every year and can spend them on:

- **Task Offloading** — 1 token per OTJ or special project
- **Internal Coaching** — 2 tokens per coaching cycle (3 sessions, same coach)
- **Learning Subsidy** — 1 token = ₱1,000, max ₱3,000 (3 tokens)

All requests go through an approval workflow routed to the employee's immediate supervisor.

---

## Tech Stack

- **Framework**: NestJS 11 with TypeScript
- **Database**: PostgreSQL via TypeORM 0.3 (`synchronize: false` — always use migrations)
- **Auth**: Passport + JWT (7-day access tokens), email-only login, bcrypt passwords
- **Storage**: AWS S3 (`ap-southeast-1`) for form template uploads
- **Email**: AWS SES for approval/rejection notifications
- **Migrations**: `npm run migration:generate` → `npm run migration:run`
- **API Prefix**: `/api`
- **Port**: 3000

---

## Environment Variables

```
DATABASE_HOST=127.0.0.1
DATABASE_PORT=5432
DATABASE_USER=postgres
DATABASE_PASSWORD=Ab7323066
DATABASE_NAME=gdec_tokens

JWT_SECRET=...
JWT_EXPIRES_IN=7d

AWS_REGION=ap-southeast-1
AWS_ACCESS_KEY_ID=<your-aws-access-key-id>
AWS_SECRET_ACCESS_KEY=<your-aws-secret-access-key>
S3_BUCKET_NAME=gdec-tokens

SES_ACCESS_KEY_ID=<your-ses-access-key-id>
SES_SECRET_ACCESS_KEY=<your-ses-secret-access-key>
SES_REGION=ap-southeast-1
SES_FROM_EMAIL=tokens@greatdealscorp.com
EMAIL_FROM_DOMAIN=greatdealscorp.com

FRONTEND_URL=http://localhost:3000
```

---

## Project Structure

```
src/
├── app.module.ts                  # Root module — registers all modules + global guards
├── data-source.ts                 # TypeORM DataSource for migrations CLI
├── main.ts                        # Bootstrap (CORS, global pipes, /api prefix)
│
├── auth/                          # Authentication module
│   ├── auth.controller.ts         # POST /auth/login, GET /auth/me, PATCH /auth/change-password
│   ├── auth.service.ts
│   ├── auth.module.ts
│   ├── strategies/                # local.strategy.ts, jwt.strategy.ts
│   ├── guards/                    # jwt-auth.guard.ts, local-auth.guard.ts, roles.guard.ts
│   ├── decorators/                # @Public(), @Roles(), @CurrentUser()
│   ├── dto/                       # login.dto.ts (LoginDto, ChangePasswordDto)
│   └── interfaces/                # jwt-payload.interface.ts (JwtPayload, AuthResponse)
│
├── common/
│   ├── enums/
│   │   └── user.enum.ts           # All enums: UserRole, EmployeeType, EmployeeStatus,
│   │                              #   Gender, AuthProvider, DevelopmentOptionType, RequestStatus
│   ├── services/
│   │   ├── email.service.ts       # AWS SES wrapper with token notification templates
│   │   └── s3.service.ts          # AWS S3 wrapper for file uploads
│   └── common.module.ts           # Exports EmailService + S3Service globally
│
├── config/
│   ├── database.config.ts         # registerAs('database', ...)
│   ├── s3.config.ts               # registerAs('s3', ...)
│   ├── ses.config.ts              # registerAs('ses', ...)
│   └── index.ts                   # Re-exports all configs
│
├── entities/
│   ├── user.entity.ts             # 395 employees imported, supervisor self-ref FK
│   └── development-option.entity.ts  # Admin-configurable token request types
│
└── migrations/
    ├── 1771296898190-migration.ts  # Initial users table
    ├── 1771297962265-migration.ts  # Employee data adjustments
    ├── 1771298152973-migration.ts  # EmployeeStatus enum additions
    └── 1771386015992-migration.ts  # development_options table (pending run)
```

---

## Entities

### `users` table (395 rows imported)

- `id` UUID PK
- `employeeId` unique (e.g. GDC-001)
- `email` unique — **login identifier**
- `password` bcrypt hashed, default: `TempPass123!`
- `roles` enum array: `employee | coach | approver | admin`
- `immediateSupervisorId` → self-referencing FK for approval routing
- `isPasswordChanged` boolean — forces password change on first login

### `development_options` table (to be seeded after migration)

- `type` enum unique: `task_offloading | coaching | learning_subsidy`
- `tokenCost` integer — **admin-configurable**
- `isActive` boolean — admin can enable/disable
- `rules` JSON — flexible per-type rules (see below)
- `formTemplateUrl` / `formTemplateFileName` — S3 URL for downloadable blank form

#### Default seed data

| type               | name              | tokenCost | rules                                                                   |
| ------------------ | ----------------- | --------- | ----------------------------------------------------------------------- |
| `task_offloading`  | Task Offloading   | 1         | `{ "consecutiveYearRepeatAllowed": false }`                             |
| `coaching`         | Internal Coaching | 2         | `{ "sessionsRequired": 3, "sameCoachRequired": true }`                  |
| `learning_subsidy` | Learning Subsidy  | 3         | `{ "subsidyPerToken": 1000, "maxSubsidyAmount": 3000, "maxTokens": 3 }` |

---

## Enums (src/common/enums/user.enum.ts)

```typescript
UserRole: employee | coach | approver | admin
EmployeeType: Manager | Rank and file | Officer
EmployeeStatus: Regular | Probationary | Resigned | AWOL | Terminated
Gender: Male | Female
AuthProvider: local | microsoft | google
DevelopmentOptionType: task_offloading | coaching | learning_subsidy
RequestStatus: pending | approved | rejected | cancelled
```

---

## Authentication

- Login: `POST /api/auth/login` with `{ email, password }`
- JWT in `Authorization: Bearer <token>` header
- All routes protected by default — use `@Public()` to exempt
- `@Roles(UserRole.ADMIN)` for role-based access
- `@CurrentUser()` decorator to get the logged-in user
- On first login, `requiresPasswordChange: true` is returned — frontend must redirect to change-password

---

## Business Rules

### Token Allocation

- Every employee gets exactly **6 tokens** at the start of each year
- Tokens are tracked in a `token_balances` table (to be built) per `(userId, year)`

### Task Offloading

- Costs **1 token**
- No consecutive-year repeat: approved in year N → cannot re-apply in year N+1

### Internal Coaching

- Costs **2 tokens**
- Must select an employee with `coach` role
- Same coach for all 3 sessions per cycle

### Learning Subsidy

- Costs **1–3 tokens** (1 token = ₱1,000, max ₱3,000)
- Employee specifies the amount; system calculates token cost

### Approval Workflow

- Submitted request → status: `pending`
- Routes to `immediateSupervisor` (user with `approver` role); falls back to any `admin`
- On approve: tokens deducted, email sent to requester
- On reject: email sent with comments, tokens NOT deducted

---

## Coding Conventions

- **Never use `synchronize: true`** — always generate and run migrations
- **No hardcoded business values** — token costs and rules live in `development_options` table
- **Snapshot `tokenCost`** on request creation — admin changing the config must not affect existing requests
- All controllers use `@CurrentUser()` for the authenticated user — never trust user input for `userId`
- All file uploads go through `S3Service.uploadTokenRequestAttachment()`
- All notification emails go through `EmailService`
- DTO validation uses `class-validator` decorators — always `@IsNotEmpty()` + type validators
- Global guards `JwtAuthGuard` + `RolesGuard` are applied in `app.module.ts`
- API responses for lists should include pagination metadata when >20 records expected

---

## Documentation (`docs/`)

Frontend implementation guides live in `docs/`. Each guide covers API endpoints, data models, curl test commands, and step-by-step implementation instructions for an AI frontend agent.

| File                                | Module                                                     |
| ----------------------------------- | ---------------------------------------------------------- |
| `docs/LOGIN_GUIDE.md`               | Auth — login, JWT usage                                    |
| `docs/auth-module-guide.md`         | Auth — full module (login, me, change-password)            |
| `docs/development-options-guide.md` | Development Options — cards, edit, toggle, template upload |
| `docs/AWS_SERVICES_GUIDE.md`        | AWS S3 + SES service wrappers                              |

When creating a new guide, follow the format in `docs/auth-module-guide.md`:

1. Project Brief
2. API Endpoints table (Method / Endpoint / Purpose / Auth Required)
3. Important Notes
4. Data Models (TypeScript interfaces + enums)
5. curl test commands
6. Frontend Requirements (employee view + admin view + shared behavior)
7. Implementation Steps (phased)
8. Success Criteria (Must / Should / Nice to Have)

---

## Pending Work

- [ ] `TokenBalance` entity + module (6 tokens per employee per year)
- [ ] `TokenRequest` entity + module (submit, approve, reject, cancel)
- [ ] `Users` admin module (list, update roles, toggle active)
- [ ] Email notifications wired into approval/rejection flow
