# Component Guidelines

> Web-specific component patterns for apps/web.

## Overview

See .trellis/spec/shared/frontend/component-guidelines.md for shared conventions. This file documents web-specific patterns.

## Page Components

Each page has a corresponding file in pages/:

- LoginPage - login form with optional GitHub OAuth
- RegisterPage - registration form with optional invite code
- TripListPage - trip card grid with import/export/rename/delete
- PlannerPage - generation form + SSE progress timeline
- TripEditorPage - full trip editor with map, budget, itinerary

## Editor Sub-Components (components/editor/)

- DaySection - collapsible day with activity list
- ActivityCard - single activity display with reorder/move
- ActivityEditDialog - modal form for adding/editing activities
- TripMetaDialog - modal for editing trip metadata
- MapView - Leaflet map with activity markers
- BudgetPanel - budget summary breakdown

## Shared Components (components/)

- Modal - generic <dialog> wrapper
- AppLayout - topbar shell with auth/usage/settings
- ExportMenu - PNG/JSON/Print export dropdown
- GenerationTimeline - multi-phase generation progress
- SettingsDialog - BYOK settings form
- PrintView - print-optimized trip display

