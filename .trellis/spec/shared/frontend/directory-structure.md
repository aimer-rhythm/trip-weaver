# Directory Structure

> How frontend code is organized in this project.

## Overview

The frontend packages:
- **apps/web/** - Vite + React SPA (the primary web frontend)
- **packages/shared/** - Types, schemas, constants shared with backend

## Directory Layout (Canonical)

`
apps/web/src/
├── main.tsx                # React entry point
├── App.tsx                 # App shell (QueryClient + Router)
├── router.tsx              # React Router config
├── api/
│   ├── client.ts           # HTTP client wrapper
│   └── hooks.ts            # React Query hooks
├── store/                  # Zustand stores
├── pages/                  # Route-level page components
├── components/             # Reusable UI components
│   ├── editor/             # Trip editor sub-components
│   └── *.tsx               # Other shared components
├── lib/                    # Utility modules
└── styles/                 # Global CSS
`

## Module Rules

- **Pages** are route-level components, one file per route
- **Components** are reusable, one file per component
- **Editor** sub-components live in components/editor/
- **API layer** is centralized: client + hooks
- **Store** is minimal (only editor state)
- **Lib** contains pure utilities

## Naming Conventions

- PascalCase for component files: AppLayout.tsx, ExportMenu.tsx
- camelCase for utility files: client.ts, hooks.ts, xport.ts
- Test files: ComponentName.test.tsx

