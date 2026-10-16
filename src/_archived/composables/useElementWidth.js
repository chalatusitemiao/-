import { ref, onMounted, onUnmounted } from 'vue'

/**
 * 测量容器宽度。SVG 图表要按真实像素宽度算坐标，
 * 不能只靠 viewBox + preserveAspectRatio（会把描边和文字拉变形）。
 */
export function useElementWidth(fallback = 320) {
  const el = ref(null)
  const width = ref(fallback)
  let ro = null

  onMounted(() => {
    if (!el.value) return
    const apply = () => {
      const w = el.value.clientWidth
      if (w && Math.abs(w - width.value) > 0.5) width.value = w
    }
    apply()
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(apply)
      ro.observe(el.value)
    } else {
      window.addEventListener('resize', apply)
    }
  })
  onUnmounted(() => {
    if (ro) ro.disconnect()
  })
  return { el, width }
}
