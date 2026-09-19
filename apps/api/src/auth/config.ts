/** Auth configuration from env. Fails fast on missing secrets — never boot half-secured. */
export interface AuthConfig {
  /** Key sealing switch-credential passwords at rest (SWITCH_CRED_KEY). */
  credKey: string;
  idleMinutes: number;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing required env ${name}`);
  return value;
}

/** Read config. Call once at startup; throws rather than running insecure. */
export function authConfig(): AuthConfig {
  return {
    credKey: required('SWITCH_CRED_KEY'),
    idleMinutes: Number(process.env.SESSION_IDLE_MINUTES ?? 30),
  };
}
