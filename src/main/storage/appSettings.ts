import { app } from 'electron'
import { join } from 'path'
import { promises as fsp } from 'fs'
import type { AppSettings, Theme } from '@shared/types'

export function isTheme(value: unknown): value is Theme {
  return value === 'light' || value === 'dark'
}

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

export async function readSettings(): Promise<AppSettings> {
  try {
    const parsed = JSON.parse(await fsp.readFile(settingsPath(), 'utf-8')) as Record<
      string,
      unknown
    >
    return { version: 1, theme: isTheme(parsed.theme) ? parsed.theme : 'light' }
  } catch {
    return { version: 1, theme: 'light' }
  }
}

export async function writeSettings(settings: AppSettings): Promise<void> {
  const target = settingsPath()
  const tmp = `${target}.tmp`
  await fsp.writeFile(tmp, JSON.stringify(settings, null, 2), 'utf-8')
  await fsp.rename(tmp, target)
}
