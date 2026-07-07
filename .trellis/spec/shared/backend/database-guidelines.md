# Database Guidelines

> Database patterns and conventions for this project.

## Overview

- ORM: Drizzle ORM with better-sqlite3 driver
- Database: SQLite (WAL mode)
- Migrations: Idempotent CREATE TABLE at startup via side-effect import

## Naming Conventions

| Element | Convention | Example |
|---------|-----------|---------|
| Table name | snake_case, plural | trips, user_settings |
| Column name | snake_case | password_hash, created_at |
| Primary key | text('id').primaryKey() | UUID strings |
| Timestamps | integer, Unix ms | created_at, expires_at |
| Booleans | integer 0/1 | byok_enabled, used_xhs |

## Query Patterns

- .get() for single row, .all() for multiple, .run() for mutations
- JSON blob in data TEXT column with redundant summary columns
- Use nd(...) for compound WHERE clauses

## Common Mistakes

- Forgetting .run() on inserts/updates
- Using .all() when .get() is enough
- Not using nd() for compound WHERE clauses

