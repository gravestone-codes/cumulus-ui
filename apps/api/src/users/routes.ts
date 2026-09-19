/**
 * User management (roadmap: identities are created in our UI).
 * App-admin only — bootstrapped by the create-admin CLI for the first admin.
 * Cannot disable/delete self (lockout prevention).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { problem } from '../lib/problems.js';
import { type AuthConfig } from '../auth/config.js';
import { resolveCaller } from '../auth/caller.js';
import { getUserRoles, grantRole, listRoles } from '../rbac/store.js';
import { audit } from '../audit/store.js';
import {
  createUser,
  deleteSwitchCredential,
  deleteUser,
  listSwitchCredentials,
  listUsers,
  setSwitchCredential,
  updateUser,
} from './store.js';

export interface UsersDeps {
  cfg: AuthConfig;
}

/** Shared admin gate (also used by rbac routes): stored app-admin role, deny + audit otherwise. */
export async function requireAppAdmin(request: FastifyRequest, reply: FastifyReply, cfg: AuthConfig) {
  const who = await resolveCaller(request, cfg);
  if (!who) {
    void problem(reply, 401, 'Unauthorized', 'no active session', request.url);
    return null;
  }
  const stored = await getUserRoles(who.sub);
  if (!stored.some((r) => r.id === 'app-admin')) {
    await audit({
      userSub: who.sub,
      username: who.username,
      roles: stored.map((r) => r.id),
      method: request.method,
      path: request.url,
    });
    void problem(reply, 403, 'Forbidden', 'app-admin role required', request.url);
    return null;
  }
  return { who, roleIds: stored.map((r) => r.id) };
}

const GrantBody = z.object({ role_id: z.string().min(1) });
const CredentialBody = z.object({
  switch_username: z.string().min(1).max(128),
  switch_password: z.string().min(1).max(512),
});

