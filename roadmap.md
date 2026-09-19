# Cumulus NVUE UI — Build Roadmap

> Spec: NVUE OpenAPI for Cumulus Linux 5.14.0 (`openapi.json`, OAS3, base `/nvue_v1`)
> 1,648 paths · GET 1564 / PATCH 1089 / DELETE 1089 / POST 169 (actions)
> Pattern: `GET/PATCH/DELETE` per path + `?rev=` + `?include/?omit` + `?view=` · writes need pending rev · apply via `POST /config` · jobs via `GET /action`

## Locked decisions (don't relitigate; build to these)

1. **Single vendor (NVUE-native).** No generic driver framework. All switch access goes through one `NvueClient` module — `?rev`, `?view`, pending→apply are first-class, not abstracted away.
2. **Platform users, switch credentials as an extension. No IdP, no redirects, no service accounts.** Users are created in our UI (or the create-admin CLI); login is username + scrypt password. Each user extends with per-switch device logins (`switch_credentials`, AES-GCM sealed). Switch access mints a JWT from the stored credential; plaintext passwords live only for the mint call, JWTs only in memory. Same switch accounts work over SSH/CLI, so app-dead = use the CLI directly.
3. **A full-fledged backend: the browser never talks to switches; the backend makes every NVUE call on the UI's behalf.** Four reasons that can't live in a browser: (a) custom RBAC must be enforced server-side (hiding buttons ≠ enforcement — the user controls the browser); (b) the audit log must be server-written to be immutable/complete; (c) TOFU cert pinning can't be done by browsers (users would click through warnings per switch); (d) input validation/sanitization and group fan-out aggregation need a trusted place. The backend does **no auth transformation** — it proxies the user's own JWT.
4. **Our RBAC is finer than the switch's, and admins can extend it.** Ship default roles; admins create custom roles (methods + path prefixes + scope) in-app. `PermissionGate` evaluates the stored roles deny-by-default.
5. **One code path per object identity, not per URL path.** Paths are lenses; stores are canonical (§2). Same object → same code _and_ same state. Same shape but different scope (global BGP vs VRF BGP) → shared fragment, separate state keyed by `(scope, id)`.
6. **Concurrency = D365-style OCC.** No locks across think time, ever. Per-user staging branches + presence (soft) + apply-time path-overlap check (hard) + serialized apply moment. See §4.
7. **Fleet = groups, and writes fan out.** Inventory is grouped (datacenter → role, e.g. `DC1`, `DC1-leaf`, `DC1-spine`). Top-bar toggle selects the visible scope; mirrored configs stage preview + apply across a chosen group with per-switch results.
8. **Dry-run is the default; danger is classified.** Every apply shows its diff first (pending vs applied). Dangerous actions require typed confirmation per the classification in §6.6.
9. **Stack: TypeScript end-to-end monorepo.** `apps/ui` (React + Vite SPA + Tailwind + shadcn/Radix + TanStack Query/Table + react-hook-form/zod + ) · `apps/api` (Fastify) · `packages/spec` (manifest + generated types + zod schemas shared by `InputGuard` and forms). Postgres. One language, one codegen from `openapi.json`, no client/server drift.
10. **HARD RULE — dumb UI: all runtime data comes from the backend.** The browser never contacts switches (decision 3) and never hardcodes operational data: dropdown options, table contents, inventory/groups, roles/capabilities, jobs, audit, even the spec manifest itself are served by backend APIs (`/api/manifest`, `/api/me/capabilities`, `/api/inventory`, …) and TanStack Query caches them. UI gating hints come from `/api/me/capabilities`; enforcement stays in `PermissionGate`. Build-time sharing (`packages/spec` types/schemas compiled into both apps) is code, not data, and is unaffected — the rule governs runtime. A screen with a hardcoded switch-derived constant fails review.
11. **Serving & API shape.** Backend serves the UI static bundle same-origin + `/api/v1/...` (versioned from day one). UI→backend auth is httpOnly session cookie (`SameSite=strict`). Live events (job progress, presence, out-of-band banners) over SSE, REST poll as fallback. English-only strings; UTC storage, local display. Per-switch concurrency caps + per-user rate limits in `FanOut` so the UI can never storm the fleet.
12. **Logging: everything, structured.** JSON to stdout: `ts, level, reqId, user, switch, action, path, ms, outcome, jobId`. `reqId` propagates UI→backend→switch. Levels: debug (payloads/diffs, redacted) · info (login/logout, token mint metadata only, stage/apply/action outcomes, denials) · warn (conflicts, stale base, retries) · error (failures + stack). Central secret denylist redacts before logging — passwords, keys, tokens, communities never hit logs or audit diffs. Debug-log retention short (collector, ~30d); the hash-chained audit trail is separate (90d, PG).
13. **Method docs: TSDoc, terse.** Every export gets one line of what+why; `@param` only when non-obvious; `@throws` on error paths; `@example` only when tricky. No signature restatements, no noise comments. API errors use RFC 9457 problem details. Endpoints carry OpenAPI summary/description. Enforced by eslint + review, not essay writing.

