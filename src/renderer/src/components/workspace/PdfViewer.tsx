import { useCallback, useEffect, useRef, useState } from 'react'
import type { PageViewport, PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist'
import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
// Vendored from sindresorhus/word-list (MIT; atebits/Words en.txt, ~275k entries).
import wordsUrl from '../../assets/words-en.txt?url'
import { btnIcon } from '../../lib/ui'
import { ChevronDownIcon, ChevronUpIcon, MinusIcon, PlusIcon, SearchIcon, XIcon } from '../icons'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

interface PdfViewerProps {
  vaultId: string
  relPath: string
}

const BASE_MAX = 896 // fit-width cap (max-w-4xl), keeps pages sane on wide panes
const ZOOM_MIN = 0.5
const ZOOM_MAX = 3
const ZOOM_STEPS = [0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3]

function zoomStepIn(zoom: number | null): number {
  const current = zoom ?? 1
  return ZOOM_STEPS.find((step) => step > current + 0.001) ?? ZOOM_MAX
}

function zoomStepOut(zoom: number | null): number {
  const current = zoom ?? 1
  return [...ZOOM_STEPS].reverse().find((step) => step < current - 0.001) ?? ZOOM_MIN
}

function clampZoom(zoom: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom))
}

function zoomLabel(zoom: number | null): string {
  return `${Math.round((zoom ?? 1) * 100)}%`
}

/** Scales a built text layer so it stays aligned with the rescaled page. */
function rescaleTextLayer(wrapper: HTMLDivElement, displayWidth: number): void {
  const textDiv = wrapper.querySelector<HTMLDivElement>('.textLayer')
  const built = Number(textDiv?.dataset.renderWidth ?? 0)
  if (!textDiv || !(built > 0)) return
  const ratio = displayWidth / built
  textDiv.style.transform = ratio === 1 ? 'none' : `scale(${ratio})`
}

/** Standalone page-number text, optionally decorated ("12", "- 3 -", "xiv"). */
const PAGE_NUMBER_RE = /^(?:[-–—·•\s])*(?:\d{1,4}|[ivxlcdm]{1,7})(?:[-–—·•\s])*$/i

interface SearchRect {
  left: number
  top: number
  width: number
  height: number
}

interface SearchMatchPart {
  page: number
  rects: SearchRect[]
}

interface SearchMatch {
  /** One part per touched page, in reading order (a hyphen-split word can
      span two pages). */
  parts: SearchMatchPart[]
}

/**
 * Flattens text for search: case-folded, whitespace runs collapsed to single
 * spaces. Hyphens (hard, soft, non-breaking) are dropped along with any
 * whitespace right after them, so words hyphen-split across lines or pages
 * ("ro-bustly") match their unbroken form. The query is normalized the same
 * way, so typed hyphens ("well-known") still match. `map` maps each
 * normalized index back to its source index in `text`.
 */
function normalizeForSearch(text: string): { norm: string; map: number[] } {
  let norm = ''
  const map: number[] = []
  let lastWasSpace = true
  for (let i = 0; i < text.length; i++) {
    const raw = text[i]
    if (raw === '-' || raw === '\u00ad' || raw === '\u2011') {
      // Hyphenation join: drop the hyphen and any whitespace right after it.
      let j = i + 1
      while (j < text.length && /\s/.test(text[j])) j++
      if (j > i + 1) i = j - 1
      continue
    }
    let ch = raw.toLowerCase()
    if (/\s/.test(ch)) {
      if (lastWasSpace) continue
      ch = ' '
      lastWasSpace = true
    } else {
      lastWasSpace = false
    }
    norm += ch
    map.push(i)
  }
  return { norm, map }
}

/** Normalized, geometry-tagged text of one page, used to place highlights. */
interface PageText {
  page: number
  vp: PageViewport // scale-1 viewport: converts PDF-space to page fractions
  norm: string
  map: number[]
  rawLen: number
  items: Array<{ x: number; y: number; w: number; h: number }>
  spans: Array<{ start: number; end: number }>
}

/** Extracts and normalizes a page's text with per-item geometry. */
async function extractPageText(pdfPage: PDFPageProxy, page: number): Promise<PageText> {
  const content = await pdfPage.getTextContent()
  const vp = pdfPage.getViewport({ scale: 1 })
  const items: Array<{ x: number; y: number; w: number; h: number }> = []
  const spans: Array<{ start: number; end: number }> = []
  let raw = ''
  for (const item of content.items) {
    if (!('str' in item)) continue
    spans.push({ start: raw.length, end: raw.length + item.str.length })
    raw += item.str
    items.push({
      x: item.transform[4],
      y: item.transform[5],
      w: item.width,
      h: item.height
    })
  }
  const { norm, map } = normalizeForSearch(raw)
  return { page, vp, norm, map, rawLen: raw.length, items, spans }
}

/** Highlight bands (page %) covering a raw-character range of a page. */
function findRects(text: PageText, rawStart: number, rawEnd: number): SearchRect[] {
  const rects: SearchRect[] = []
  for (let i = 0; i < text.items.length; i++) {
    const span = text.spans[i]
    if (span.end <= rawStart || span.start >= rawEnd) continue
    const it = text.items[i]
    // Char extents within the item are approximated proportionally.
    const len = Math.max(span.end - span.start, 1)
    const c0 = Math.max(0, rawStart - span.start)
    const c1 = Math.min(span.end, rawEnd) - span.start
    const x0 = it.x + (c0 / len) * it.w
    const x1 = it.x + (c1 / len) * it.w
    const [vx0, vy0] = text.vp.convertToViewportPoint(x0, it.y)
    const [vx1, vy1] = text.vp.convertToViewportPoint(x1, it.y + it.h)
    const width = (Math.abs(vx1 - vx0) / text.vp.width) * 100
    const height = (Math.abs(vy1 - vy0) / text.vp.height) * 100
    if (width <= 0 || height <= 0) continue
    rects.push({
      left: (Math.min(vx0, vx1) / text.vp.width) * 100,
      top: (Math.min(vy0, vy1) / text.vp.height) * 100,
      width,
      height
    })
  }
  return rects
}