export async function usersRoutes(app: FastifyInstance, deps: UsersDeps): Promise<void> {
  const { cfg } = deps;

  app.get('/api/v1/users', async (request, reply) => {
    const admin = await requireAppAdmin(request, reply, cfg);
    if (!admin) return reply;
    const users = await listUsers();
    const withRoles = await Promise.all(
      users.map(async (u) => ({ ...u, roles: (await getUserRoles(u.id)).map((r) => r.id) })),
    );
    return withRoles;
  });

  app.post('/api/v1/users', async (request, reply) => {
    const admin = await requireAppAdmin(request, reply, cfg);
    if (!admin) return reply;
    try {
      const user = await createUser(request.body);
      await audit({
        userSub: admin.who.sub,
        username: admin.who.username,
        roles: admin.roleIds,
        method: 'POST',
        path: request.url,
        after: { id: user.id },
      });
      return reply.code(201).send(user);
    } catch (err) {
      if (err instanceof z.ZodError)
        return problem(reply, 400, 'Bad Request', 'invalid user body', request.url);
      if ((err as { code?: string }).code === 'USER_TAKEN') {
        return problem(reply, 409, 'Conflict', 'user id taken', request.url);
      }
      throw err;
    }
  });

  const PatchBody = z.object({
    display_name: z.string().min(1).max(128).optional(),
    disabled: z.boolean().optional(),
    password: z.string().min(12).max(256).optional(),
  });

  app.patch('/api/v1/users/:id', async (request, reply) => {
    const admin = await requireAppAdmin(request, reply, cfg);
    if (!admin) return reply;
    const { id } = request.params as { id: string };
    if (id.toLowerCase() === admin.who.sub && (request.body as { disabled?: boolean })?.disabled === true) {
      return problem(reply, 409, 'Conflict', 'cannot disable yourself', request.url);
    }
    const parsed = PatchBody.safeParse(request.body);
    if (!parsed.success) return problem(reply, 400, 'Bad Request', 'invalid patch body', request.url);
    try {
      const user = await updateUser(id, parsed.data);
      if (!user) return problem(reply, 404, 'Not Found', `no user ${id}`, request.url);
      await audit({
        userSub: admin.who.sub,
        username: admin.who.username,
        roles: admin.roleIds,
        method: 'PATCH',
        path: request.url,
        after: { id },
      });
      return user;
    } catch (err) {
      if ((err as { code?: string }).code === 'WEAK_PASSWORD') {
        return problem(reply, 400, 'Bad Request', 'password too short (min 12)', request.url);
      }
      throw err;
    }
  });

  app.delete('/api/v1/users/:id', async (request, reply) => {
    const admin = await requireAppAdmin(request, reply, cfg);
    if (!admin) return reply;
    const { id } = request.params as { id: string };
    if (id.toLowerCase() === admin.who.sub) {
      return problem(reply, 409, 'Conflict', 'cannot delete yourself', request.url);
    }
    if (!(await deleteUser(id))) return problem(reply, 404, 'Not Found', `no user ${id}`, request.url);
    await audit({
      userSub: admin.who.sub,
      username: admin.who.username,
      roles: admin.roleIds,
      method: 'DELETE',
      path: request.url,
      before: { id },
    });
    return { ok: true };
  });

  app.post('/api/v1/users/:id/roles', async (request, reply) => {
    const admin = await requireAppAdmin(request, reply, cfg);
    if (!admin) return reply;
    const { id } = request.params as { id: string };
    const parsed = GrantBody.safeParse(request.body);
    if (!parsed.success) return problem(reply, 400, 'Bad Request', 'role_id required', request.url);
    const targets = await listRoles();
    if (!targets.some((r) => r.id === parsed.data.role_id)) {
      return problem(reply, 400, 'Bad Request', 'unknown role id', request.url);
    }
    await grantRole(id.toLowerCase(), parsed.data.role_id);
    await audit({
      userSub: admin.who.sub,
      username: admin.who.username,
      roles: admin.roleIds,
      method: 'POST',
      path: request.url,
      after: { id, role: parsed.data.role_id },
    });
    return { ok: true };
  });

  // ---- switch-credential extension: self-service ----

  app.get('/api/v1/me/switch-credentials', async (request, reply) => {
    const who = await resolveCaller(request, cfg);
    if (!who) return problem(reply, 401, 'Unauthorized', 'no active session', request.url);
    return listSwitchCredentials(who.sub);
  });

  app.put('/api/v1/me/switch-credentials/:switchId', async (request, reply) => {
    const who = await resolveCaller(request, cfg);
    if (!who) return problem(reply, 401, 'Unauthorized', 'no active session', request.url);
    const { switchId } = request.params as { switchId: string };
    const parsed = CredentialBody.safeParse(request.body);
    if (!parsed.success)
      return problem(reply, 400, 'Bad Request', 'switch_username and switch_password required', request.url);
    try {
      await setSwitchCredential(
        who.sub,
        switchId,
        parsed.data.switch_username,
        parsed.data.switch_password,
        cfg.credKey,
      );
    } catch (err) {
      if ((err as { code?: string }).code === '23503') {
        return problem(reply, 400, 'Bad Request', 'unknown user or switch', request.url);
      }
      throw err;
    }
    await audit({
      userSub: who.sub,
      username: who.username,
      roles: (await getUserRoles(who.sub)).map((r) => r.id),
      switchId,
      method: 'PUT',
      path: request.url,
    });
    return { ok: true };
  });

  app.delete('/api/v1/me/switch-credentials/:switchId', async (request, reply) => {
    const who = await resolveCaller(request, cfg);
    if (!who) return problem(reply, 401, 'Unauthorized', 'no active session', request.url);
    const { switchId } = request.params as { switchId: string };
    await deleteSwitchCredential(who.sub, switchId);
    return { ok: true };
  });

  // ---- switch-credential extension: admin provisioning for others ----

  app.get('/api/v1/users/:id/switch-credentials', async (request, reply) => {
    const admin = await requireAppAdmin(request, reply, cfg);
    if (!admin) return reply;
    const { id } = request.params as { id: string };
    return listSwitchCredentials(id);
  });

  app.put('/api/v1/users/:id/switch-credentials/:switchId', async (request, reply) => {
    const admin = await requireAppAdmin(request, reply, cfg);
    if (!admin) return reply;
    const { id, switchId } = request.params as { id: string; switchId: string };
    const parsed = CredentialBody.safeParse(request.body);
    if (!parsed.success)
      return problem(reply, 400, 'Bad Request', 'switch_username and switch_password required', request.url);
    try {
      await setSwitchCredential(
        id,
        switchId,
        parsed.data.switch_username,
        parsed.data.switch_password,
        cfg.credKey,
      );
    } catch (err) {
      if ((err as { code?: string }).code === '23503') {
        return problem(reply, 400, 'Bad Request', 'unknown user or switch', request.url);
      }
      throw err;
    }
    await audit({
      userSub: admin.who.sub,
      username: admin.who.username,
      roles: admin.roleIds,
      switchId,
      method: 'PUT',
      path: request.url,
      after: { id },
    });
    return { ok: true };
  });
}
