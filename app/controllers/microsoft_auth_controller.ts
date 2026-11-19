import type { HttpContext } from '@adonisjs/core/http'
import { randomBytes } from 'node:crypto'
import Hash from '@adonisjs/core/services/hash'
import env from '#start/env'
import User from '#models/user'
import {
  MICROSOFT_CALLBACK_PATH,
  MICROSOFT_STATE_SESSION_KEY,
  acquireTokenByCode,
  buildAuthorizationUrl,
  buildLogoutUrl,
  createState,
  isMicrosoftAuthConfigured,
  isValidState,
} from '#services/msal_service'

type MicrosoftClaims = Record<string, unknown>

class StudentBlockedError extends Error {
  constructor() {
    super('Student account not found in database')
    this.name = 'StudentBlockedError'
  }
}

export default class MicrosoftAuthController {
  /**
   * PHASE 1 : redirection vers la page de connexion Microsoft.
   */
  public async redirect({ request, response, session }: HttpContext) {
    if (!isMicrosoftAuthConfigured()) {
      session.flash({
        error:
          "L'authentification Microsoft n'est pas configurée. Veuillez contacter un administrateur.",
      })
      return response.redirect('/choix-login')
    }

    const state = createState()
    session.put(MICROSOFT_STATE_SESSION_KEY, state)

    const authorizationUrl = await buildAuthorizationUrl(this.redirectUri(request), state)
    return response.redirect(authorizationUrl)
  }

  /**
   * PHASE 2 : retour de Microsoft, validation et connexion locale.
   */
  public async callback(ctx: HttpContext) {
    const { request, response, session, auth } = ctx
    const { code, state, error, error_description: errorDescription } = request.qs()

    const expectedState = session.get(MICROSOFT_STATE_SESSION_KEY)
    session.forget(MICROSOFT_STATE_SESSION_KEY)

    if (error) {
      session.flash({ error: errorDescription || `Connexion Microsoft refusée (${error})` })
      return response.redirect('/choix-login')
    }

    if (!isMicrosoftAuthConfigured()) {
      session.flash({
        error:
          "L'authentification Microsoft n'est pas configurée. Veuillez contacter un administrateur.",
      })
      return response.redirect('/choix-login')
    }

    if (!isValidState(expectedState, state)) {
      session.flash({ error: 'Session de connexion invalide ou expirée. Merci de réessayer.' })
      return response.redirect('/choix-login')
    }

    if (!code || typeof code !== 'string') {
      session.flash({ error: "Code d'autorisation Microsoft manquant." })
      return response.redirect('/choix-login')
    }

    let claims: MicrosoftClaims
    try {
      const result = await acquireTokenByCode(this.redirectUri(request), code)
      claims = (result?.idTokenClaims ?? {}) as MicrosoftClaims
    } catch {
      session.flash({ error: 'La connexion Microsoft a échoué. Merci de réessayer.' })
      return response.redirect('/choix-login')
    }

    try {
      const user = await this.findOrCreateUser(claims)
      await auth.use('web').login(user)
      return response.redirect('/home')
    } catch (error) {
      if (error instanceof StudentBlockedError) {
        session.flash({
          error:
            'Les comptes étudiants ne sont pas autorisés à accéder à cette application. Veuillez contacter un administrateur.',
        })
        return response.redirect('/choix-login')
      }
      throw error
    }
  }

  /**
   * PHASE 3 : déconnexion locale puis déconnexion Microsoft.
   */
  public async logout({ auth, request, response }: HttpContext) {
    await auth.use('web').logout()

    const postLogoutRedirectUri =
      env.get('AZURE_POST_LOGOUT_REDIRECT_URI') || this.absoluteUrl(request, '/choix-login')

    return response.redirect(buildLogoutUrl(postLogoutRedirectUri))
  }