/** Locates a selection boundary inside a text-layer span, as a character
    offset within the span's text; null when the boundary is not inside a
    span (nothing to clip). */
function boundaryInSpan(
  container: Node | null,
  offset: number
): { span: HTMLSpanElement; at: number } | null {
  let span: HTMLSpanElement | null = null
  let at = offset
  if (container instanceof Text) {
    const parent = container.parentElement
    if (parent instanceof HTMLSpanElement) span = parent
  } else if (container instanceof HTMLSpanElement) {
    // Element boundary: offset counts child nodes before it — before the
    // first child is the span start, after it is the span end.
    span = container
    at = offset === 0 ? 0 : (container.textContent?.length ?? 0)
  }
  if (!span) return null
  const len = span.textContent?.length ?? 0
  return { span, at: Math.max(0, Math.min(at, len)) }
}

// English word list (word-list package, ~275k entries) used by the copy
// handler to decide whether a line-end hyphen is a soft word split or the
// hyphen of a genuine compound ("ro-bustly" merges, "well-known" doesn't).
let wordSet: Set<string> | null = null

/** Loads the word list once, lazily. A failed load resolves to an empty set,
    degrading the copy handler to plain lowercase heuristics. */
async function ensureWordSet(): Promise<void> {
  if (wordSet) return
  try {
    const res = await fetch(wordsUrl)
    const text = await res.text()
    wordSet = new Set(
      text
        .split('\n')
        .map((word) => word.trim())
        .filter(Boolean)
    )
  } catch {
    wordSet = new Set()
  }
}

/** True when the word is in the loaded English word list. */
function isWord(word: string): boolean {
  return wordSet !== null && wordSet.has(word.toLowerCase())
}

/** Common derivational/inflectional suffixes: when the merged form is a real
    word and the tail starts with one of these, the line-end hyphen was a soft
    break inside a single word ("remark-able" → "remarkable"). */
const WORD_SUFFIXES = [
  'able',
  'ible',
  'ment',
  'ness',
  'tion',
  'sion',
  'ing',
  'ed',
  'er',
  'est',
  'ly',
  'ful',
  'less',
  'ize',
  'ise',
  'ity',
  'ous',
  'ive',
  'ify',
  'ish',
  'al',
  'en'
]

/** One visual line of selected text, rebuilt from pdf.js spans. */
interface CopyLine {
  pageBreakBefore: boolean
  hasBreakBefore: boolean
  spans: HTMLSpanElement[]
  top: number
  bottom: number
  text: string
}

/**
 * Rebuilds flowing text from the spans covered by the selection. The browser's
 * default copy emits one line per absolutely-positioned span; instead, spans
 * are regrouped into visual lines (kept in content order, so two-column
 * layouts stay in reading order), lines inside a paragraph join with a space,
 * paragraph breaks (the injected <br>s) and page breaks become newlines, and
 * hyphenated line ends ("ro-" / "bustly") re-join into whole words. Returns
 * null when the selection does not cover any PDF text layer.
 */
