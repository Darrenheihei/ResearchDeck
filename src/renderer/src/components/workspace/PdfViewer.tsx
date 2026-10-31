import { useEffect, useRef, useState } from 'react'
import type { PageViewport, PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist'
import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { btnIcon } from '../../lib/ui'
import { MinusIcon, PlusIcon } from '../icons'

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
            node.parentNode?.insertBefore(document.createElement('br'), node)
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

  // Zoom shortcuts: ⌘/Ctrl +, −, 0 (the app menu has no zoom accelerators, so
  // these reach the renderer and stay scoped to the open PDF).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.metaKey || e.ctrlKey)) return
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
  }, [])

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
      </div>
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