  /**
   * URL de retour déclarée dans l'application Entra ID.
   */
  private redirectUri(request: HttpContext['request']) {
    return env.get('AZURE_REDIRECT_URI') || this.absoluteUrl(request, MICROSOFT_CALLBACK_PATH)
  }

  private absoluteUrl(request: HttpContext['request'], path: string) {
    return new URL(`${request.protocol()}://${request.host()}${path}`).toString()
  }

  /**
   * Recherche ou crée l'utilisateur local à partir des claims du id_token.
   */
  private async findOrCreateUser(claims: MicrosoftClaims) {
    const email = this.extractEmail(claims)
    const roles = this.normalizeRoles(claims.roles ?? claims.groups)
    const hasEtmlRole = roles.some((role) => /^UUS_ETML(?:_|$)/.test(role))
    // `extainre` : true = externe, false = interne
    const extainre = !hasEtmlRole
    const usernameSource = email || this.stringClaim(claims, 'name')
    const normalizedUsername = usernameSource ? this.normalizeUsername(usernameSource) : ''

    if (!email && !normalizedUsername) {
      throw new Error('Claims Microsoft insuffisants : email et nom absents du id_token')
    }

    // 1. Recherche (email d'abord, puis Username normalisé)
    let user = email ? await User.findBy('email', email) : null
    if (!user && normalizedUsername) {
      user = await User.findBy('Username', normalizedUsername)
    }

    if (user) {
      user.extainre = extainre
      if (email && user.email !== email) {
        user.email = email
      }
      if (normalizedUsername && user.Username !== normalizedUsername) {
        user.Username = normalizedUsername
      }
      await user.save()
      return user
    }

    // 2. Blocage des étudiants sans compte existant en base
    const isStudent = roles.some((role) => /^UUS_ETML_Students$|^SKU_STU_Standard$/.test(role))
    if (isStudent) {
      throw new StudentBlockedError()
    }

    // 3. Création si nouveau compte
    const username = await this.makeUniqueUsername(normalizedUsername || 'microsoft_user')
    const password = await Hash.make(randomBytes(32).toString('hex'))

    return User.create({
      Username: username,
      email,
      password,
      extainre,
      isadmin: false,
    })
  }

  private extractEmail(claims: MicrosoftClaims) {
    const candidates = [claims.email, claims.preferred_username, claims.upn, claims.unique_name]

    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.includes('@')) {
        return candidate.trim().toLowerCase()
      }
    }

    return null
  }

  private stringClaim(claims: MicrosoftClaims, key: string) {
    const value = claims[key]
    return typeof value === 'string' ? value.trim() : ''
  }

  private normalizeRoles(rawRoles: unknown) {
    if (Array.isArray(rawRoles)) {
      return rawRoles.map((role) => String(role).trim()).filter(Boolean)
    }

    if (typeof rawRoles === 'string') {
      const trimmed = rawRoles.trim()
      if (!trimmed) {
        return []
      }

      try {
        const parsed = JSON.parse(trimmed)
        if (Array.isArray(parsed)) {
          return parsed.map((role) => String(role).trim()).filter(Boolean)
        }
      } catch {
        return trimmed
          .replace(/^\[|\]$/g, '')
          .split(',')
          .map((role) => role.replace(/^"|"$/g, '').trim())
          .filter(Boolean)
      }
    }

    return []
  }

  private normalizeUsername(rawEmail: string) {
    const localPart = rawEmail.includes('@') ? rawEmail.split('@')[0] : rawEmail
    const cleaned = localPart
      .trim()
      .replace(/\./g, '-')
      .replace(/[^a-zA-Z0-9_-]/g, '')
    return (cleaned || 'microsoft_user').slice(0, 40)
  }

  private async makeUniqueUsername(baseUsername: string) {
    let candidate = baseUsername
    let suffix = 1

    while (await User.findBy('Username', candidate)) {
      candidate = `${baseUsername}_${suffix}`.slice(0, 40)
      suffix += 1
    }

    return candidate
  }
}
