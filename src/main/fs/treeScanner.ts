import { basename, join } from 'path'
import { promises as fsp } from 'fs'
import type { Dirent } from 'fs'
import type { VaultNode, VaultTree } from '@shared/types'

const MAX_DEPTH = 10
const MAX_NODES = 5000

/**
 * Recursively scans a vault folder into a tree. Hidden entries (dotfiles,
 * including the .researchdeck marker) are excluded. Depth and node counts are
 * capped so pathological folders can't hang the app; `truncated` signals that.
 */
export async function scanVaultTree(rootAbsPath: string): Promise<VaultTree> {
  let nodeCount = 0
  let truncated = false

  async function walk(absDir: string, relDir: string, depth: number): Promise<VaultNode[]> {
    if (depth > MAX_DEPTH) {
      truncated = true
      return []
    }
    let entries: Dirent[]
    try {
      entries = await fsp.readdir(absDir, { withFileTypes: true })
    } catch {
      return [] // Unreadable subfolder — skip it.
    }
    const visible = entries.filter((entry) => !entry.name.startsWith('.'))
    visible.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true })
    })
    const nodes: VaultNode[] = []
    for (const entry of visible) {
      if (nodeCount >= MAX_NODES) {
        truncated = true
        break
      }
      nodeCount++
      const childAbs = join(absDir, entry.name)
      const childRel = relDir === '' ? entry.name : `${relDir}/${entry.name}`
      if (entry.isDirectory()) {
        nodes.push({
          name: entry.name,
          path: childRel,
          kind: 'directory',
          children: await walk(childAbs, childRel, depth + 1)
        })
      } else if (entry.isFile()) {
        let size: number | undefined
        try {
          size = (await fsp.stat(childAbs)).size
        } catch {
          size = undefined
        }
        nodes.push({ name: entry.name, path: childRel, kind: 'file', size })
      }
      // Symlinks and special files are intentionally skipped.
    }
    return nodes
  }

  const children = await walk(rootAbsPath, '', 1)
  const root: VaultNode = {
    name: basename(rootAbsPath),
    path: '',
    kind: 'directory',
    children
  }
  return { root, truncated }
}