- React SPA, not Next.js: everything is session-scoped dynamic data behind a cookie session — SSR buys nothing and complicates auth. Not Svelte/Vue: smaller AI corpus, smaller contributor pool, weaker headless-component ecosystem.
- shadcn (copy-into-repo Radix + Tailwind), not MUI/Ant: components live in our repo as ownable code AI can read and modify — no fighting a library's release train or theme system.
- Tests: Vitest (unit, both apps) + Supertest (API incl. RBAC matrix) + Playwright (critical flows).

## How to use this file

- Work **top to bottom**. Each `- [ ]` is one task. Mark `- [x]` when done.
- **Definition of done** for every task: works against fixtures **and** hardware (we have hardware — no heavy mock simulation), driven by the spec manifest (no hardcoded paths outside the registry/stores), and reuses registry blocks (§3).
- **Promotion rule (rule of three):** first use builds concrete in its home phase, second use tolerates duplication with a `// TODO promote: <registry-name>` note, third use promotes to the registry. Don't canonize a block before two consumers exist.
- **Core + adapter:** shared blocks own the dumb core; domain extras live in thin domain adapters. No `specialCase` flags in shared code.
- **Sunset exception:** a local duplicate is allowed only with a written sunset note (`why the registry block doesn't fit + merge-back milestone`). Unnoted duplicates are rejected.

---

## 1. Build strategy: why not "finish Interfaces, then Bridge"?

Domains share the same physical objects. A bond created under Interfaces is attached under Bridge, consumed by EVPN/MLAG, and filtered by ACL/QoS. Building domains as sealed units guarantees duplicated creators.

So we build in **two alternating motions**:

1. **Horizontal (primitives first):** build each shared creator/picker **once**, in its home phase (§3 registry). A bond, an MLAG peer, a VLAN attachment, a VRF attachment each have exactly one implementation, forever.
2. **Vertical (thin slices, in dependency order):** each domain ships as a **thin slice** — read → action → write — consuming already-built primitives. We go _shallow across all domains_ before going _deep in any one_. Depth passes come later and still consume the registry.

