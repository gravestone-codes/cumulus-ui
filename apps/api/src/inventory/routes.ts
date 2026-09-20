/**
 * Inventory routes (roadmap 0.4 + 0.8 gate). Every route resolves the caller
 * from the session cookie and passes PermissionGate; denials are audited.
 * Material writes are audited with before/after.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { problem } from '../lib/problems.js';
import { type AuthConfig } from '../auth/config.js';
import { resolveCaller } from '../auth/caller.js';
import { gateCheck, getUserRoles } from '../rbac/store.js';
import { audit } from '../audit/store.js';
import {
  confirmTrust,
  createGroup,
  createSwitch,
  deleteSwitch,
  getSwitch,
  listGroups,
  listSwitches,
  markSeen,
  setSwitchGroups,
} from './store.js';
import { requireAppAdmin } from '../users/routes.js';
import { setSwitchCredential } from '../users/store.js';

export interface InventoryDeps {
  cfg: AuthConfig;
}

/** Map zod/pg failures to problem+json. Detail is safe: schemas echo shapes, never secrets. */
function fail(reply: FastifyReply, err: unknown, instance: string) {
  if (err instanceof z.ZodError) {
    return problem(
      reply,
      400,
      'Bad Request',
      err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      instance,
    );
  }
  const code = (err as { code?: string }).code;
  if (code === '23505') return problem(reply, 409, 'Conflict', 'id already exists', instance);
  if (code === '23503')
    return problem(reply, 400, 'Bad Request', 'referenced group does not exist', instance);
  throw err;
}

interface Gate {
  sub: string;
  username: string;
  roleIds: string[];
}

/** Session + gate. Returns null after answering 401/403 (denials audited). */
async function gate(request: FastifyRequest, reply: FastifyReply, cfg: AuthConfig): Promise<Gate | null> {
  const who = await resolveCaller(request, cfg);
  if (!who) {
    void problem(reply, 401, 'Unauthorized', 'no active session', request.url);
    return null;
  }
  const roles = await getUserRoles(who.sub);
  const roleIds = roles.map((r) => r.id);
  if (!gateCheck(roles, { method: request.method, path: request.url })) {
    await audit({
      userSub: who.sub,
      username: who.username,
      roles: roleIds,
      method: request.method,
      path: request.url,
    });
    void problem(reply, 403, 'Forbidden', 'not granted by any role', request.url);
    return null;
  }
  return { sub: who.sub, username: who.username, roleIds };
}

export async function inventoryRoutes(app: FastifyInstance, deps: InventoryDeps): Promise<void> {
  const { cfg } = deps;

  app.get('/api/v1/inventory/switches', async (request, reply) => {
    const g = await gate(request, reply, cfg);
    if (!g) return reply;
    return listSwitches();
  });

  app.post('/api/v1/inventory/switches', async (request, reply) => {
    const g = await gate(request, reply, cfg);
    if (!g) return reply;
    try {
      const sw = await createSwitch(request.body);
      await audit({
        userSub: g.sub,
        username: g.username,
        roles: g.roleIds,
        switchId: sw.id,
        method: 'POST',
        path: request.url,
        after: sw,
      });
      return reply.code(201).send(sw);
    } catch (err) {
      return fail(reply, err, '/api/v1/inventory/switches');
    }
  });

  app.put('/api/v1/inventory/switches/:id/groups', async (request, reply) => {
    const g = await gate(request, reply, cfg);
    if (!g) return reply;
    const { id } = request.params as { id: string };
    const parsed = z.object({ groups: z.array(z.string()) }).safeParse(request.body);
    if (!parsed.success) return fail(reply, parsed.error, request.url);
    try {
      const before = await getSwitch(id);
      await setSwitchGroups(id, parsed.data.groups);
      await audit({
        userSub: g.sub,
        username: g.username,
        roles: g.roleIds,
        switchId: id,
        method: 'PUT',
        path: request.url,
        before: before?.groups,
        after: parsed.data.groups,
      });
      return { ok: true };
    } catch (err) {
      return fail(reply, err, request.url);
    }
  });

  app.delete('/api/v1/inventory/switches/:id', async (request, reply) => {
    const g = await gate(request, reply, cfg);
    if (!g) return reply;
    const { id } = request.params as { id: string };
    const before = await getSwitch(id);
    if (!before) return problem(reply, 404, 'Not Found', `no switch ${id}`, request.url);
    await deleteSwitch(id);
    await audit({
      userSub: g.sub,
      username: g.username,
      roles: g.roleIds,
      switchId: id,
      method: 'DELETE',
      path: request.url,
      before,
    });
    return { ok: true };
  });

  app.get('/api/v1/inventory/groups', async (request, reply) => {
    const g = await gate(request, reply, cfg);
    if (!g) return reply;
    return listGroups();
  });

  app.post('/api/v1/inventory/groups', async (request, reply) => {
    const g = await gate(request, reply, cfg);
    if (!g) return reply;
    try {
      const group = await createGroup(request.body);
      await audit({
        userSub: g.sub,
        username: g.username,
        roles: g.roleIds,
        method: 'POST',
        path: request.url,
        after: group,
      });
      return reply.code(201).send(group);
    } catch (err) {
      return fail(reply, err, '/api/v1/inventory/groups');
    }
  });

  app.post('/api/v1/inventory/switches/:id/trust', async (request, reply) => {
    const g = await gate(request, reply, cfg);
    if (!g) return reply;
    const { id } = request.params as { id: string };
    const parsed = z.object({ fingerprint: z.string().min(1) }).safeParse(request.body);
    if (!parsed.success)
      return problem(reply, 400, 'Bad Request', 'compared fingerprint required', request.url);
    if (!(await confirmTrust(id, parsed.data.fingerprint))) {
      return problem(
        reply,
        409,
        'Conflict',
        'fingerprint does not match the enrolled pin — compare again',
        request.url,
      );
    }
    await audit({
      userSub: g.sub,
      username: g.username,
      roles: g.roleIds,
      switchId: id,
      method: 'POST',
      path: request.url,
    });
    return { ok: true, trust_verified: true };
  });

  const BulkRow = z.object({
    id: z.string().min(1).max(64),
    display_name: z.string().min(1).max(128),
    base_url: z.string().url().startsWith('https://'),
    group: z.string().min(1).optional(),
    switch_username: z.string().min(1).max(128),
    switch_password: z.string().min(1).max(512),
  });

  app.post('/api/v1/inventory/import', async (request, reply) => {
    const admin = await requireAppAdmin(request, reply, cfg);
    if (!admin) return reply;
    const parsed = z.object({ rows: z.array(BulkRow).min(1).max(200) }).safeParse(request.body);
    if (!parsed.success) return problem(reply, 400, 'Bad Request', 'rows[] (max 200) required', request.url);
    const results = [];
    for (const row of parsed.data.rows) {
      try {
        const sw = await createSwitch({ id: row.id, display_name: row.display_name, base_url: row.base_url });
        if (row.group) await setSwitchGroups(row.id, [row.group]);
        await setSwitchCredential(
          admin.who.sub,
          row.id,
          row.switch_username,
          row.switch_password,
          cfg.credKey,
        );
        await audit({
          userSub: admin.who.sub,
          username: admin.who.username,
          roles: admin.roleIds,
          switchId: row.id,
          method: 'POST',
          path: request.url,
          after: { id: row.id, fingerprint: sw.cert_fingerprint },
        });
        results.push({
          id: row.id,
          ok: true as const,
          fingerprint: sw.cert_fingerprint,
          trust_verified: false,
        });
      } catch (err) {
        results.push({
          id: row.id,
          ok: false as const,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return { results };
  });
}
