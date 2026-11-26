/*
|--------------------------------------------------------------------------
| HTTP server entrypoint
|--------------------------------------------------------------------------
|
| The "server.ts" file is the entrypoint for starting the AdonisJS HTTP
| server. Either you can run this file directly or use the "serve"
| command to run this file and monitor file changes
|
*/

import 'reflect-metadata'
import { randomBytes } from 'node:crypto'
import { Ignitor, prettyPrintError } from '@adonisjs/core'

/*
|--------------------------------------------------------------------------
| Valeurs de repli pour un environnement hébergé (Azure App Service)
|--------------------------------------------------------------------------
|
| AdonisJS valide toutes les variables déclarées dans start/env.ts et refuse
| de démarrer si l'une d'elles manque : côté App Service, cela se traduit par
| un 503 sans aucune trace applicative.
|
| On fournit donc des valeurs par défaut, uniquement lorsqu'une variable est
| absente (opérateur ??=) : une configuration réelle — variables Azure ou
| fichier .env — garde toujours la priorité.
|
*/
const MISSING: string[] = []
const HOSTED_DEFAULTS: Record<string, string> = {
  NODE_ENV: 'production',
  HOST: '0.0.0.0',
  // App Service Linux sonde le port 8080 par défaut.
  PORT: process.env.WEBSITES_PORT ?? '8080',
  LOG_LEVEL: 'info',
  SESSION_DRIVER: 'cookie',
  // Clé générée au vol : les sessions sont invalidées à chaque redémarrage.
  // Elle reste inutile à définir en production, mais évite un crash au boot.
  APP_KEY: `base64:${randomBytes(32).toString('base64')}`,
  DB_TYPE: 'sqlite',
  DB_HOST: 'localhost',
  DB_PORT: '3306',
  DB_USER: 'root',
  DB_DATABASE: 'je_donne_je_prete',
}

for (const [key, value] of Object.entries(HOSTED_DEFAULTS)) {
  if (process.env[key] === undefined) {
    process.env[key] = value
    MISSING.push(key)
  }
}

if (MISSING.length) {
  console.warn(`[env] variables absentes, valeurs de repli utilisées : ${MISSING.join(', ')}`)
}

/**
 * URL to the application root. AdonisJS need it to resolve
 * paths to file and directories for scaffolding commands
 */
const APP_ROOT = new URL('../', import.meta.url)

/**
 * The importer is used to import files in context of the
 * application.
 */
const IMPORTER = (filePath: string) => {
  if (filePath.startsWith('./') || filePath.startsWith('../')) {
    return import(new URL(filePath, APP_ROOT).href)
  }
  return import(filePath)
}

new Ignitor(APP_ROOT, { importer: IMPORTER })
  .tap((app) => {
    app.booting(async () => {
      await import('#start/env')
    })
    app.listen('SIGTERM', () => app.terminate())
    app.listenIf(app.managedByPm2, 'SIGINT', () => app.terminate())
  })
  .httpServer()
  .start()
  .then(() => {
    console.log(`[env] écoute sur ${process.env.HOST}:${process.env.PORT}`)
  })
  .catch((error) => {
    process.exitCode = 1
    prettyPrintError(error)
  })
