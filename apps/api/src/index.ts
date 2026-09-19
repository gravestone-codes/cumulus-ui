import 'dotenv/config';
import { buildApp } from './app.js';
import { migrate } from './db.js';
import { purgeAudit } from './audit/store.js';

const port = Number(process.env.PORT ?? 3000);
const retentionDays = Number(process.env.AUDIT_RETENTION_DAYS ?? 90);
await migrate();
const app = await buildApp();
setInterval(
  () => {
    purgeAudit(retentionDays).catch((err: unknown) => app.log.error({ err }, 'audit purge failed'));
  },
  24 * 60 * 60 * 1000,
).unref();
await app.listen({ port, host: '0.0.0.0' });
