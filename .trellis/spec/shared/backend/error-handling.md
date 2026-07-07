# Error Handling

> How errors are handled in this project.

## Overview

- Global handler: Fastify pp.setErrorHandler() - single entry point
- Business errors: throw Error with statusCode property

## API Error Response Format

{ error, detail?, code?, resetAt?, jobId? }

| Status | Use Case |
|--------|----------|
| 400 | Validation, SSRF, business logic |
| 401 | Not authenticated |
| 403 | Forbidden (closed registration) |
| 404 | Not found |
| 409 | Conflict (duplicate, limit, job running) |
| 429 | Rate limit / quota exhausted |
| 500 | Internal server error |

## Common Mistakes

- Throwing Error without statusCode - caught as 500
- reply.send() after reply.hijack() in SSE endpoints