function buildSelectionText(sel: Selection, scroller: HTMLDivElement): string | null {
  const lines: CopyLine[] = []
  let pageBreakNext = false
  for (const layer of scroller.querySelectorAll<HTMLElement>('.textLayer')) {
    let current: CopyLine | null = null
    let added = false
    for (const node of layer.querySelectorAll('span')) {
      if (!(node instanceof HTMLSpanElement) || !sel.containsNode(node, true)) continue
      const top = node.offsetTop
      const bottom = top + node.offsetHeight
      const sameLine =
        current !== null &&
        Math.min(bottom, current.bottom) - Math.max(top, current.top) >=
          0.5 * Math.min(node.offsetHeight, current.bottom - current.top)
      if (sameLine && current) {
        current.spans.push(node)
        current.top = Math.min(current.top, top)
        current.bottom = Math.max(current.bottom, bottom)
      } else {
        current = {
          pageBreakBefore: pageBreakNext,
          // Only the layer's own paragraph markers count — pdf.js appends an
          // untagged <br> at every end-of-line, which must NOT force a copy
          // newline (wrapped lines stay in one flowing paragraph).
          hasBreakBefore:
            node.previousElementSibling instanceof HTMLBRElement &&
            (node.previousElementSibling as HTMLElement).dataset.paraBreak === '1',
          spans: [node],
          top,
          bottom,
          text: ''
        }
        lines.push(current)
        pageBreakNext = false
        added = true
      }
    }
    if (added) pageBreakNext = true
  }
  if (lines.length === 0) return null

  // Clip spans that the selection only partially covers: the browser default
  // copies sub-span text, so must we — otherwise a few words beyond the
  // highlight leak into the clipboard.
  const clips = new Map<HTMLSpanElement, { start?: number; end?: number }>()
  const range = sel.rangeCount > 0 ? sel.getRangeAt(0) : null
  if (range) {
    const startAt = boundaryInSpan(range.startContainer, range.startOffset)
    if (startAt) clips.set(startAt.span, { start: startAt.at })
    const endAt = boundaryInSpan(range.endContainer, range.endOffset)
    if (endAt) {
      const existing = clips.get(endAt.span)
      clips.set(endAt.span, { start: existing?.start, end: endAt.at })
    }
  }

  // Assemble each line's text: spans in x order. A space goes between spans
  // when either run carries whitespace at the seam, or when the visual gap
  // (getBoundingClientRect — includes pdf.js's scale-x fitting) exceeds a
  // quarter of the average glyph width. Mid-word kerning splits join directly.
  for (const line of lines) {
    line.spans.sort((a, b) => a.offsetLeft - b.offsetLeft)
    let text = ''
    let prev: HTMLSpanElement | null = null
    let prevRight = 0
    for (const span of line.spans) {
      let raw = span.textContent ?? ''
      const clip = clips.get(span)
      if (clip) raw = raw.slice(clip.start ?? 0, clip.end ?? raw.length)
      if (!raw) continue
      const rect = span.getBoundingClientRect()
      if (text === '') {
        text = raw.replace(/^\s+/, '')
        prev = span
        prevRight = rect.right
        continue
      }
      if (!raw.trim()) {
        text = text.replace(/\s+$/, '') + ' '
        prev = span
        prevRight = rect.right
        continue
      }
      const right = text.replace(/\s+$/, '')
      const left = raw.replace(/^\s+/, '')
      const endsSpace = /\s$/.test(text)
      const rawStartsSpace = /^\s/.test(raw)
      const attach =
        /^[,.;:!?)\]}\u2019\u201d\x27\x22]/.test(left) ||
        /\([\u2018\u201c\x27\x22]$/.test(right) ||
        /[-\u2010]$/.test(right) ||
        (prev !== null && rect.left - prevRight <= (rect.width / Math.max(raw.length, 1)) * 0.25)
      text = right + (endsSpace || rawStartsSpace || !attach ? ' ' : '') + left
      prev = span
      prevRight = rect.right
    }
    line.text = text.replace(/ {2,}/g, ' ').trim()
  }

  // Join lines: paragraph breaks and page breaks become newlines; a hyphen at
  // a line end merges with a lowercase continuation into one word.
  let out = ''
  let prevText = ''
  let prevBreak = true
  for (const line of lines) {
    if (!line.text) continue
    if (out === '') {
      out = line.text
    } else if (/[-\u2010]$/.test(prevText) && !prevBreak && /^[a-zà-öø-ÿ]/.test(line.text)) {
      // Candidate soft hyphenation: the hyphen-removed form decides. If the
      // merged form is a real word ("ro-bustly" → "robustly",
      // "remark-able" → "remarkable"), the hyphen was a soft line break —
      // drop it. If not ("SoccerNet-calibration"), the hyphen belongs to the
      // word — keep it. One refinement: a compound whose halves are themselves
      // words ("well-known", "e-mail") keeps its hyphen even when a merged
      // spelling exists, unless the tail merely adds a suffix.
      const leftFrag = prevText
        .slice(prevText.lastIndexOf(' ') + 1)
        .replace(/[-\u2010]$/, '')
        .toLowerCase()
      const rightFrag = (line.text.match(/^[a-z\u00e0-\u00f6\u00f8-\u00ff]+/) ?? [
        ''
      ])[0].toLowerCase()
      const joined = leftFrag + rightFrag
      const compound = isWord(leftFrag) && isWord(rightFrag)
      const keepHyphen =
        !isWord(joined) || (compound && !WORD_SUFFIXES.some((s) => rightFrag.startsWith(s)))
      if (keepHyphen) out += line.text
      else out = out.replace(/[-\u2010]$/, '') + line.text
    } else {
      out += (line.hasBreakBefore || line.pageBreakBefore ? '\n' : ' ') + line.text
    }
    prevText = line.text
    prevBreak = line.hasBreakBefore || line.pageBreakBefore
  }
  return out.trim() || null
}

interface LinkInfo {
  url?: string
  dest?: unknown
  rect: number[]
}

/**
 * App-owned PDF view (Obsidian-style): continuously rendered pages fit to the
 * pane width — no built-in viewer chrome. Toolbar shows the current page and
 * zoom; ⌘/Ctrl +/−/0 and Ctrl/⌘ + mouse wheel (pinch) zoom the document.
 */
export function PdfViewer({ vaultId, relPath }: PdfViewerProps): React.JSX.Element {
  return (
    <div className="h-full w-full overflow-auto bg-neutral-200 dark:bg-neutral-900">
      <PdfBody key={relPath} vaultId={vaultId} relPath={relPath} />
    </div>
  )
}

