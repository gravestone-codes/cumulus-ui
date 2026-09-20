/**
 * Spec manifest endpoint (decision 10: even the manifest comes from the backend).
 * Powers ViewSwitcher options and any other schema-driven UI. Authenticated,
 * same for every role (it describes the API surface, not data).
 */
import type { FastifyInstance } from 'fastify';
import manifestJson from '@cumulus/spec/manifest.json' with { type: 'json' };
import { problem } from '../lib/problems.js';
import { type AuthConfig } from '../auth/config.js';
import { resolveCaller } from '../auth/caller.js';
import { matchTemplate } from '../nvue/guard.js';
import { requestBodySchema } from './fields.js';
import { z } from 'zod';

export async function specRoutes(app: FastifyInstance, deps: { cfg: AuthConfig }): Promise<void> {
  const { cfg } = deps;
  app.get('/api/v1/spec/manifest', async (request, reply) => {
    const who = await resolveCaller(request, cfg);
    if (!who) return problem(reply, 401, 'Unauthorized', 'no active session', request.url);
    const manifest = manifestJson as { routes: Record<string, string[]>; views: Record<string, string[]> };
    return { version: (manifestJson as { version?: string }).version ?? 'unknown', routes: manifest.routes, views: manifest.views };
  });

  app.get('/api/v1/spec/fields', async (request, reply) => {
    const who = await resolveCaller(request, cfg);
    if (!who) return problem(reply, 401, 'Unauthorized', 'no active session', request.url);
    const parsed = z.object({ path: z.string().min(1), method: z.string().min(1) }).safeParse(request.query);
    if (!parsed.success) return problem(reply, 400, 'Bad Request', 'path and method required', request.url);
    const manifest = manifestJson as { routes: Record<string, string[]>; views: Record<string, string[]> };
    const matched = matchTemplate(manifest, parsed.data.path);
    if (!matched || !matched.methods.includes(parsed.data.method.toLowerCase())) {
      return problem(reply, 404, 'Not Found', 'no such path+method in the spec', request.url);
    }
    const found = requestBodySchema(matched.template, parsed.data.method);
    if (!found) return problem(reply, 404, 'Not Found', 'no request body for this operation', request.url);
    return found;
  });
}