Dependency order for slices (a domain's slice may only consume primitives/slices above it):

```
Interfaces (physical + bond primitive)
  → Bridge/VLAN (attaches interfaces/bonds)
    → VRF (attaches interfaces/bonds/bridges)
      → VXLAN/EVPN+NVE (needs VRF + bridge)
        → MLAG (needs bonds + VXLAN anycast)
          → Routing/BGP (needs VRF + interfaces/peers)
            → ACL/QoS (attach to everything above)
System / Services / Platform-health run in parallel (mostly independent)
```

---

## 2. Identity stores (one per object — URL paths are just lenses)

**Rule: normalize by identity; parameterize by path.** Every store exposes `get(scope, id)`; any screen resolves its path to a `(scope, id)` and calls the canonical method. If two fetchers ever return the same identity, one of them dies. Scope now has two axes: `switch` (or group, for aggregated reads) and domain scope (`global` vs `vrf=blue`).

| #   | Canonical store                                           | Identity key                                                                       | Reached via (lenses, non-exhaustive)                                                                               |
| --- | --------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| S1  | `InterfaceStore` (incl. bonds — a bond _is_ an interface) | `(switch, interface-id)`                                                           | `/interface/{id}`, bridge member lists, VRF attachments, MLAG, EVPN, ACL/QoS tabs                                  |
| S2  | `VrfStore`                                                | `(switch, vrf-id)`                                                                 | `/vrf/{id}` (the object) vs `/vrf/{id}/router/…` (scoped views of it — same cached `blue`, never a second fetcher) |
| S3  | `BgpState` + shared `BgpPeerFragment`                     | `(switch, scope, id)` — `global` vs `vrf=blue` share the _fragment_, never _state_ | `/router/bgp…` and `/vrf/{id}/router/bgp…` (distinct envelopes, shared peer/neighbor sub-schemas per spec)         |
| S4  | `BridgeStore`                                             | `(switch, domain-id)`                                                              | `/bridge/domain/{id}`, interface/EVPN attachment views                                                             |
| S5  | `MlagStore`, `EvpnStore`, `AclStore`, `QosStore`          | their natural ids per switch                                                       | their domain paths + cross-domain references                                                                       |
| S6  | `SystemStore`, `PlatformStore`, `ServiceStore`            | singleton-ish per switch                                                           | dashboard cards + domain screens                                                                                   |

Granularity note (finer than D365 F&O, which conflicts on whole records): overlap is checked at **path level** — `bond0/description` vs `bond0/mtu` auto-merge; only same-path writes collide.

---

## 3. Shared block registry (single source of truth)

| #   | Canonical block                                                                                                                                                                                                                                              | Home phase | Consumed by                                                |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | ---------------------------------------------------------- |
| R1  | `ConnectionManager` (fleet inventory + groups, `/nvue_v1` base, TOFU cert pinning)                                                                                                                                                                           | 0          | everything                                                 |
| R2a | `PlatformAuth` (UI-created users, scrypt passwords, opaque cookie sessions, rolling idle expiry; create-admin CLI bootstraps the first admin)                                                                                                                | 0          | everything                                                 |
| R2b | `UserSwitchSession` (per-session capture of the user's own switch password → per-switch JWT via `GET /api-token`; password zeroed immediately after mint, JWT only thereafter in memory; invisible re-issue on expiry)                                       | 0          | everything                                                 |
| R2c | `PermissionGate` (deny-by-default evaluation of stored roles: methods + path prefixes + scope; proxy-level, never UI-only)                                                                                                                                   | 0          | everything                                                 |
| R2d | `RoleManager` (shipped default roles + admin custom-role CRUD; roles are data, not code)                                                                                                                                                                     | 0          | `PermissionGate`, admin UI                                 |
| R2e | `AuditLog` (append-only, immutable; user id, roles-at-decision, switch, path+method, before/after diff, rev, job ID; admin-configurable retention days)                                                                                                      | 0          | all writes/actions                                         |
| R3  | `Transport` (`NvueClient`: `?rev`, `?include/?omit`, `?view`, typed errors; **no raw fetch outside it**) + `InputGuard` (server-side manifest-driven validation/sanitization of UI payloads: unknown fields rejected, formats normalized)                    | 0          | everything                                                 |
| R4  | `RevisionManager` (per-user/session branches: `POST /revision?base_rev`, records base applied-ID; block PATCH without a branch; TTL + orphan GC)                                                                                                             | 1          | all writes                                                 |
| R5  | `ApplyPipeline` (per-switch **apply queue** → base+overlap check → dry-run diff → `POST /config` → poll `GET /action`)                                                                                                                                       | 1          | all writes                                                 |
| R6  | `ActionRunner` (generic POST-action button + confirm + job link, driven by spec; danger class from §6.6 decides confirm style)                                                                                                                               | 1          | clear counters, clear BGP, clear MAC, LED, tech-support, … |
| R7  | `ResourceList` (generic collection table + search + field picker)                                                                                                                                                                                            | 2          | all domains                                                |
| R8  | `ResourceDetail` (generic header + tab slots for widgets)                                                                                                                                                                                                    | 2          | all domains                                                |
| R9  | `ResourceForm` (schema-driven PATCH form from `x-defs`)                                                                                                                                                                                                      | 2          | all writes                                                 |
| R10 | `ViewSwitcher` (`?view=` dropdown from spec enum)                                                                                                                                                                                                            | 2          | interface, bgp, …                                          |
| R11 | `InterfacePicker` (select existing interface → resolves to `S1` identity)                                                                                                                                                                                    | 2          | bridge, vrf, evpn, mlag, bgp, acl, qos                     |
| R12 | `BondBuilder` (canonical bond creator; a bond is an `S1` object)                                                                                                                                                                                             | 3A         | bridge, evpn, mlag, acl                                    |
| R13 | `VlanAttachment` (attach interface/bond to bridge domain/VLAN)                                                                                                                                                                                               | 3B         | bridge, evpn                                               |
| R14 | `VrfAttachment` (attach interface/bridge to VRF)                                                                                                                                                                                                             | 3C         | evpn, bgp                                                  |
| R15 | `MlagBuilder` (canonical MLAG creator; consumes R12, never reimplements it)                                                                                                                                                                                  | 3E         | interfaces, vxlan                                          |
| R16 | `BgpPeerEditor` (peer-group/neighbor fragment for `S3`, both scopes)                                                                                                                                                                                         | 3F         | global + per-VRF bgp                                       |
| R17 | `AclBinder` (bind ACL to interface, in/out)                                                                                                                                                                                                                  | 3G         | interfaces                                                 |
| R18 | `QosAttacher` (attach QoS profile to interface)                                                                                                                                                                                                              | 3G         | interfaces                                                 |
| R19 | `Presence` (heartbeat per `(switch, path)`: who has it open / has unapplied staged changes + link to their staged diff)                                                                                                                                      | 1          | all edit screens                                           |
| R20 | `ConflictScreen` (mine vs theirs vs current, field-level auto-merge where disjoint, forced choice where not, rebase + re-confirm)                                                                                                                            | 1          | `ApplyPipeline`                                            |
| R21 | `DiffPreview` (dry-run: staged-branch vs applied diff, per switch; shown before every apply and inside the confirm modal)                                                                                                                                    | 1          | `ApplyPipeline`, `ActionRunner` (where meaningful)         |
| R22 | `FanOut` (group-targeted writes for mirrored configs: stage same payload on N switches → aggregated per-switch diffs → apply with per-switch job tracking and per-switch results; partial failure is reported per switch, siblings are NOT auto-rolled back) | 1          | mirrored/templated writes, user provisioning across groups |

Shipped default roles (customizable via R2d; roles live entirely in the backend):

| Role           | Reads                                                         | Writes                                           | Apply/actions                                                                                            | Scope                                                   |
| -------------- | ------------------------------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `viewer`       | all GET                                                       | none                                             | none                                                                                                     | assigned groups                                         |
| `net-operator` | all GET                                                       | PATCH interface/bridge/vrf/bgp/evpn/mlag/acl/qos | POST actions except dangerous class; **no** `POST /config` (stages, can't apply)                         | assigned groups                                         |
| `net-admin`    | all GET                                                       | all PATCH                                        | apply + all actions incl. dangerous with typed confirm                                                   | assigned groups                                         |
| `sys-admin`    | all GET                                                       | all incl. `/system/aaa`, images, packages        | all                                                                                                      | all groups                                              |
| `app-admin`    | User/role/group management, retention setting, poll intervals | —                                                | —                                                                                                        | app-level                                               |
| `auditor`      | all GET + read/export audit logs                              | none                                             | none                                                                                                     | assigned groups (audit reads may span groups per grant) |
| `noc`          | all GET                                                       | none                                             | safe operational actions only (counter clears, tech-support generation, LED locate) — no PATCH, no apply | assigned groups                                         |

---

## 4. Concurrency spec (D365 F&O-shaped OCC — the whole design in one place)

Modelled on Dynamics 365 F&O: optimistic concurrency is mandatory for interactive editing; nothing is ever held across user think time; the write carries its version and fails cleanly on staleness (`UPDATE … WHERE RecVersion=Y` → `UpdateConflict`). Bonus over F&O: branches are per-user _and_ per-user-identity on the switch, so attribution is exact on both sides.

- [ ] 4.1 Our `RecVersion` = applied-revision ID captured at branch creation. `RevisionManager` records `(user, switch, branch, base-applied-id)` per editing session.
- [ ] 4.2 Staging is free and isolated: each editing session gets its **own branch**. Two users drafting the same object never touch each other's work.
- [ ] 4.3 `Presence` (R19): opening an object someone else is staging shows a **non-blocking** banner with a link to their staged diff (`GET ?rev=<their-branch>`). Coordination over locking.
- [ ] 4.4 Apply is the only serialized moment: per-switch `ApplyPipeline` queue (our `ttsBegin/ttsCommit` — seconds long, never think-time). Fan-out applies (R22) queue per switch independently.
- [ ] 4.5 Apply-time check per branch: (a) is `applied` still my base? (b) do my staged paths overlap what landed since? Disjoint → auto-apply. Same-path overlap → `ConflictScreen` (R20). First to apply wins; second rebases. Loser's draft survives as a branch (better than F&O, where the loser retypes).
- [ ] 4.6 Out-of-band detection: poll the applied-revision ID per switch (lightweight); only on change fetch the full state. Interval admin-adjustable, polling organized by group. Unexpected movement → "switch changed outside the app" banner; refresh required before new edit sessions (CLI/direct-API writers are just another lane).
- [ ] 4.7 Strict-mode toggle (per domain or per switch, default OFF): "refuse staging when another unapplied branch touches these paths" — the A10-NSO `abort-when-config-session-exist` behavior, opt-in.
- [ ] ✅ **Milestone M1b (two-user demo, on hardware):** Alice + Bob stage the same object on separate branches; Alice applies; Bob gets the conflict screen with both diffs; Bob rebases and applies. No data loss, no locks.

---

## Phase 0 — Baseplate (nothing else starts until this is done)

- [x] 0.0 Monorepo scaffold + codegen pipeline: `apps/ui` (React + Vite + Tailwind + shadcn + TanStack Query), `apps/api` (Fastify), `packages/spec`; `openapi.json` → TypeScript types + zod schemas (single source for `InputGuard` and forms); Docker Compose dev (api + postgres); multi-arch distroless images; air-gap acceptance (pinned bases, vendored npm cache, zero first-boot downloads); CI (typecheck, lint, Vitest, Playwright skeleton, lockfile + dep audit, minimal dep surface)
- [x] 0.1 Vendor `openapi.json` into repo (`spec/`), record version `1.10.0.93`
- [x] 0.2 Build spec-manifest script: extract path tree, verbs, `?view` enums, top segments + counts; output `manifest.json`
- [x] 0.3 Verify manifest regenerates cleanly (re-run script, diff is empty)
- [x] 0.4 `ConnectionManager` (R1): fleet inventory (switches, `DC`/`role` groups e.g. `DC1-leaf`, who can add/remove), base-path selector, **TOFU cert pinning** (record fingerprint at enrolment, hard-fail on mismatch)
- [x] 0.5 `PlatformAuth` (R2a): UI-created users + scrypt login → opaque sessions; create-admin CLI seeds the first admin
- [x] 0.6 `UserSwitchSession` (R2b): switch credentials stored per user per switch (AES-GCM) → per-switch JWT minted on connect; memory-only JWTs; re-mint on expiry from stored creds (no re-prompt). Passwords may differ per switch; group fan-out provisions the same login across switches.
- [x] 0.7 `Transport` (R3) as the single `NvueClient` + `InputGuard` (manifest-driven server validation/sanitization)
- [x] 0.8 `PermissionGate` (R2c) + `RoleManager` (R2d): roles as data, shipped defaults (§3 table), admin custom-role CRUD; deny-by-default tests per role (run against hardware)
- [x] 0.9 `AuditLog` (R2e): append-only immutable sink (hash-chained), full schema, **admin-configurable retention days (default 90)**, read/export permissions, scheduled chain-verification job. (Pass-through auth means switch-side logs also carry the real user — our log remains the compliance record.)
- [x] 0.10 Fixtures (thin): static per-path fixtures for UI dev only. No branch/apply simulation — workflow truth comes from hardware.

## Phase 1 — Workflow engine (the NVUE-specific risk; prototype early, on hardware)

- [x] 1.1 `RevisionManager` (R4): per-user branches + base-ID recording. Hygiene (recommended): branch TTL 7 days + nightly orphan GC; logout **keeps** drafts (listed as "my drafts" next login); explicit discard with confirm; stale-base routes to `ConflictScreen`, never silent drop.
- [ ] 1.2 Branch banner UI: visible active branch per editing session + discard path
- [x] 1.3 `ApplyPipeline` (R5): queue → overlap check → `DiffPreview` → danger-class confirm modal (§6.6) → `POST /config` → poll `GET /action`. Pre-apply snapshot: record base applied-ID + fetch full applied state as the rollback reference for every apply.
- [x] 1.4 `ActionRunner` (R6): generic driver for the 169 POSTs; confirm style follows danger class; prove with `clear interface counters`
- [x] 1.5 `Presence` (R19) + `ConflictScreen` (R20): per §4
- [x] 1.6 `DiffPreview` (R21): dry-run diff (staged vs applied) per switch, shown before every apply
- [x] 1.7 `FanOut` (R22): group-targeted mirrored writes — stage same payload per switch (own branch each), aggregated diffs, per-switch apply tracking; partial-failure semantics per §3 (no sibling auto-rollback)
- [x] 1.8 Cache keyed on `(switch, path, rev, view)`; identity stores (S1–S6) sit above the cache
- [ ] ✅ **Milestone M1:** single user can create branch → PATCH one field → dry-run → apply → see job, against hardware
- [ ] ✅ **Milestone M1b:** two-user conflict demo per §4

## Phase 2 — Generic bricks (build once, configure forever)

- [ ] 2.0 Component catalog (Storybook): one story per §7 element; visual contract + visual-regression CI later

- [ ] 2.1 `ResourceList` (R7): columns from schema, search, `?include` field picker; prove on `GET /interface`; group-aware (aggregate across in-scope switches)
- [ ] 2.2 `ResourceDetail` (R8): header + empty tab slots for widgets; resolves path → store identity (§2)
- [ ] 2.3 `ResourceForm` (R9): schema-driven PATCH form (enums→selects, refs→subforms); prove on one interface field
- [ ] 2.4 `ViewSwitcher` (R10): `?view=` dropdown from spec enum; prove on interface `status/counters/lldp/rates`
- [ ] 2.5 `InterfacePicker` (R11): searchable selector resolving to `S1` identity (foundation for every later domain)
- [ ] 2.6 Delete-with-confirm (generic DELETE, path echo; danger class decides confirm style)
- [ ] ✅ **Milestone M2:** any collection path in the manifest renders as list→detail→edit with zero hand-written forms

## Phase 3 — Domain thin slices (in dependency order; shallow before deep)

### 3A — Interfaces (foundation; thin, NOT complete)

- [ ] 3A.1 List: `GET /interface` via `ResourceList` (status, type filters)
- [ ] 3A.2 Detail: `GET /interface/{id}` via `ResourceDetail` → `S1`
- [ ] 3A.3 Views: wire `?view=status/counters/lldp/rates/neighbor` via `ViewSwitcher`
- [ ] 3A.4 Counters widget (custom) + clear-counters via `ActionRunner` (`POST …/counters`)
- [ ] 3A.5 LLDP neighbor tab (custom read widget)
- [ ] 3A.6 `BondBuilder` (R12) — canonical, lives here, writes `S1` objects: create bond + members via `InterfacePicker`, PATCH with `?rev`
- [ ] 3A.7 Basic edit: description/MTU/speed via `ResourceForm` + branch + dry-run + apply
- [ ] ⏸️ STOP: interfaces are usable, not finished. ACL/QoS tabs arrive in 3G as consumers.

### 3B — Bridge / VLAN (first consumer of interfaces + bonds)

- [ ] 3B.1 List/detail: `GET /bridge/domain…` via generics → `S4`
- [ ] 3B.2 `VlanAttachment` (R13): attach interface/bond (via `InterfacePicker` → `S1`, bonds via `BondBuilder` — **import, don't rebuild**)
- [ ] 3B.3 MAC-table view + clear-dynamic-MAC via `ActionRunner` (POST)
- [ ] 3B.4 STP tab (read + edit via `ResourceForm`)
- [ ] ✅ **Identity check:** zero bond state in bridge; all bonds resolve to `S1`

### 3C — VRF (attaches everything above)

- [ ] 3C.1 List/detail: `GET /vrf…` via generics → `S2`
- [ ] 3C.2 `VrfAttachment` (R14): attach interface/bridge/loopback to VRF
- [ ] 3C.3 Per-VRF IP/loopback edit via `ResourceForm`
- [ ] 3C.4 Route-table read view

### 3D — VXLAN / EVPN + NVE (needs VRF + bridge)

- [ ] 3D.1 Global + per-VNI views: `GET /evpn…`, `/nve…` via generics
- [ ] 3D.2 L3VNI wiring: connect VRF ↔ bridge via R13/R14 (no new pickers)
- [ ] 3D.3 DAD status widget + clear-DAD-duplicate via `ActionRunner` (POST)
- [ ] 3D.4 Encapsulation/source/flooding edit via `ResourceForm`

### 3E — MLAG (needs bonds + VXLAN)

- [ ] 3E.1 Status/read: `GET /mlag…` (peer, bonds, FDB, LACP DB)
- [ ] 3E.2 `MlagBuilder` (R15) — canonical, lives here; consumes `BondBuilder`, never reimplements it
- [ ] 3E.3 LACP-conflict clear via `ActionRunner` (POST)
- [ ] ✅ **Identity check:** MLAG bond handling resolves to `S1`; VXLAN anycast references 3D state

### 3F — Routing / BGP (needs VRF + interfaces)

- [ ] 3F.1 Global BGP read: `GET /router/bgp` (summary widget: ASNs, peers up/down)
- [ ] 3F.2 `BgpPeerEditor` (R16): peer-group/neighbor fragment for `S3`, both scopes
- [ ] 3F.3 Per-VRF BGP: `/vrf/{id}/router/bgp…` reusing R16 (**no second peer editor; separate state per scope**)
- [ ] 3F.4 BGP clear actions (in/out/soft, per-neighbor/peer-group) via `ActionRunner`
- [ ] 3F.5 OSPF/PIM thin read (tables via generics; depth later)
- [ ] 3F.6 FIB lookup (`POST /vrf/{id}/router/fib…`) as query widget

### 3G — ACL / QoS (attach to everything; deliberately last)

- [ ] 3G.1 ACL rule lists: `GET /acl…` via generics + rule editor via `ResourceForm`
- [ ] 3G.2 `AclBinder` (R17): bind ACL to interface in/out (consumes `InterfacePicker` → `S1`)
- [ ] 3G.3 QoS profiles: `GET /qos…` via generics
- [ ] 3G.4 `QosAttacher` (R18): attach profile to interface
- [ ] 3G.5 Backfill: interface detail gains ACL + QoS tabs (consumers of R17/R18 — interface file barely changes)

### 3H — System / Services / Platform (parallel track, anytime after M2)

- [ ] 3H.1 Dashboard: health cards from `/system`, `/platform`, `/mlag`, `/router/bgp` summaries, aggregated across the selected group/DC
- [ ] 3H.2 Platform health: fans/PSU/sensors/transceivers + LED action (POST) via `ActionRunner`
- [ ] 3H.3 System forms: AAA/users (switch-local + break-glass accounts live here; humans' daily identities stay in the platform user table), NTP, DNS, syslog, SNMP via `ResourceForm`
- [ ] 3H.4 System actions: images, tech-support, ZTP, packages via `ActionRunner`
- [ ] 3H.5 Services: DHCP-relay, PTP, NTP via generics
- [ ] 3H.6 Cross-switch user provisioning (the DC1-leaf + DC1-spine case): `FanOut` (R22) over `/system/aaa/user…` with per-switch results

## Phase 4 — Shell (makes it a product; after ≥2 domains prove the generics)

- [ ] 4.1 AppShell: nav = domains, **DC/group toggle in the top bar** (drives scope for every list, store, and fan-out target), branch banner (R4), user + roles from the platform session
- [ ] 4.2 Command palette: `⌘K` across manifest paths + live IDs (`/interface/swp1`), scoped to the current DC/group
- [ ] 4.3 Notifications fed by `ApplyPipeline` + `GET /action` jobs (per-switch, per-fan-out-member)
- [ ] 4.4 Settings (app-admin): defaults for `rev`/`view`, strict-mode toggle, poll intervals, retention days

## Phase 5 — Depth passes (only after all thin slices exist)

- [ ] 5.1 Second-pass widgets per domain (whatever proved most painful in slices)
- [ ] 5.2 Bulk operations (multi-interface PATCH with ranges, per spec)
- [ ] 5.3 Audit/diff view: staged-branch changes before apply (reads from `AuditLog` + branch diff)
- [ ] 5.4 Dangerous-action gating per §6.6 classification (role + typed confirm; no second approver, per decision)
- [ ] 5.5 Polish: empty/loading/error states unified, keyboard nav, docs

---

## 6. Decided items (were open questions; resolutions recorded)

- [x] 6.1 Custom RBAC: ship defaults (§3 table), admins build custom roles via `RoleManager` (methods + path prefixes + scope, stored as data). Users and roles both live in the backend.
- [x] 6.2 No vault, no service accounts, no IdP. Switch passwords are sealed per user per switch (AES-GCM, SWITCH_CRED_KEY); plaintext exists only inside mint calls. App-dead login = SSH/CLI with your own switch account.
- [x] 6.3 Backend stays (thin BFF): RBAC enforcement, immutable audit, TOFU pinning, `InputGuard` validation, fan-out. Browsers can do none of these trustworthily. TOFU: pin fingerprint at enrolment, hard-fail on change.
- [x] 6.4 Fleet = groups (`DC → role`); top-bar scope toggle; mirrored writes via `FanOut` (R22), e.g. one user-provisioning payload to `DC1-leaf` + `DC1-spine` with per-switch results.
- [x] 6.5 Revision hygiene (recommended, pending your sign-off): 7-day branch TTL + nightly orphan GC; logout keeps drafts ("my drafts"); stale base → conflict screen, never silent drop; explicit discard with confirm.
- [x] 6.6 Dry-run default (`DiffPreview` before every apply) + two-step kept (stage → confirm modal → apply). Danger classification:
  | Class             | Examples                                                                                             | Gate                                                                                                                                      |
  | ----------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
  | Routine           | description, DNS/NTP, read-only-safe forms, counter clears                                           | confirm modal with diff                                                                                                                   |
  | Service-affecting | bond/VLAN/VRF/BGP/EVPN/MLAG changes, any `POST /config` apply, peer clears                           | confirm modal with diff + explicit "affects traffic" acknowledgement                                                                      |
  | Dangerous         | reboot, factory-reset, firmware/image ops, AAA + break-glass changes, `system packages`, cert import | elevated role + **typed confirmation** (type object name) + diff. Second approval explicitly rejected — typed confirmation is sufficient. |
- [x] 6.7 Polling: lightweight applied-revision-ID check per switch; full fetch only on change. Interval admin-adjustable, polling organized by group (defaults: 30s per group, tunable).
- [x] 6.8 Audit: append-only immutable (hash-chained) log, complete (every proxied write + action + decision context), retention = admin-configurable days (default 90) with scheduled purge.
- [x] 6.9 Fixtures only for UI dev; workflow truth comes from hardware. M1/M1b run on lab switches (provisioned at test time).
- [x] 6.10 RBAC harness runs proxy-level tests against hardware (lab switches) at every milestone.
- [x] 6.11 Session UX: rolling cookie sessions while active (idle timeout kills the session); re-login redirect when idle.

---

## 7. Design language (locked 2026-09-19 — from user picks on the options page)

Tokens (OWL dark warm): `bg #100e0c · surface #1a1714 · surface-2 #241f1a · text #f6f3ef · muted #9c958b · border #36312b · brand #cabfb0 · pass #4fb19d · warn #e0a93c · fail #e0556b`. Type (Paper Light rules): Inter, semibold tight headings (`-0.02em`), tabular numerals. Motion (Midnight Ops): deliberate ~400–450ms, reduced-motion respected. Reference render: `design/final.html` (options archive: `design/index.html`).

- Tables (GRG): show/hide columns, ↑↓ reorder on hover (never drag), first column `always`-pinned, Reset, prefs in localStorage; small badges; rows animate on hover; stone scrollbar thumb on hover.
- Buttons (GRG + fix): full-width inverted primary, press-down active, brand focus ring; Cancel is bordered secondary; danger is solid fail.
- Forms (GRG, wordless): underline line-fields, label only, zero helper prose; SVG eye icons only (never emoji/images); invalid = red underline + one error line; **max 2 questions per form** — longer objects become stepped wizards.
- Dropdowns (OWL behavior, line trigger): underline trigger with end-corner chevron; portal menu, search past 7 items, arrow-key + Enter nav.
- Modals (OWL): centered, blurred backdrop, Esc/backdrop/✕ close.
- Notifications (Paper Light, single-colour): neutral cards, only the icon carries severity — toasts and banners alike.
- Navigation (OWL +): collapsible icon rail (persisted), hand-drawn SVG icon set.
- Login (GRG, no glow): centered card, line fields, SVG eye, spinner submit.
- Pagination (OWL): range readout + rows-per-page + ‹ n/m › footer; functional component, not a mock.
- Danger gating (§6.6) uses typed-confirm inside the D modal; dry-run diffs render in B-style tabular numerals.
- **One element, one component, forever.** Each item above ships as exactly one canonical component in `apps/ui/components` (shadcn-style, owned code): `DataTable` (list + customize + pagination), `Button`, `LineField`/`ResourceForm`, `LineDropdown`, `Modal`/`ConfirmModal`, `Toaster`/`Alert`, `NavRail`, `LoginCard`, motion tokens + `ScrollArea`. Screens compose them; no screen owns private copies. Catalogued in Storybook (Phase 2, task 2.0) as the visual contract — the final.html decisions become stories, stories become CI.

---

## DRY enforcement checklist (run at every milestone)

- [ ] No second fetcher for an existing store identity (search by id-type before building)
- [ ] Same shape + different scope reuses the fragment with separate `(scope, id)` state (S3 pattern)
- [ ] New domain work imports pickers/builders; it does not copy them
- [ ] New `?view=` support is config in `ViewSwitcher`, not a new component
- [ ] New POST action works through `ActionRunner` with no custom code unless its body schema forces it (then extend `ActionRunner`, don't fork it)
