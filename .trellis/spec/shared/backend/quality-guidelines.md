# Quality Guidelines

> Code quality standards for backend development.

## Forbidden Patterns

| Pattern | Why |
|---------|-----|
| any type | Use unknown + type guard |
| process.env direct access | Use validated env.ts |
| console.log in production | Use Fastify logger |
| fetch without AbortSignal.timeout | Risk of hanging |
| require() calls | ESM only |

## Required Patterns

| Pattern | Where |
|---------|-------|
| TypeBox schema for request body | Routes |
| requireAuth preHandler | Protected routes |
| Service layer delegation | Route handlers |
| env.ts for config | Every module |
| structuredClone() for immutable updates | Domain objects |
| AbortSignal.timeout() | External HTTP calls |
| statusCode on error objects | Business logic |

