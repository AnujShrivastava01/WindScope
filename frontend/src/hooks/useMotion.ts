import Lenis from 'lenis'
import 'lenis/dist/lenis.css'
import { useEffect, useState } from 'react'

export function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false)
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!mq) return
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches)
    mq.addEventListener?.('change', onChange)
    return () => mq.removeEventListener?.('change', onChange)
  }, [])
  return reduced
}

/**
 * Smooth (inertial) page scrolling with Lenis, including in-page anchor links.
 * Mounted only by the pages that opt in; skipped when the user prefers reduced motion.
 */
export function useSmoothScroll(enabled = true) {
  const reduced = usePrefersReducedMotion()
  useEffect(() => {
    if (!enabled || reduced) return
    let lenis: Lenis | null = null
    try {
      lenis = new Lenis({ autoRaf: true, anchors: { offset: 0 }, lerp: 0.09, smoothWheel: true })
    } catch {
      return // Environments without full layout APIs keep native scrolling.
    }
    return () => lenis?.destroy()
  }, [enabled, reduced])
}
