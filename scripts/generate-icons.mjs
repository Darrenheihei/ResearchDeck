#!/usr/bin/env node
/**
 * Generates the platform icon set from the master SVG.
 *
 *   npm run icons:generate
 *   ICON_SVG=design/icons/concept-d-paper-progress.svg npm run icons:generate
 *
 * Inputs:  design/icons/<concept>.svg (1024x1024, set via ICON_SVG to swap)
 * Outputs: build/icon.icns                macOS
 *          build/icon.ico                 Windows
 *          build/icon.png                 Linux (512x512)
 *          resources/icon.png             in-app window icon (512x512)
 *          design/icons/master-1024.png   rendered master, for inspection
 */
import { execFileSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import png2icons from 'png2icons'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const svgPath = resolve(root, process.env.ICON_SVG ?? 'design/icons/concept-a-card-stack.svg')
const SIZE = 1024
// Apple macOS icon grid: the artwork sits on an 824x824 area, centered in the
// 1024x1024 canvas (10% transparent margins), so the icon matches the size of
// native macOS app icons in the Dock and Finder.
const MACOS_ART = 824
const MACOS_MARGIN = (SIZE - MACOS_ART) / 2

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- plain .mjs Node script: no TS annotations allowed
async function main() {
  const svg = await readFile(svgPath)
  const master = await sharp(svg, { density: 300 })
    .resize(SIZE, SIZE, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer()

  const png512 = await sharp(master).resize(512, 512).png().toBuffer()

  // macOS: pad the artwork onto the Apple icon grid before generating the icns.
  const macMaster = await sharp(master)
    .resize(MACOS_ART, MACOS_ART, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    })
    .extend({
      top: MACOS_MARGIN,
      bottom: MACOS_MARGIN,
      left: MACOS_MARGIN,
      right: MACOS_MARGIN,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    })
    .png()
    .toBuffer()

  // Padded macOS artwork for the dev-mode dock icon (packaged builds use icns).
  const macos512 = await sharp(macMaster).resize(512, 512).png().toBuffer()

  const icns = png2icons.createICNS(macMaster)
  const ico = png2icons.createICO(master)
  if (!icns || !ico) {
    throw new Error('png2icons failed to generate the icns/ico output')
  }

  const outputs = [
    ['design/icons/master-1024.png', master],
    ['build/icon.icns', icns],
    ['build/icon.ico', ico],
    ['build/icon.png', png512],
    ['resources/icon.png', png512],
    ['resources/icon-macos.png', macos512]
  ]

  for (const [relativePath, data] of outputs) {
    await writeFile(resolve(root, relativePath), data)
    console.log(`wrote ${relativePath} (${data.length} bytes)`)
  }

  // Dev-mode nicety (macOS): swap the Electron dev binary's bundle icon for
  // ours, so `npm run dev` shows ResearchDeck in the Dock at all times —
  // including while quitting — with no default-icon flash. (Reinstalling the
  // electron package reverts this; `postinstall` re-runs this script.)
  if (process.platform === 'darwin') {
    const distIcon = resolve(
      root,
      'node_modules/electron/dist/Electron.app/Contents/Resources/electron.icns'
    )
    try {
      await writeFile(distIcon, icns)
      console.log(`replaced dev bundle icon: ${relative(root, distIcon)}`)
    } catch (err) {
      console.warn(`could not replace dev bundle icon: ${err instanceof Error ? err.message : err}`)
    }

    // Patch the dev bundle's display name so the Dock hover, app menu, and
    // app switcher show "ResearchDeck" instead of "Electron" during dev.
    const infoPlist = resolve(root, 'node_modules/electron/dist/Electron.app/Contents/Info.plist')
    try {
      const plist = await readFile(infoPlist, 'utf-8')
      const patched = plist
        .replace(/(<key>CFBundleName<\/key>\s*<string>)Electron(<\/string>)/, '$1ResearchDeck$2')
        .replace(
          /(<key>CFBundleDisplayName<\/key>\s*<string>)Electron(<\/string>)/,
          '$1ResearchDeck$2'
        )
        // A fresh bundle identifier forces LaunchServices to register the app
        // anew — otherwise macOS keeps serving its cached "Electron" metadata.
        .replace(
          /(<key>CFBundleIdentifier<\/key>\s*<string>)com\.github\.Electron(<\/string>)/,
          '$1com.researchdeck.dev$2'
        )
      if (patched !== plist) {
        await writeFile(infoPlist, patched)
        console.log(`patched dev bundle name: ${relative(root, infoPlist)}`)
      } else {
        console.warn('dev bundle Info.plist had no "Electron" display names to patch')
      }
    } catch (err) {
      console.warn(`could not patch dev bundle name: ${err instanceof Error ? err.message : err}`)
    }

    // Re-register the bundle with LaunchServices so macOS refreshes its cached
    // app metadata (name + icon) used by the Dock.
    const distApp = resolve(root, 'node_modules/electron/dist/Electron.app')
    const lsregister =
      '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister'
    try {
      execFileSync(lsregister, ['-f', distApp], { stdio: 'ignore' })
      console.log(`re-registered dev app with LaunchServices: ${relative(root, distApp)}`)
    } catch (err) {
      console.warn(
        `could not re-register with LaunchServices: ${err instanceof Error ? err.message : err}`
      )
    }
  }

  console.log(`\nIcons generated from ${svgPath}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
