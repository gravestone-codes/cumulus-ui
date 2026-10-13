# Journeys — Guided Operations Roadmap

> Status: J0–J1 built — frame plus P1, P2, D-R1 (`apps/api/src/journeys/`,
> `apps/ui/src/screens/journeys/`, rail entry above Audit Log). Not yet run on
> hardware. Read `roadmap.md` (locked decisions) and
> `design/final.html` (§7 design language) before implementing; journeys obey
> every hard rule in `AGENTS.md`.

## 1. What a journey is

A **journey** is a navigation-assisted task: an ordered, verifiable path through
screens the app already has. Where today the operator must know that "new VRF"
means _VRFs → SVI → EVPN → BGP → prefix-list → verify_, a journey walks them
screen to screen with each step's inputs pre-scoped and each step verified
before the next unlocks.

Journeys are **choreography, not machinery**. Every step reuses an existing
primitive (forms, stage → dry-run → apply, POST actions, audit). A journey
adds: order, scoping, verification gates, resume, and one audit record linking
the per-switch results.

## 2. Design principles (non-negotiable)

1. **Registry data, not code per journey — eventually.** The target shape is
   declared steps (target screen, prefill, verify, skippable?), one registry
   row per journey. Rule of three: the first two journeys are hand-built on
   existing screens with `TODO promote` notes; the third promotes the frame
   (§5 J0 → J1).
2. **Dry-run native, no locks (decision/rule 6).** Planning steps stage into the
   user's own per-switch branch exactly like a single edit; nothing applies
   before the journey-level review, and nothing is locked while the user
   thinks. Presence shows the open draft to others. At review, the normal
   apply-time path-overlap check runs; if a switch moved under the draft, the
   existing ChangeFlow "switch changed" step handles it (refresh, then redo
   the affected steps with their prefill kept), never a silent overwrite.
   Fixes inside troubleshooting journeys apply per step, always through
   ChangeFlow (diff first).
3. **Verifiable gates.** A step completes only when its verify query passes
   (peer established, prefix present, counters calm) — never on click alone.
4. **Resumable.** Progress persists per user; a reboot mid-upgrade resumes the
   journey, never restarts it. Gates passed before the last apply on a switch
   re-verify on resume (stale evidence never unlocks a step).
5. **Scope-aware.** Switch and group scopes both work; fan-out happens per
   step with per-switch results.
6. **Deny-by-default.** Each step checks capability; a journey with one
   forbidden step shows it locked with the reason, rather than failing midway.
7. **One audit record.** The journey writes a parent entry linking every
   stage/apply/action it ran (who, roles-at-decision, paths, diffs, job IDs).

## 3. Step model (as built)

Source of truth: `apps/api/src/journeys/catalog.ts` (types + registry) and
`engine.ts` (pure decisions). In short:

- **Steps:** `input` (validated fields, optional derived values),
  `change` (templated NVUE writes + a gate), `verify` (a gate with optional
  `onPass` / `onFail` outcomes — the decision-tree branch). A `when` on any
  step skips it unless an earlier value is set (or equals a choice).
- **Refs:** `{{step.name}}` names an earlier value; `{{item}}` the current
  element of an `each` list. In paths a ref fills one encoded segment; a
  whole-string ref in a body keeps its type, list values expand map keys, and
  an empty optional drops its key.
- **Gates:** `{ path, rev?, each?, expect[], capture? }`, read server-side on
  every member through PermissionGate with the caller's own token. `expect`
  ops: `exists` / `absent` (with `except` to ignore a value) and `equals`;
  `*` in `at` matches any key. All members must pass. A read that could not
  run (denied, unreachable) blocks — never branches.
- **Run state:** `in-progress → (blocked ⇄ in-progress) → done`, or
  `abandoned`. Persisted per user (`journey_runs`, optimistic version);
  starting a journey already under way resumes it. Done and abandoned runs
  write one `JOURNEY` audit entry with every step's status and evidence.

Not built yet: `action` steps (POST via ActionRunner — no journey needs one
until O1/O6), gate polling (`timeoutS`; the operator re-checks), views on
gate reads, and re-verifying earlier gates on resume (principle 4).

## 4. Catalog

Backlog, not commitment: only what §5 schedules is planned. Entries that need
data the app does not collect yet are parked in §4.7 until that data exists.

### 4.1 Provisioning (P)

