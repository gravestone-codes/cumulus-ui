# AGENTS.md — instructions for any agent working this repo

Source of truth: `roadmap.md` (plan, checklists, locked decisions 1–13, design language §7). UI contract: `design/final.html`. Read the relevant section before acting; never contradict a locked decision — propose a change to the human instead.

## Hard rules (violations fail review)

1. NVUE-native, single vendor. All switch access through one `NvueClient`. No raw fetch elsewhere.
2. Dumb UI: every runtime datum (options, inventory, roles, jobs, manifest) comes from a backend API. No switch-derived constants in UI code. Build-time `packages/spec` sharing is code, exempt.
3. Browsers never touch switches. Backend proxies with the user's own per-switch JWT.
4. Secrets: switch passwords live seconds (mint JWT, then zero). Memory-only, never logged, never persisted. Central denylist redacts logs and audit diffs.
5. Deny-by-default RBAC in `PermissionGate` (proxy). UI hiding is cosmetic.
6. No locks across think time. OCC: per-user branches, presence, apply-time path-overlap check, serialized apply.
7. One object, one store (`get(scope,id)`); paths are lenses. Same shape + new scope reuses the fragment with separate state.
8. One element, one component (`apps/ui/components`, Storybook stories). Screens compose, never copy.
9. Audit everything material: who, roles-at-decision, switch, path+method, before/after diff, rev, job ID. Append-only, hash-chained.
10. Log everything operational as JSON (`ts,level,reqId,user,switch,action,path,ms,outcome,jobId`); `reqId` spans UI→backend→switch.

## Stack

TS monorepo (`apps/ui` React+Vite+Tailwind+shadcn+TanStack, `apps/api` Fastify, `packages/spec` codegen), Postgres, Keycloak. pnpm. Vitest + Supertest + Playwright. Docker Compose dev; distroless multi-arch images; air-gap clean.

## Workflow

- Work `roadmap.md` top to bottom; tick boxes only when done and verified (typecheck, lint, tests; hardware for M1/M1b and RBAC matrix).
- Small diffs. No commits/PRs unless asked. Never add deps without need; never create files the task doesn't require.
- Rule of three before promoting to registry/stores; sunset note for any sanctioned duplicate.
- Backend first (Phases 0–1), then generics, then thin domain slices in dependency order. Shallow across domains before deep in any.

## Code style (open-source scrutiny bar)

- Strict TS, no `any` leaks across boundaries — except orval-nocheck domains (`NOCHECK` in `packages/spec/scripts/postgen.ts`, currently `vrf`), whose schemas are runtime-verified; wrap their `parse()` output in narrow app types at first use.
- zod validates at every trust boundary (`InputGuard` server-side).
- TSDoc, terse: one line of what+why per export; `@param` only if non-obvious; `@throws` on error paths; `@example` only if tricky. No restated signatures, no noise.
- API errors: RFC 9457 problem details. Endpoints: OpenAPI summary + description.
- Errors carry context (reqId, switch, path); never leak secrets in messages.
- Keep responses and diffs small. Explain briefly.

## Testing

- Unit (Vitest) for logic; API tests (Supertest) incl. per-role deny cases; Playwright for login→stage→dry-run→apply and the two-user conflict demo.
- New RBAC path? Add its allow + deny cases. New POST action? Prove it through `ActionRunner`.
