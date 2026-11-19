import { randomBytes, timingSafeEqual } from 'node:crypto'
import { ConfidentialClientApplication, LogLevel } from '@azure/msal-node'
import env from '#start/env'

/**
 * Client MSAL (Microsoft Entra ID) partagé.
 *
 * Les clés sont lues dans les variables d'environnement :
 * AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, AZURE_TENANT_ID.
 * AZURE_REDIRECT_URI / AZURE_POST_LOGOUT_REDIRECT_URI sont optionnelles :
 * si elles sont absentes, les URLs sont reconstruites depuis la requête.
 */
export const MICROSOFT_SCOPES = ['openid', 'profile', 'email']
export const MICROSOFT_CALLBACK_PATH = '/auth/microsoft/callback'
export const MICROSOFT_STATE_SESSION_KEY = 'microsoft_auth_state'

let msalClient: ConfidentialClientApplication | null = null

/**
 * Indique si les trois variables indispensables à MSAL sont présentes.
 * Permet aux routes de répondre proprement au lieu de planter avant configuration.
 */
export function isMicrosoftAuthConfigured(): boolean {
  return Boolean(
    env.get('AZURE_CLIENT_ID') && env.get('AZURE_CLIENT_SECRET') && env.get('AZURE_TENANT_ID')
  )
}

export function getMsalClient(): ConfidentialClientApplication {
  const clientId = env.get('AZURE_CLIENT_ID')
  const clientSecret = env.get('AZURE_CLIENT_SECRET')
  const tenantId = env.get('AZURE_TENANT_ID')

  if (!clientId || !clientSecret || !tenantId) {
    throw new Error(
      'MSAL incomplet : AZURE_CLIENT_ID, AZURE_CLIENT_SECRET et AZURE_TENANT_ID sont requis dans le .env'
    )
  }

  if (!msalClient) {
    msalClient = new ConfidentialClientApplication({
      auth: {
        clientId,
        clientSecret,
        authority: `https://login.microsoftonline.com/${tenantId}`,
      },
      system: {
        loggerOptions: {
          // On reste silencieux : jamais de token ni de données personnelles dans les logs.
          loggerCallback: () => {},
          piiLoggingEnabled: false,
          logLevel: LogLevel.Error,
        },
      },
    })
  }

  return msalClient
}

/**
 * `state` anti-CSRF, stocké en session puis revérifié au retour de Microsoft.
 */
export function createState(): string {
  return randomBytes(32).toString('base64url')
}

export function isValidState(expected: unknown, received: unknown): boolean {
  if (typeof expected !== 'string' || typeof received !== 'string') return false

  const expectedBuffer = Buffer.from(expected)
  const receivedBuffer = Buffer.from(received)
  if (expectedBuffer.length !== receivedBuffer.length) return false

  return timingSafeEqual(expectedBuffer, receivedBuffer)
}

/**
 * PHASE 1 : URL de redirection vers la page de connexion Microsoft.
 */
export async function buildAuthorizationUrl(redirectUri: string, state: string): Promise<string> {
  return getMsalClient().getAuthCodeUrl({
    scopes: MICROSOFT_SCOPES,
    redirectUri,
    state,
    prompt: 'select_account',
  })
}

/**
 * PHASE 2 : échange du code d'autorisation contre des tokens (id_token + access_token).
 */
export async function acquireTokenByCode(redirectUri: string, code: string) {
  return getMsalClient().acquireTokenByCode({
    scopes: MICROSOFT_SCOPES,
    redirectUri,
    code,
  })
}

/**
 * Déconnexion côté Microsoft (déconnecte aussi la session Entra ID du navigateur).
 */
export function buildLogoutUrl(postLogoutRedirectUri: string): string {
  const tenantId = env.get('AZURE_TENANT_ID') ?? 'common'
  const baseUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/logout`
  return `${baseUrl}?post_logout_redirect_uri=${encodeURIComponent(postLogoutRedirectUri)}`
}
