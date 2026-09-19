/** Auth configuration from env. Fails fast on missing secrets — never boot half-secured. */
export interface AuthConfig {
  keycloakUrl: string;
  realm: string;
  clientId: string;
  sessionSecret: string;
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
    keycloakUrl: (process.env.KEYCLOAK_URL ?? 'http://localhost:8080').replace(/\/$/, ''),
    realm: process.env.KEYCLOAK_REALM ?? 'cumulus',
    clientId: process.env.KEYCLOAK_CLIENT_ID ?? 'cumulus-ui',
    sessionSecret: required('SESSION_SECRET'),
    idleMinutes: Number(process.env.SESSION_IDLE_MINUTES ?? 30),
  };
}

/** Standard Keycloak issuer string for a realm. */
export function issuerOf(cfg: AuthConfig): string {
  return `${cfg.keycloakUrl}/realms/${cfg.realm}`;
}
