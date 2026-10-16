/* 数字与金额格式化：全站统一口径，避免各页面各写一套 */

/** 千分位整数 */
export function num(v, d = 0) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—'
  return Number(v).toLocaleString('zh-CN', { minimumFractionDigits: d, maximumFractionDigits: d })
}

/** 金额（元），默认千分位、无小数 */
export const yuan = (v, d = 0) => '¥' + num(v, d)

/** 自动选单位：亿元 / 万元 / 元 */
export function scaleMoney(v) {
  const a = Math.abs(v || 0)
  if (a >= 1e8) return { value: v / 1e8, unit: '亿元', d: 2 }
  if (a >= 1e4) return { value: v / 1e4, unit: '万元', d: 1 }
  return { value: v || 0, unit: '元', d: 0 }
}

/** 紧凑金额字符串 */
export function compactMoney(v) {
  const s = scaleMoney(v)
  return `${num(s.value, s.d)}${s.unit}`
}

/** 百分数 */
export const pct = (x, d = 1) => (x === null || x === undefined || Number.isNaN(x) ? '—' : (x * 100).toFixed(d) + '%')

/** 带符号百分数（用于环比） */
export const signedPct = (x, d = 1) => (!x ? '0.0%' : (x > 0 ? '+' : '') + (x * 100).toFixed(d) + '%')

/** 里程 */
export const km = (v) => num(v) + ' km'

/** 日期显示 */
export const md = (dateStr) => {
  if (!dateStr) return '—'
  const p = dateStr.split('-')
  return `${Number(p[1])}/${Number(p[2])}`
}
export const ymd = (dateStr) => (dateStr ? dateStr.replace(/-/g, '/') : '—')

/**
 * 环比胶囊的样式与文案。
 * goodWhen='down' 表示“下降是好事”（成本类指标）。
 */
export function deltaInfo(x, { goodWhen = 'down', suffix = '' } = {}) {
  const flat = !x || Math.abs(x) < 0.0005
  if (flat) return { cls: 'delta--flat', txt: '持平' + suffix, arrow: 'flat' }
  const up = x > 0
  let cls = up ? 'delta--up' : 'delta--down'
  const good = goodWhen === 'down' ? !up : up
  cls = good ? 'delta--good' : 'delta--bad'
  return { cls, txt: signedPct(x) + suffix, arrow: up ? 'up' : 'down' }
}

/** 百分点变化（毛利率等已经是百分数的指标） */
export function ptDelta(x) {
  const flat = !x || Math.abs(x) < 0.0005
  if (flat) return { cls: 'delta--flat', txt: '持平', arrow: 'flat' }
  return {
    cls: x > 0 ? 'delta--good' : 'delta--bad',
    txt: (x > 0 ? '+' : '') + (x * 100).toFixed(2) + 'pt',
    arrow: x > 0 ? 'up' : 'down',
  }
}
