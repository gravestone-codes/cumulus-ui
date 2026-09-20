import Fastify, { type FastifyInstance } from 'fastify';
import helmet from '@fastify/helmet';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { inventoryRoutes } from './inventory/routes.js';
import { switchAuthRoutes } from './switchauth/routes.js';
import { rbacRoutes } from './rbac/routes.js';
import { auditRoutes } from './audit/routes.js';
import { workflowRoutes } from './workflow/routes.js';
import { fixtureRoutes } from './fixtures/routes.js';
import { authRoutes } from './auth/routes.js';
import { usersRoutes } from './users/routes.js';
import { setupRoutes } from './setup/routes.js';
import { authConfig, type AuthConfig } from './auth/config.js';
import type { JsonRequest } from './nvue/tls.js';

export interface AppOptions {
  /** Omit for production boot (reads env, fails fast without SWITCH_CRED_KEY). */
  auth?:
    | false
    | {
        cfg: AuthConfig;
        fetchJsonFn?: (req: JsonRequest) => Promise<unknown>;
      };
}

/** Build the API application. No listen here — see index.ts. Keeps tests network-free. */
export async function buildApp(options?: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? 'info' },
    genReqId: () => randomUUID(), // roadmap decision 12: reqId spans UI→backend→switch
    // Behind a TLS-terminating proxy, X-Forwarded-Proto tells the truth about
    // the browser-facing scheme (used for the Secure cookie flag below).
    trustProxy: true,
  });
  await app.register(helmet, {
    // Default helmet CSP minus `upgrade-insecure-requests`: the app is served
    // over plain HTTP on management LANs, and that directive makes browsers
    // silently rewrite subresource loads to https:// (white page, no error).
    // If ever deployed behind a TLS-terminating proxy only, revisit.
    contentSecurityPolicy: {
      // useDefaults:false — helmet otherwise merges our directives OVER its
      // defaults, keeping upgrade-insecure-requests (the white-page bug).
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        fontSrc: ["'self'", 'https:', 'data:'],
        formAction: ["'self'"],
        frameAncestors: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'"],
        scriptSrcAttr: ["'none'"],
        styleSrc: ["'self'", 'https:', "'unsafe-inline'"],
      },
    },
  });
  await app.register(cookie);
  await app.register(rateLimit, { max: 200, timeWindow: '1 minute' });

  app.get('/api/v1/health', async () => ({ status: 'ok', version: '0.0.0' }));
  await app.register(fixtureRoutes);

  const auth = options?.auth === undefined ? { cfg: authConfig() } : options.auth;
  // Setup is public-but-empty-gated (first-boot only, 404s once a user exists).
  if (auth !== false) await app.register(setupRoutes, { cfg: auth.cfg });
  if (auth !== false) {
    await app.register(inventoryRoutes, { cfg: auth.cfg });
    await app.register(switchAuthRoutes, { cfg: auth.cfg, fetchJsonFn: auth.fetchJsonFn });
    await app.register(authRoutes, { cfg: auth.cfg });
    await app.register(usersRoutes, { cfg: auth.cfg });
    await app.register(rbacRoutes, { cfg: auth.cfg });
    await app.register(auditRoutes, { cfg: auth.cfg });
    await app.register(workflowRoutes, { cfg: auth.cfg });
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

  // UI bundle (decision 11: same-origin serving). Skipped when the UI hasn't
  // been built (unit tests, API-only dev) — e2e/prod always build first.
  // Registered last so /api/* routes and the 404 handler keep precedence;
  // the wildcard only serves the SPA shell for non-API paths.
  // Absolute path: fastify-static refuses relative roots (broke CI e2e).
  const publicDir = resolve(process.cwd(), process.env.STATIC_DIR ?? join('..', 'ui', 'dist'));
  if (existsSync(publicDir)) {
    // wildcard:false — our own /* route below owns SPA fallback so /api/*
    // unknowns still reach the problem+json 404 handler.
    await app.register(fastifyStatic, { root: publicDir, wildcard: false });
    app.get('/*', (request, reply) => {
      if (request.url.startsWith('/api/')) return reply.callNotFound();
      return reply.sendFile('index.html');
    });
  } else {
    app.log.warn({ publicDir }, 'UI bundle missing — serving API only');
  }
  return app;
}