function PdfBody({ vaultId, relPath }: { vaultId: string; relPath: string }): React.JSX.Element {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const pageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const firstPageRender = useRef(true)
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [numPages, setNumPages] = useState(0)
  const [page, setPage] = useState(1)
  const [pageVisible, setPageVisible] = useState(false)
  const [pageDraft, setPageDraft] = useState<string | null>(null)
  const pageCancelRef = useRef(false)
  const [pillHovered, setPillHovered] = useState(false)
  const [editingPage, setEditingPage] = useState(false)
  const [zoom, setZoom] = useState<number | null>(null) // null = fit width
  const [error, setError] = useState<string | null>(null)
  const zoomRef = useRef(zoom) // latest zoom, read by the deferred bitmap renderer
  const pagesRenderRef = useRef<(() => void) | null>(null)
  const linkAnnotationsRef = useRef(new Map<number, LinkInfo[]>())
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [matchInfo, setMatchInfo] = useState({ total: 0, current: 0 })
  const searchOpenRef = useRef(false) // mirror for the global key handler
  const searchInputRef = useRef<HTMLInputElement>(null)
  const searchTokenRef = useRef(0) // cancels stale search scans
  const matchesRef = useRef<SearchMatch[]>([])
  const activeMatchRef = useRef(-1)

  const getLinkAnnotations = async (
    pdfPage: PDFPageProxy
  ): Promise<{ url?: string; dest?: unknown; rect: number[] }[]> => {
    const cached = linkAnnotationsRef.current.get(pdfPage.pageNumber)
    if (cached) return cached
    const annotations = await pdfPage.getAnnotations()
    const links = annotations
      .filter((a) => a.subtype === 'Link' && (a.url || a.dest) && Array.isArray(a.rect))
      .map((a) => ({
        url: typeof a.url === 'string' ? a.url : undefined,
        dest: a.dest as unknown,
        rect: (a.rect as number[]).map((v) => Number(v))
      }))
    linkAnnotationsRef.current.set(pdfPage.pageNumber, links)
    return links
  }

  const jumpToDest = async (dest: unknown): Promise<void> => {
    if (!doc) return
    try {
      const explicit = typeof dest === 'string' ? await doc.getDestination(dest) : dest
      if (!Array.isArray(explicit) || explicit.length === 0) return
      const pageIndex = (await doc.getPageIndex(explicit[0])) + 1
      const destPage = await doc.getPage(pageIndex)
      const vp = destPage.getViewport({ scale: 1 })
      // Explicit destinations are flat arrays: [pageRef, view, ...params] —
      // e.g. [ref, { name: 'XYZ' }, left, top, zoom] or [ref, { name: 'FitH' },
      // top]. View coordinates are in PDF user space (y from the page bottom).
      const view = explicit[1]
      const toTopDown = (userY: unknown): number =>
        Math.max(0, vp.height - (typeof userY === 'number' ? userY : vp.height))
      let yTopDown = 0
      if (view && typeof view === 'object' && 'name' in view) {
        if (view.name === 'XYZ') yTopDown = toTopDown(explicit[3])
        else if (view.name === 'FitH') yTopDown = toTopDown(explicit[2])
      } else if (Array.isArray(view)) {
        yTopDown = toTopDown(view[1])
      } else if (view && typeof view === 'object') {
        const v = view as { top?: number; y?: number }
        if (typeof v.top === 'number') yTopDown = toTopDown(v.top)
        else if (typeof v.y === 'number') yTopDown = toTopDown(v.y)
      }
      const scroller = scrollerRef.current
      const wrapper = scroller?.querySelector<HTMLDivElement>(`[data-page-wrapper="${pageIndex}"]`)
      if (!scroller || !wrapper) return
      const yCss = (yTopDown / vp.height) * wrapper.offsetHeight
      const top =
        wrapper.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top +
        scroller.scrollTop +
        yCss -
        12
      scroller.scrollTop = Math.max(0, top)
    } catch {
      // Unresolvable destination — ignore.
    }
  }

  useEffect(() => {
    let cancelled = false
    let task: ReturnType<typeof pdfjsLib.getDocument> | null = null
    const run = async (): Promise<void> => {
      try {
        const res = await window.api.vault.readFile({ id: vaultId, relPath })
        if (cancelled) return
        if (!res.ok) {
          setError(res.error.message)
          return
        }
        // Copy the bytes: pdf.js takes ownership of (and detaches) the buffer.
        task = pdfjsLib.getDocument({ data: new Uint8Array(res.data) })
        const loaded = await task.promise
        if (cancelled) {
          void task.destroy()
          return
        }
        setDoc(loaded)
        setNumPages(loaded.numPages)
        setPage(1)
        void ensureWordSet() // prefetch the hyphenation dictionary
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load PDF')
      }
    }
    void run()
    return () => {
      cancelled = true
      if (task) void task.destroy()
    }
  }, [vaultId, relPath])

  // Bitmap renderer: draws pages at the current zoom/width into offscreen
  // buffers and swaps them in with one synchronous paint, so a canvas is
  // never left blank mid-render (this is what eliminates the flicker).
  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller || !doc) return
    let cancelled = false
    let renderTimer: ReturnType<typeof setTimeout> | undefined
    let raf = 0
    const inFlight: RenderTask[] = []
    const inFlightText: Array<{ cancel?: () => void }> = []

    const cancelTextLayers = (): void => {
      for (const layer of inFlightText) layer.cancel?.()
      inFlightText.length = 0
    }

    const applySizes = (): void => {
      const base = Math.min(scroller.clientWidth - 48, BASE_MAX) // inner px-6 padding
      if (base <= 0) return
      const displayWidth = base * (zoomRef.current ?? 1)
      scroller.querySelectorAll<HTMLDivElement>('[data-page-wrapper]').forEach((wrapper) => {
        wrapper.style.width = `${displayWidth}px`
        rescaleTextLayer(wrapper, displayWidth)
      })
    }

    // Rebuilds the selectable text layer for a page at CSS-pixel scale.
    const buildTextLayer = async (
      container: HTMLDivElement,
      pdfPage: PDFPageProxy,
      viewport: PageViewport
    ): Promise<void> => {
      container.replaceChildren()
      container.style.width = `${viewport.width}px`
      container.style.height = `${viewport.height}px`
      container.style.setProperty('--scale-factor', String(viewport.scale))
      container.style.setProperty('--total-scale-factor', String(viewport.scale))
      const layer = new pdfjsLib.TextLayer({
        textContentSource: pdfPage.streamTextContent(),
        container,
        viewport
      })
      inFlightText.push(layer)
      await layer.render()
      // Drop printed page numbers (standalone numerals / roman numerals in
      // the bottom margin) so cross-page selections copy flowing text only.
      const bottomLimit = container.offsetHeight * 0.92
      const heightLimit = container.offsetHeight * 0.05
      container.querySelectorAll('span').forEach((span) => {
        const text = (span.textContent ?? '').trim()
        if (!text || !PAGE_NUMBER_RE.test(text)) return
        if (span.offsetHeight > heightLimit) return
        if (span.offsetTop + span.offsetHeight >= bottomLimit) span.remove()
      })
      // Paragraph-aware copying: insert an extra break at large vertical gaps
      // (paragraph / column boundaries). The document-level copy handler then
      // joins lines within a paragraph with spaces and keeps these breaks.
      const nodes = Array.from(container.querySelectorAll<HTMLElement>('span, br'))
      const lineTops: number[] = []
      let expectLineStart = true
      for (const node of nodes) {
        if (node instanceof HTMLBRElement) {
          expectLineStart = true
          continue
        }
        if (!expectLineStart) continue
        expectLineStart = false
        lineTops.push(node.offsetTop)
      }
      if (lineTops.length > 2) {
        const diffs: number[] = []
        for (let i = 1; i < lineTops.length; i++) {
          const gap = lineTops[i] - lineTops[i - 1]
          if (gap > 0 && gap < container.offsetHeight * 0.2) diffs.push(gap)
        }
        diffs.sort((a, b) => a - b)
        const pitch = diffs[Math.floor(diffs.length / 2)] || 0
        const boundaryGap = Math.max(pitch * 1.7, 8)
        let prevLineTop: number | null = null
        expectLineStart = true
        for (const node of nodes) {
          if (node instanceof HTMLBRElement) {
            expectLineStart = true
            continue
          }
          if (!expectLineStart) continue
          expectLineStart = false
          if (prevLineTop !== null && Math.abs(node.offsetTop - prevLineTop) > boundaryGap) {
            // Mark it: pdf.js itself appends <br>s at every end-of-line, and
            // the copy handler must only honor these paragraph markers.
            const br = document.createElement('br')
            br.dataset.paraBreak = '1'
            node.parentNode?.insertBefore(br, node)
          }
          prevLineTop = node.offsetTop
        }
      }
    }

    const renderAll = (): void => {
      for (const t of inFlight) t.cancel()
      inFlight.length = 0
      cancelTextLayers()
      const base = Math.min(scroller.clientWidth - 48, BASE_MAX) // inner px-6 padding
      if (base <= 0) return
      const displayWidth = base * (zoomRef.current ?? 1)
      // Keep the reading position roughly stable across zoom changes.
      const ratio = scroller.scrollHeight > 0 ? scroller.scrollTop / scroller.scrollHeight : 0
      const dpr = window.devicePixelRatio || 1

      const run = async (): Promise<void> => {
        for (let n = 1; n <= doc.numPages; n++) {
          if (cancelled) return
          try {
            const pdfPage = await doc.getPage(n)
            if (cancelled) return
            const unit = pdfPage.getViewport({ scale: 1 })
            const viewport = pdfPage.getViewport({ scale: (displayWidth / unit.width) * dpr })
            const canvas = scroller.querySelector<HTMLCanvasElement>(`canvas[data-page="${n}"]`)
            const wrapper = canvas?.closest<HTMLDivElement>('[data-page-wrapper]')
            if (!canvas || !wrapper) continue
            // Render offscreen; the previously drawn bitmap stays visible
            // until the new one swaps in atomically.
            const off = document.createElement('canvas')
            off.width = viewport.width
            off.height = viewport.height
            const offCtx = off.getContext('2d')
            if (!offCtx) continue
            const task = pdfPage.render({ canvas: off, canvasContext: offCtx, viewport })
            inFlight.push(task)
            await task.promise
            if (cancelled) return
            canvas.width = viewport.width
            canvas.height = viewport.height
            canvas.getContext('2d')?.drawImage(off, 0, 0)
            // Rebuild the selectable text layer at CSS-pixel scale (no dpr —
            // it is positioned vectorially, so no retina multiplier needed).
            const textDiv = wrapper.querySelector<HTMLDivElement>('.textLayer')
            if (textDiv) {
              const cssViewport = pdfPage.getViewport({ scale: displayWidth / unit.width })
              await buildTextLayer(textDiv, pdfPage, cssViewport)
              if (cancelled) return
              textDiv.dataset.renderWidth = String(displayWidth)
              textDiv.style.transform = 'none'
            }
            // Link annotations from the PDF itself — clickable overlays for
            // citation/figure/section jumps and external URLs.
            const annotationDiv = wrapper.querySelector<HTMLDivElement>('.annotationLayer')
            if (annotationDiv && !annotationDiv.hasChildNodes()) {
              void (async () => {
                const links = await getLinkAnnotations(pdfPage)
                if (cancelled) return
                const vp = pdfPage.getViewport({ scale: 1 })
                for (const link of links) {
                  const [x0, y0, x1, y1] = link.rect
                  const div = document.createElement('div')
                  div.className = 'link-annotation'
                  div.title = link.url ?? 'Go to link target'
                  div.style.left = `${((x0 / vp.width) * 100).toFixed(2)}%`
                  div.style.top = `${(((vp.height - y1) / vp.height) * 100).toFixed(2)}%`
                  div.style.width = `${(((x1 - x0) / vp.width) * 100).toFixed(2)}%`
                  div.style.height = `${(((y1 - y0) / vp.height) * 100).toFixed(2)}%`
                  div.addEventListener('click', () => {
                    const selection = document.getSelection()
                    if (selection && !selection.isCollapsed) return
                    if (link.url) {
                      window.open(link.url, '_blank')
                      return
                    }
                    void jumpToDest(link.dest)
                  })
                  annotationDiv.append(div)
                }
              })()
            }
          } catch {
            // Render cancelled (tab switch / resize) — nothing to do.
          }
        }
        if (cancelled) return
        scroller.scrollTop = ratio * scroller.scrollHeight
      }
      void run()
    }

    const scheduleRender = (): void => {
      clearTimeout(renderTimer)
      renderTimer = setTimeout(() => {
        if (!cancelled) renderAll()
      }, 140)
    }

    // Expose the deferred re-render to the zoom effect.
    pagesRenderRef.current = renderAll
    renderAll()
    const observer = new ResizeObserver(() => {
      // Live CSS rescale while the pane is being dragged; crisp re-render
      // once the resizing settles.
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(applySizes)
      scheduleRender()
    })
    observer.observe(scroller)
    return () => {
      cancelled = true
      clearTimeout(renderTimer)
      cancelAnimationFrame(raf)
      observer.disconnect()
      for (const t of inFlight) t.cancel()
      cancelTextLayers()
      pagesRenderRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- helpers close over doc/refs; the effect intentionally re-runs on doc changes only
  }, [doc])

  // Track the page under the upper-middle of the viewport while scrolling.
  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller || !doc) return
    let raf = 0
    const compute = (): void => {
      const rect = scroller.getBoundingClientRect()
      const focus = rect.top + rect.height / 3
      let current = 1
      const canvases = scroller.querySelectorAll<HTMLCanvasElement>('canvas[data-page]')
      canvases.forEach((canvas) => {
        if (canvas.getBoundingClientRect().top <= focus) {
          current = Number(canvas.dataset.page)
        }
      })
      setPage(current)
    }
    const onScroll = (): void => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(compute)
    }
    compute()
    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      cancelAnimationFrame(raf)
      scroller.removeEventListener('scroll', onScroll)
    }
  }, [doc])

  // Flash the page pill on page change.
  useEffect(() => {
    if (firstPageRender.current) {
      firstPageRender.current = false
      return
    }
    setPageVisible(true)
    if (pageTimerRef.current) clearTimeout(pageTimerRef.current)
    pageTimerRef.current = setTimeout(() => setPageVisible(false), 1800)
    return () => {
      if (pageTimerRef.current) clearTimeout(pageTimerRef.current)
    }
  }, [page])

  const clearSearchHighlights = useCallback((): void => {
    matchesRef.current = []
    activeMatchRef.current = -1
    setMatchInfo({ total: 0, current: 0 })
    scrollerRef.current
      ?.querySelectorAll<HTMLDivElement>('.searchLayer')
      .forEach((layer) => layer.replaceChildren())
  }, [])

  // Close (Esc / ×): hides the bar and clears all highlights.
  const closeSearch = useCallback((): void => {
    searchOpenRef.current = false
    clearSearchHighlights()
    setSearchOpen(false)
  }, [clearSearchHighlights])

  // Zoom + search shortcuts: ⌘/Ctrl +/−/0/F and Escape (the app menu has no
  // matching accelerators, so these reach the renderer and stay scoped to the
  // open PDF).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && searchOpenRef.current) {
        e.preventDefault()
        closeSearch()
        return
      }
      if (!(e.metaKey || e.ctrlKey)) return
      if (e.key === 'f') {
        e.preventDefault()
        searchOpenRef.current = true
        setSearchOpen(true)
        searchInputRef.current?.focus()
        searchInputRef.current?.select()
        return
      }
      const target = e.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return
      }
      if (e.key === '=' || e.key === '+') {
        e.preventDefault()
        setZoom((z) => zoomStepIn(z))
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault()
        setZoom((z) => zoomStepOut(z))
      } else if (e.key === '0') {
        e.preventDefault()
        setZoom(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [closeSearch])

  // Ctrl/⌘ + mouse wheel (and trackpad pinch) zooms the document.
  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      // Damped, proportional zoom: trackpads fire many small events per
      // gesture, so scale by deltaY (capped per event to keep momentum from
      // overshooting) instead of applying a fixed step.
      const delta = Math.max(-40, Math.min(40, e.deltaY))
      setZoom((z) => clampZoom((z ?? 1) * Math.exp(-delta * 0.004)))
    }
    scroller.addEventListener('wheel', onWheel, { passive: false })
    return () => scroller.removeEventListener('wheel', onWheel)
  }, [])

  // Zoom changes: keep zoomRef current for the deferred bitmap renderer,
  // rescale the page wrappers immediately (CSS width + text-layer transform —
  // instant, keeps text selectable and aligned), then schedule one crisp
  // bitmap re-render once the zoom gesture settles.
  useEffect(() => {
    zoomRef.current = zoom
    const scroller = scrollerRef.current
    if (!scroller || !doc) return
    const base = Math.min(scroller.clientWidth - 48, BASE_MAX) // inner px-6 padding
    if (base <= 0) return
    const displayWidth = base * (zoom ?? 1)
    scroller.querySelectorAll<HTMLDivElement>('[data-page-wrapper]').forEach((wrapper) => {
      wrapper.style.width = `${displayWidth}px`
      rescaleTextLayer(wrapper, displayWidth)
    })
    const timer = setTimeout(() => pagesRenderRef.current?.(), 140)
    return () => clearTimeout(timer)
  }, [zoom, doc])

  // Mirror search-open state for the key handler; focus the input on open.
  useEffect(() => {
    searchOpenRef.current = searchOpen
    if (searchOpen) {
      searchInputRef.current?.focus()
      searchInputRef.current?.select()
    }
  }, [searchOpen])

  const renderSearchHighlights = useCallback((): void => {
    const scroller = scrollerRef.current
    if (!scroller) return
    scroller
      .querySelectorAll<HTMLDivElement>('.searchLayer')
      .forEach((layer) => layer.replaceChildren())
    matchesRef.current.forEach((match, idx) => {
      for (const part of match.parts) {
        const layer = scroller.querySelector<HTMLDivElement>(
          `[data-page-wrapper="${part.page}"] > .searchLayer`
        )
        if (!layer) continue
        for (const rect of part.rects) {
          const div = document.createElement('div')
          div.className = `search-highlight${idx === activeMatchRef.current ? ' active' : ''}`
          div.dataset.idx = String(idx)
          div.style.left = `${rect.left}%`
          div.style.top = `${rect.top}%`
          div.style.width = `${rect.width}%`
          div.style.height = `${rect.height}%`
          layer.append(div)
        }
      }
    })
  }, [])

  // Scrolls to a match and marks it active. Index wraps in both directions.
  const goToMatch = useCallback((idx: number): void => {
    const total = matchesRef.current.length
    if (!total) return
    const next = ((idx % total) + total) % total
    activeMatchRef.current = next
    setMatchInfo({ total, current: next + 1 })
    const match = matchesRef.current[next]
    const scroller = scrollerRef.current
    const wrapper = scroller?.querySelector<HTMLDivElement>(
      `[data-page-wrapper="${match.parts[0].page}"]`
    )
    if (!scroller || !wrapper) return
    scroller.querySelectorAll<HTMLElement>('.search-highlight').forEach((el) => {
      el.classList.toggle('active', el.dataset.idx === String(next))
    })
    const top =
      wrapper.getBoundingClientRect().top -
      scroller.getBoundingClientRect().top +
      scroller.scrollTop +
      (match.parts[0].rects[0].top / 100) * wrapper.offsetHeight -
      scroller.clientHeight / 3
    scroller.scrollTop = Math.max(0, top)
  }, [])

  // Scans every page's text for the query (including hyphen-split words that
  // straddle a page boundary) and stores highlight rects in page percentages.
  // Token-checked so stale scans abort mid-flight.
  const runSearch = useCallback(
    async (rawQuery: string): Promise<void> => {
      const token = ++searchTokenRef.current
      matchesRef.current = []
      activeMatchRef.current = -1
      const needle = normalizeForSearch(rawQuery).norm
      if (!doc || !needle) {
        renderSearchHighlights()
        setMatchInfo({ total: 0, current: 0 })
        return
      }
      const results: SearchMatch[] = []
      let prev: PageText | null = null
      for (let p = 1; p <= doc.numPages; p++) {
        if (token !== searchTokenRef.current) return
        let text: PageText
        try {
          const pdfPage = await doc.getPage(p)
          if (token !== searchTokenRef.current) return
          text = await extractPageText(pdfPage, p)
          if (token !== searchTokenRef.current) return
        } catch {
          prev = null // page unreadable — skip it (and any boundary chain)
          continue
        }
        // Matches fully inside this page.
        let from = 0
        for (;;) {
          const at = text.norm.indexOf(needle, from)
          if (at === -1) break
          from = at + 1
          const rects = findRects(text, text.map[at], text.map[at + needle.length - 1] + 1)
          if (rects.length) results.push({ parts: [{ page: p, rects }] })
        }
        // Hyphen-split word crossing the previous page boundary: the needle's
        // head ends the previous page, its tail starts this one.
        if (prev) {
          for (let s = 1; s < needle.length; s++) {
            if (!prev.norm.endsWith(needle.slice(0, s))) continue
            if (!text.norm.startsWith(needle.slice(s))) continue
            const headRects = findRects(prev, prev.map[prev.norm.length - s], prev.rawLen)
            const tailRects = findRects(text, text.map[0], text.map[needle.length - s - 1] + 1)
            if (headRects.length && tailRects.length) {
              results.push({
                parts: [
                  { page: prev.page, rects: headRects },
                  { page: p, rects: tailRects }
                ]
              })
              break // at most one cross-page match per boundary
            }
          }
        }
        prev = text
      }
      if (token !== searchTokenRef.current) return
      matchesRef.current = results
      renderSearchHighlights()
      if (results.length) goToMatch(0)
      else setMatchInfo({ total: 0, current: 0 })
    },
    [doc, goToMatch, renderSearchHighlights]
  )

  // Live search: re-run (debounced) as the query changes.
  useEffect(() => {
    if (!searchOpen) return
    const timer = setTimeout(() => void runSearch(searchQuery), 250)
    return () => clearTimeout(timer)
  }, [searchQuery, searchOpen, runSearch])

  // Paragraph-aware copy: rebuild flowing text from the selected text-layer
  // spans (the browser default emits one line per span). Selections outside
  // the PDF text layers fall through to the default copy behavior.
  useEffect(() => {
    const onCopy = (e: ClipboardEvent): void => {
      const scroller = scrollerRef.current
      const sel = document.getSelection()
      if (!scroller || !sel || sel.isCollapsed || sel.rangeCount === 0) return
      const text = buildSelectionText(sel, scroller)
      if (text === null) return
      e.preventDefault()
      e.clipboardData?.setData('text/plain', text)
    }
    document.addEventListener('copy', onCopy)
    return () => document.removeEventListener('copy', onCopy)
  }, [])

  const jumpToPage = (n: number): void => {
    const scroller = scrollerRef.current
    const wrapper = scroller?.querySelector<HTMLDivElement>(`[data-page-wrapper="${n}"]`)
    if (!scroller || !wrapper) return
    const top =
      wrapper.getBoundingClientRect().top -
      scroller.getBoundingClientRect().top +
      scroller.scrollTop -
      12
    scroller.scrollTop = Math.max(0, top)
  }

  const commitPageEdit = (): void => {
    if (pageCancelRef.current) {
      pageCancelRef.current = false
    } else {
      const parsed = parseInt(pageDraft ?? '', 10)
      if (!Number.isNaN(parsed)) jumpToPage(Math.min(numPages, Math.max(1, parsed)))
    }
    setEditingPage(false)
    setPageDraft(null)
  }

  const pillShown = pageVisible || pillHovered || editingPage

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div className="relative flex h-10 shrink-0 items-center border-b border-line bg-surface px-2">
        <div className="absolute left-1/2 flex -translate-x-1/2 items-center gap-0.5">
          <button
            type="button"
            className={btnIcon}
            title="Zoom out (⌘−)"
            onClick={() => setZoom((z) => zoomStepOut(z))}
          >
            <MinusIcon className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="min-w-14 rounded-md px-2 py-1 text-center text-xs font-medium text-ink-soft transition-colors hover:bg-surface-raised hover:text-ink"
            title="Reset zoom (⌘0)"
            onClick={() => setZoom(null)}
          >
            {zoomLabel(zoom)}
          </button>
          <button
            type="button"
            className={btnIcon}
            title="Zoom in (⌘+)"
            onClick={() => setZoom((z) => zoomStepIn(z))}
          >
            <PlusIcon className="h-4 w-4" />
          </button>
        </div>
        <button
          type="button"
          className={`${btnIcon} absolute right-2`}
          title="Search in PDF (⌘F)"
          onClick={() => {
            searchOpenRef.current = true
            setSearchOpen(true)
          }}
        >
          <SearchIcon className="h-4 w-4" />
        </button>
      </div>
      {searchOpen && (
        <div className="absolute right-3 top-12 z-20 flex items-center gap-1 rounded-lg border border-line bg-surface px-2 py-1.5 shadow-lg">
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            placeholder="Search in PDF"
            spellCheck={false}
            className="w-44 bg-transparent text-sm text-ink outline-none placeholder:text-ink-soft"
            onChange={(event) => setSearchQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                goToMatch(activeMatchRef.current + (event.shiftKey ? -1 : 1))
              } else if (event.key === 'Escape') {
                event.preventDefault()
                closeSearch()
              }
            }}
          />
          <span className="min-w-16 whitespace-nowrap text-center text-xs tabular-nums text-ink-soft">
            {searchQuery
              ? matchInfo.total > 0
                ? `${matchInfo.current}/${matchInfo.total}`
                : 'No matches'
              : ''}
          </span>
          <button
            type="button"
            className={btnIcon}
            title="Previous match (Shift+Enter)"
            onClick={() => goToMatch(activeMatchRef.current - 1)}
          >
            <ChevronUpIcon className="h-4 w-4" />
          </button>
          <button
            type="button"
            className={btnIcon}
            title="Next match (Enter)"
            onClick={() => goToMatch(activeMatchRef.current + 1)}
          >
            <ChevronDownIcon className="h-4 w-4" />
          </button>
          <button
            type="button"
            className={btnIcon}
            title="Close search (Esc)"
            onClick={closeSearch}
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>
      )}
      <div ref={scrollerRef} className="min-h-0 flex-1 overflow-auto">
        {error ? (
          <div className="flex h-full items-center justify-center px-8 text-sm text-ink-soft">
            Unable to load this PDF — {error}
          </div>
        ) : doc ? (
          <div className="mx-auto flex w-fit min-w-full flex-col items-center gap-5 px-6 py-6">
            {Array.from({ length: numPages }, (_, i) => (
              <div
                key={i + 1}
                data-page-wrapper={i + 1}
                className="relative overflow-hidden rounded-md bg-white shadow-lg"
              >
                <canvas data-page={i + 1} className="block w-full" />
                <div className="annotationLayer" />
                <div data-text-layer={i + 1} className="textLayer" />
                <div className="searchLayer" />
              </div>
            ))}
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-ink-soft">
            Loading…
          </div>
        )}
      </div>
      <div
        className={`absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-full bg-neutral-800/85 px-3.5 py-1.5 text-xs font-medium tabular-nums text-white shadow-lg transition-opacity duration-300 ${
          pillShown ? 'opacity-100' : 'opacity-0'
        }`}
        style={{ pointerEvents: pillShown ? 'auto' : 'none' }}
        onMouseEnter={() => setPillHovered(true)}
        onMouseLeave={() => setPillHovered(false)}
      >
        {editingPage ? (
          <>
            <input
              autoFocus
              type="text"
              inputMode="numeric"
              className="w-10 rounded-md border border-white/40 bg-transparent px-1 py-0.5 text-center text-xs text-white outline-none"
              value={pageDraft ?? ''}
              onChange={(event) => setPageDraft(event.target.value.replace(/[^0-9]/g, ''))}
              onKeyDown={(event) => {
                if (event.key === 'Enter') commitPageEdit()
                else if (event.key === 'Escape') {
                  pageCancelRef.current = true
                  commitPageEdit()
                }
              }}
            />
            <span> / {numPages}</span>
          </>
        ) : (
          <>
            <button
              type="button"
              title="Jump to page"
              className="cursor-pointer bg-transparent"
              onClick={() => {
                setPageDraft(String(page))
                setEditingPage(true)
              }}
            >
              {page}
            </button>
            <span> / {numPages}</span>
          </>
        )}
      </div>
    </div>
  )
}
