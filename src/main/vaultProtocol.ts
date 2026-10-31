import { promises as fsp } from 'node:fs'
import { resolve, sep } from 'node:path'
import { protocol } from 'electron'
import { readRegistry } from './storage/vaultRegistry'
import { isValidRelPath } from './storage/sessionStore'

const SCHEME = 'researchdeck'
const HOST = 'vault'

/** Must be called before the app is ready. */
export function registerVaultSchemePrivileges(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
    }
  ])
}

/**
 * Builds a CORS-approved response. The renderer fetches these URLs from a
 * different origin (http://localhost in dev, file:// in prod), so every
 * response — including errors — must carry an ACAO header or Chromium's
 * network stack hides it from fetch (pdf.js would see "status 0").
 */
function respond(body: string | Uint8Array, status: number, type?: string): Response {
  const headers: Record<string, string> = { 'access-control-allow-origin': '*' }
  if (type) headers['content-type'] = type
  if (typeof body !== 'string') headers['content-length'] = String(body.byteLength)
  return new Response(body as BodyInit, { status, headers })
}

/** Serves files from inside registered vaults to the renderer: researchdeck://vault/<vaultId>/<relPath>. */
export function registerVaultProtocolHandler(): void {
  protocol.handle(SCHEME, async (request) => {
    try {
      const url = new URL(request.url)
      if (url.host !== HOST) return respond('not found', 404)

      const segments = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
      if (segments.length < 2) return respond('not found', 404)
      const [vaultId, ...relSegments] = segments
      const relPath = relSegments.join('/')
      if (!isValidRelPath(relPath)) return respond('forbidden', 403)

      const registry = await readRegistry()
      const vault = registry.vaults.find((v) => v.id === vaultId)
      if (!vault) return respond('not found', 404)

      const root = resolve(vault.path)
      const absPath = resolve(root, relPath)
      if (!absPath.startsWith(root + sep)) return respond('forbidden', 403)

      const data = await fsp.readFile(absPath)
      const type = relPath.toLowerCase().endsWith('.pdf')
        ? 'application/pdf'
        : 'application/octet-stream'
      return respond(new Uint8Array(data), 200, type)
    } catch (err) {
      return respond(err instanceof Error ? err.message : 'error', 404)
    }
  })
}