| #   | Journey               | Steps (compressed)                                                                                     |
| --- | --------------------- | ------------------------------------------------------------------------------------------------------ |
| P1  | New VRF end-to-end    | VRF → SVI+gateway → EVPN VNI attach → BGP AF → optional leak (prefix-list + route-map) → verify routes |
| P2  | New server attach     | Bond → MTU/desc → bridge access → MLAG → admin up → verify LLDP + BGP                                  |
| P3  | New VLAN fabric-wide  | VLAN+VNI → attach per switch/group → verify MAC learning                                               |
| P4  | EVPN fabric bring-up  | Underlay BGP → NVE source/shared → EVPN enable → advertise gateway → per-VRF VNI → verify EVPN routes  |
| P5  | MLAG pair setup       | Peer IP + backup → peer-link → shared MAC → verify peer state                                          |
| P6  | External peering      | Neighbor + remote-AS → prefix-list in/out → route-map → soft-clear → verify established + received     |
| P7  | Management onboarding | DNS/NTP (mgmt) → SNMP → syslog → AAA → verify each                                                     |

### 4.2 Operate & maintain (O)

| #   | Journey                   | Steps (compressed)                                                                                            |
| --- | ------------------------- | ------------------------------------------------------------------------------------------------------------- |
| O1  | Switch upgrade            | Pre-checks (health, unsaved) → export config → install image → reboot → verify version/health → rollback path |
| O2  | Config backup/restore     | Export to file → import → diff review → apply                                                                 |
| O3  | Secret rotation           | RADIUS/TACACS → SNMP → verify auth → audit per system                                                         |
| O4  | Port bounce w/ guardrails | Impact warn (MLAG) → clear → bounce → verify link + BGP                                                       |
| O5  | Drain for maintenance     | Maintenance mode → verify shift → work → undrain → verify                                                     |
| O6  | Tech-support bundle       | Generate → poll job → fetch file → attach to audit                                                            |
| O7  | Spine expansion           | Cable map via LLDP → BGP peers → verify ECMP                                                                  |
| O8  | Tenant VRF migration      | Snapshot → target VRF + leak → move gateway → verify → retire                                                 |
| O9  | Blue/green fabric upgrade | Half spines → verify ECMP → flip → rest → verify                                                              |
| O10 | Config convergence        | Diff group → remediate outliers → verify                                                                      |
| O11 | MLAG firmware lockstep    | Parity check → secondary → failover check → primary                                                           |
| O12 | Port capacity review      | Heat by role → flag >70% → propose → apply on approval                                                        |
| O13 | Optics refresh            | Inventory → flag suspect → schedule → verify post-swap                                                        |
| O14 | Subnet rescue             | Detect >85% → expand pool → verify DHCP + routes                                                              |
| O17 | Log pipeline setup        | Servers → levels → verify arrival → silence alert                                                             |
| O18 | Monitoring baseline       | Traps + exporters + sFlow → verify each sink                                                                  |

### 4.3 Diagnose — routing & forwarding (D-R)

| #     | Journey            | Decision spine                                                                                       |
| ----- | ------------------ | ---------------------------------------------------------------------------------------------------- |
| D-R1  | Route leak         | Confirm in victim RIB → trace exporter → check export map → check import map → tighten → verify gone |
| D-R2  | Routing loop       | Traceroute cycle → both RIBs → classify (static/BGP, redistribution, summary) → fix → verify stable  |
| D-R3  | Blackhole          | Counter walk → RIB at dying hop (missing vs recursive) → fix → verify counters move                  |
| D-R4  | Flapping routes    | Scope (prefix vs peer) → link layer → session layer → clear/dampen/replace                           |
| D-R5  | BGP policy misfire | Established but empty → walk maps both sides → fix rule → soft-clear in → verify                     |
| D-R6  | AS-path rejection  | Own-AS in path → scope allow-my-asn or fix origination → verify                                      |
| D-R8  | EVPN route missing | Local MAC ok → VNI both ends → RT match → EVPN AF → underlay → fix link → verify                     |
| D-R9  | MTU blackhole      | Size-sweep ping → walk MTUs (+VXLAN 50B) → align → verify                                            |
| D-R10 | Asymmetric routing | Forward vs reverse trace → divergence hop → document or align                                        |
| D-R11 | ECMP imbalance     | Counter skew → hash entropy vs elephant → reseed/move/add                                            |
| D-R12 | VRRP both-master   | Two masters → Hellos blocked vs timers → open/align → verify                                         |

### 4.4 Diagnose — switching & fabric (D-S)

