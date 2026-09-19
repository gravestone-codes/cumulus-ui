/** RFC 9457 problem-details helpers (roadmap decision 13). */
import type { FastifyReply } from 'fastify';

export interface Problem {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
}

/** Send a problem+json response. Never includes secrets — callers pass safe detail only. */
export function problem(
  reply: FastifyReply,
  status: number,
  title: string,
  detail?: string,
  instance?: string,
) {
  const body: Problem = { type: 'about:blank', title, status };
  if (detail !== undefined) body.detail = detail;
  if (instance !== undefined) body.instance = instance;
  return reply.code(status).type('application/problem+json').send(body);
}
