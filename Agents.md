# Repository Guidelines

## Purpose and authority

This repository defines **Trail**, an independent mobile fitness recording and review product. `PRD.md` is the source of truth for v1 product requirements. `product.md` summarizes product intent and decisions, `Architecture.md` defines the target technical design, and `Tasks.md` tracks delivery. If these documents conflict, follow `PRD.md`, record the discrepancy, and update the derived document in the same change.

Do not describe or market Trail as Strava, and do not add social feeds, follows, kudos, comments, clubs, segments, leaderboards, wearable integrations, file imports, subscriptions, or a web application to v1.

## Repository state and target structure

The repository implements the application through the local Phase 8 hardening baseline. Provider deployment, public legal URLs, store approval, measured beta metrics, and physical-device/release evidence remain open. The monorepo layout is:

```text
apps/mobile/          Expo React Native application
apps/api/             Node.js TypeScript REST API
packages/contracts/   Shared API schemas and generated/inferred types
packages/domain/      Pure geo, split, units, and activity calculations
packages/config/      Shared TypeScript/lint configuration
infra/                Local and deployment infrastructure
PRD.md                Authoritative v1 requirements
product.md            Product brief and decision register
Architecture.md       Target system design
Tasks.md              Ordered implementation backlog
ImplementationPlan.md Phase-by-phase execution and delegation gates
```

The implemented baseline is Node 22.23.2, pnpm workspaces, Expo SDK 57 with Expo's React Native version, Fastify, Zod, Drizzle/Postgres, Vitest, ESLint, and Prettier. Local infrastructure is Docker Postgres 17, MinIO, and Mailpit. Keep actual bootstrap and verification commands in the root `README.md`; local implementation evidence does not satisfy external provider, legal/store, beta-metric, or physical-device release gates.

## Engineering principles

- Build offline-first recording. GPS capture and local save must never depend on network availability.
- Treat the local recording session as a durable state machine. Persist filtered points at least every five seconds or every configured point batch and recover after process death.
- Use client-generated UUIDs and idempotent API writes so retries cannot duplicate activities.
- Store canonical values in SI units and UTC. Apply metric/imperial and locale formatting only at presentation boundaries.
- Keep tracks and photos private to their owner. Enforce ownership in the API, not only in the client.
- Never log passwords, tokens, signed URLs, raw GPS tracks, photo metadata, or other sensitive payloads.
- Keep map attribution visible and never use OpenStreetMap Foundation public tile servers for distributed builds.
- Prefer pure, deterministic functions for filtering, distance, elapsed/moving time, splits, elevation smoothing, and unit conversion.
- Keep provider integrations behind interfaces so development and beta map, routing, elevation, email, telemetry, and object-storage providers can differ.
- Enforce stable client UUID idempotency, 100,000 filtered points per activity, retained filtered points in v1, and photo limits of 10 items/10 MB input each through shared Zod contracts.
- Use 15-minute access tokens and rotating 30-day refresh-token families; reuse detection revokes the family.
- Route snapping is deferred from v1. Never substitute a public demo routing API. v1 elevation is smoothed GPS; OpenTopoData is a later self-hosted adapter.
- Beta services are Koyeb free API, Neon free Postgres, Cloudflare R2, Resend SMTP, and OpenFreeMap. Treat Koyeb as no-SLA and scale-to-zero; visible attribution and retry/cold-start UX are mandatory.
- Emit structured logs and OpenTelemetry without raw GPS or media metadata. Sentry/GlitchTip is optional and must be scrubbed before enablement.

## Coding conventions

Use TypeScript in strict mode. Use descriptive names, small modules, explicit domain types, and schema validation at every API boundary. Prefer named exports and avoid default exports unless required by the framework. Use `camelCase` for variables/functions, `PascalCase` for React components and types, and `kebab-case` for route-independent filenames. Database identifiers and API wire fields use `snake_case` only where defined by the contract; map them deliberately rather than mixing conventions.

Do not duplicate product constants across mobile and API. Sports, unit systems, sync states, limits, error codes, and request/response schemas belong in shared contracts. Do not put GPS calculations in React components or HTTP handlers.

## Tests and verification

Every requirement-bearing change should reference one or more PRD IDs such as `REC-7` or `ACT-4`. Add tests at the lowest useful level:

- Unit tests for domain calculations and state transitions.
- API integration tests for authentication, authorization, validation, idempotency, and persistence.
- Mobile integration tests for local recording, sync queue, and recovery.
- Real-device scripts for permissions, background GPS, process death, offline save/upload, and battery behavior.

Before marking work complete, run the repository’s formatter, lint, typecheck, relevant tests, and build commands once they exist. Background recording cannot be accepted from simulator results alone; the 20-minute locked-screen scripts in `PRD.md` and `Tasks.md` are release gates.

## Agent delegation

Use the repository roles by exact `.devin` name:

- **`infrastructure-specialist`** leads Phase 0 and owns CI/CD, environments, deployment, providers, data-service operations, observability, and recovery.
- **`swe-worker`** owns general backend, contracts, domain, data, and cross-cutting implementation.
- **`mobile-specialist`** owns Expo, iOS/Android, local persistence, recording, sync, permissions, and platform behavior.
- **`design-specialist`** owns interaction/UI and accessibility work only when approved design input exists; it does not invent product behavior.
- **`security-specialist`** owns independent authentication, privacy, secret, storage-boundary, and redaction review.
- **`testing-specialist`** owns test strategy, failure-mode coverage, device scripts, and release evidence.
- **`code-reviewer`** independently reviews correctness, maintainability, requirements, and regressions.
- The parent orchestrator owns sequencing, cross-package integration, decision consistency, release gates, external-provider coordination, and final review. Follow `.devin/orchestration.md` for phase leadership/support and keep implementer and reviewer runs independent.

Follow `ImplementationPlan.md` phase gates and commit boundaries. Parallel work is allowed only when contracts are accepted and file ownership does not overlap. Describe local implementation, automated evidence, external dependencies, and release readiness separately; never infer a device, provider, legal, store, or release pass from code or templates.

## Changes, commits, and pull requests

Repository history uses concise imperative Conventional Commit-style subjects (`feat:`, `fix:`, `test:`, `docs:`, and `chore:`); continue that convention and keep commits focused. Pull requests should state the user outcome, PRD IDs, data/API changes, permission or privacy impact, screenshots for UI work, and exact verification performed. Call out migrations, provider dependencies, feature flags, and unresolved risks.

Never commit credentials, provider keys, `.env` files, production GPS data, or user photos. Destructive migrations, account deletion behavior, token changes, and storage cleanup require explicit tests and reviewer attention.

## Definition of done

A task is done only when implementation, migrations/contracts, tests, error and offline states, accessibility, documentation, and observability are addressed as applicable. Update `Tasks.md` status and any affected decision in `Architecture.md` or `product.md`. A v1 feature is not release-ready until its PRD acceptance criteria pass on supported iOS and Android devices.
