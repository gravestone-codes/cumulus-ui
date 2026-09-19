import Fastify, { type FastifyInstance } from 'fastify';
import helmet from '@fastify/helmet';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { randomUUID } from 'node:crypto';
import { inventoryRoutes } from './inventory/routes.js';
import { switchAuthRoutes } from './switchauth/routes.js';
import { rbacRoutes } from './rbac/routes.js';
import { auditRoutes } from './audit/routes.js';
import { fixtureRoutes } from './fixtures/routes.js';
import { authRoutes } from './auth/routes.js';
import { authConfig, type AuthConfig } from './auth/config.js';
import type { KeyProvider } from './auth/oidc.js';
import type { JsonRequest } from './nvue/tls.js';

export interface AppOptions {
  /** Omit for production boot (reads env, fails fast without SESSION_SECRET). */
  auth?:
    | false
    | {
        cfg: AuthConfig;
        keys?: KeyProvider;
        refreshFetch?: typeof fetch;
        fetchJsonFn?: (req: JsonRequest) => Promise<unknown>;
      };
}

/** Build the API application. No listen here — see index.ts. Keeps tests network-free. */
export async function buildApp(options?: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? 'info' },
    genReqId: () => randomUUID(), // roadmap decision 12: reqId spans UI→backend→switch
  });
  await app.register(helmet);
  await app.register(cookie);
  await app.register(rateLimit, { max: 200, timeWindow: '1 minute' });

  app.get('/api/v1/health', async () => ({ status: 'ok', version: '0.0.0' }));
  await app.register(fixtureRoutes);

  const auth = options?.auth === undefined ? { cfg: authConfig() } : options.auth;
  if (auth !== false) {
    await app.register(inventoryRoutes, { cfg: auth.cfg });
    await app.register(switchAuthRoutes, { cfg: auth.cfg, fetchJsonFn: auth.fetchJsonFn });
    await app.register(authRoutes, auth);
    await app.register(rbacRoutes, { cfg: auth.cfg });
    await app.register(auditRoutes, { cfg: auth.cfg });
  }

  app.setNotFoundHandler(async (request, reply) => {
    // RFC 9457 problem details (roadmap decision 13).
    return reply.code(404).send({
      type: 'about:blank',
      title: 'Not Found',
      status: 404,
      detail: `No route for ${request.method} ${request.url}`,
      instance: request.url,
    });
  });
  return app;
}
