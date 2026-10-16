import { ref, onMounted, onUnmounted } from 'vue'

/**
 * 0 → 1 的入场补间。图表（甜甜圈 / 条形 / 堆叠柱）用它做“画出来”的动效。
 * 系统开启「减弱动效」时直接给终值。
 */
export function useTween(duration = 900) {
  const p = ref(0)
  let raf = 0
  let start = 0
  const reduced =
    typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
  const easeOut = (t) => 1 - Math.pow(1 - t, 3)

  function run() {
    cancelAnimationFrame(raf)
    if (reduced) {
      p.value = 1
      return
    }
    start = 0
    const step = (ts) => {
      if (!start) start = ts
      const t = Math.min(1, (ts - start) / duration)
      p.value = easeOut(t)
      if (t < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
  }

  onMounted(run)
  onUnmounted(() => cancelAnimationFrame(raf))
  return { p, run }
}

let uid = 0
export const nextId = (prefix = 'g') => `${prefix}${++uid}`
