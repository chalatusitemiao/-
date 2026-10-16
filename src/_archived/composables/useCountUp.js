import { ref, watch, onUnmounted } from 'vue'

/**
 * 数字滚动（KPI 大数字入场 / 数值变化时）。
 * 尊重系统「减弱动效」设置 —— 那种情况下直接给终值。
 */
export function useCountUp(source, { duration = 780, decimals = 0 } = {}) {
  const reduced =
    typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
  const display = ref(Number(source.value) || 0)
  let raf = 0
  let from = display.value
  let startTs = 0

  const easeOut = (t) => 1 - Math.pow(1 - t, 3)

  function step(ts) {
    if (!startTs) startTs = ts
    const p = Math.min(1, (ts - startTs) / duration)
    const v = from + (Number(source.value) - from) * easeOut(p)
    display.value = decimals ? Math.round(v * 10 ** decimals) / 10 ** decimals : Math.round(v)
    if (p < 1) raf = requestAnimationFrame(step)
    else display.value = Number(source.value) || 0
  }

  function run() {
    cancelAnimationFrame(raf)
    if (reduced) {
      display.value = Number(source.value) || 0
      return
    }
    from = display.value
    startTs = 0
    raf = requestAnimationFrame(step)
  }

  watch(source, run, { immediate: true })
  onUnmounted(() => cancelAnimationFrame(raf))
  return display
}
