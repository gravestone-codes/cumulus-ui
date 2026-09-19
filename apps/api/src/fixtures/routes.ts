/**
 * Static fixtures for UI development (roadmap 0.10: thin only).
 * Same shape family as live reads, clearly fake data. No auth, no writes —
 * workflow truth comes from hardware (decision 6.9).
 */
import type { FastifyInstance } from 'fastify';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { problem } from '../lib/problems.js';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures');

export function fixtureNames(): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -'.json'.length))
    .sort();
}

export async function fixtureRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/fixtures', async () => fixtureNames());

  app.get('/api/v1/fixtures/:name', async (request, reply) => {
    const { name } = request.params as { name: string };
    if (!/^[a-z0-9-]+$/.test(name)) return problem(reply, 400, 'Bad Request', 'unknown fixture', request.url);
    try {
      const data = JSON.parse(readFileSync(join(dir, `${name}.json`), 'utf8')) as unknown;
      return data;
    } catch {
      return problem(reply, 404, 'Not Found', `no fixture ${name}`, request.url);
    }
  });
}
