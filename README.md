# Cumulus — NVUE console

Open-source UI + API proxy for NVIDIA Cumulus Linux (NVUE `/nvue_v1`).

- Plan and decisions: `roadmap.md` (checklists — work top to bottom)
- Agent rules: `AGENTS.md`
- UI contract: `design/final.html` (options archive: `design/index.html`)

## Quickstart

```sh
pnpm install
docker compose up -d db keycloak
pnpm --filter @cumulus/api dev   # :3000
pnpm --filter @cumulus/ui dev    # vite
```

Verify: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