| #    | Journey                  | Decision spine                                                                         |
| ---- | ------------------------ | -------------------------------------------------------------------------------------- |
| D-S1 | L2 loop/storm            | Spike confirm → STP roles + BPDU guard + MAC flap → shut/guarded → verify decay        |
| D-S2 | MAC flap                 | Bouncing MAC → MLAG vs duplicate IP vs vMotion → fix/suppress                          |
| D-S3 | MLAG split-brain         | Dual primary → backup reachability → shut secondary ports → repair → ordered re-enable |
| D-S4 | Anycast/IP conflict      | ARP flap → anycast-ID/VRR audit → align → verify single MAC                            |
| D-S5 | ARP incomplete           | Subnet/proxy/snooping checks → fix → verify                                            |
| D-S7 | Dying optic              | BER climb + sensor correlation → reseat/clean/replace → verify floor                   |
| D-S8 | Control-plane starvation | CoPP drops → to-CPU breakdown → policer/trap tune → verify stable                      |

### 4.5 Diagnose — services & platform (D-V)

| #    | Journey               | Decision spine                                                              |
| ---- | --------------------- | --------------------------------------------------------------------------- |
| D-V1 | DHCP no-lease         | Discovers vs offers → relay → pool space → return path → fix → verify lease |
| D-V2 | Multicast dead        | (S,G) missing → RP → IGMP joins → RPF → fix → verify tree                   |
| D-V3 | QoS drops, link fine  | Class discards → trust/buffers/PFC → re-mark/ceiling → verify               |
| D-V4 | NTP unsynced          | Stratum stuck → reachability/VRF/iburst/firewall → fix → verify             |
| D-V5 | DNS failing           | Resolve test → servers/VRF/search → fix → verify                            |
| D-V6 | AAA lockout           | Local fallback? → server/secret/order → fix → verify + rotate               |
| D-V7 | Monitoring blind      | Last-seen per sink → creds/destinations/frequency → fix → verify arrival    |
| D-V8 | Multicast PIM scoping | Held for a PIM-heavy follow-up slice                                        |

### 4.6 Lifecycle & governance (L)

| #   | Journey                      | Steps (compressed)                                             |
| --- | ---------------------------- | -------------------------------------------------------------- |
| L1  | RMA replace                  | Export identity → apply to replacement → peer parity verify    |
| L2  | Decommission switch/VLAN/VRF | Reference hunt → dependency-order removal → verify zero refs   |
| L3  | Operator onboarding          | User + role → credentials → trust → test action → sealed audit |
| L6  | Storm drill                  | Spike → policer → decay verify → tune                          |
| L8  | Access review                | Users/roles/classes → approve/revoke → sealed audit            |

### 4.7 Parked — needs data the app does not have yet

| #    | Journey               | Missing data                                               |
| ---- | --------------------- | ---------------------------------------------------------- |
| O15  | Lab-to-prod promotion | An intent model per environment to diff against            |
| O16  | Golden config enforce | A stored golden config per role/group                      |
| D-R7 | Slow convergence      | Convergence-time measurement (event timestamps per prefix) |
| D-S6 | Microburst loss       | Sub-second buffer/queue histograms                         |
| L4   | Failure drill         | An impact model to predict against                         |
| L5   | Power rehearsal       | PSU redundancy state + a safe way to simulate loss         |
| L7   | Buffer audit          | WJH + queue histograms collected over time                 |

## 5. Build order

- **Phase J0/J1 — done:** P1 (VRF), P2 (server attach) and D-R1 (route
  leak) were built together, so the frame was promoted at three consumers
  straight away. Deviations from §4: D-R1 covers VRF-import leaks (there is
  no separate export map to check for those); P2 verifies link and LLDP, not
  BGP. Catalog test (`catalog.test.ts`) pins every write, body key and read to
  the vendored spec. Next: run all three on the lab pair.
- **Phase J2 — operate:** O1 (upgrade), O5 (drain), O2 (backup/restore).
- **Phase J3 — diagnose breadth:** decision-tree engine (branch steps) proven
  on D-R2/D-S1, then the catalog fills in as data.
- **Phase J4 — lifecycle:** L1/L2/L8 once the frame is boring.

## 6. Open questions (need a human)

Built on the proposed defaults; confirm or redirect:

1. Which three hurt most on this floor? Built P1, P2, D-R1 (O1 needs action
   steps and hardware time; it leads J2).
2. Auto-apply? Built as confirm always: every write goes through ChangeFlow's
   review; checks (reads) run on their own.
3. Progress storage: platform DB per user, never shared (`journey_runs`).
4. Evidence: JSON inside the run's audit entry, no separate artifacts.
