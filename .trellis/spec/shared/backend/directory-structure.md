# Directory Structure

> How backend code is organized in this project.

## Overview

The monorepo has two backend-relevant packages:
- packages/shared/ - Domain types, TypeBox schemas, constants
- apps/server/ - Fastify API server

## Directory Layout (Canonical)

apps/<package>/src/
 index.ts              # App bootstrap
 env.ts                # Env validation
 db/
   client.ts           # DB client (Drizzle + driver)
   schema.ts           # Drizzle table definitions
   migrate.ts          # Startup migrations
 routes/               # Fastify route plugins
 services/             # Business logic layer
 lib/                  # Shared utilities
 auth/                 # Auth & authorization
 crypto/               # Encryption
 integrations/         # Third-party adapters
 <domain>/             # Domain subsystems

## Module Rules

- Routes own request/response handling
- Services contain business logic (no Fastify imports)
- Lib has framework-agnostic utilities
- Auth is cross-cutting (guard, session, password, OAuth)
- Integrations are adapter pattern

## Naming

- kebab-case for dirs and files
- One concept per file
- Route files: plural noun (trips.ts)
- Service files: <domain>Service.ts (tripService.ts)

