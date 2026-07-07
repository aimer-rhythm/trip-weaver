# Directory Structure

> Web-specific directory structure for apps/web.

## Overview

apps/web is a Vite + React SPA. See .trellis/spec/shared/frontend/directory-structure.md for the canonical layout.

## Key Tech Stack

- **Vite** (build tool)
- **React 19** with hooks
- **React Router 7** (createBrowserRouter)
- **@tanstack/react-query** (server state)
- **Zustand** (editor state)

## Page Routing

`
/ - Redirects to /trips
/trips - TripListPage
/trips/new - PlannerPage (generate new trip)
/trips/:id - TripEditorPage (edit existing trip)
/login - LoginPage
/register - RegisterPage
`

