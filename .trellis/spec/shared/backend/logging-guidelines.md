# Logging Guidelines

> How logging is done in this project.

## Logger

Fastify/Pino via app.log and request.log.

## Log Levels

| Level | When |
|-------|------|
| error | Unhandled exceptions, 5xx errors |
| warn | Recoverable failures |
| info | Server startup (automatic) |
| debug | Development (automatic in dev mode) |

## Structured Logging

Use object-first signature: request.log.warn({ err }, 'message') - the { err } wrapper enables Pino error serialization.

## What NOT to Log

Passwords, password hashes, API keys, session tokens, full sensitive request bodies.

