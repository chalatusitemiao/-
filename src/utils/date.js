/* ============================================================
   日期解析与格式化
   ------------------------------------------------------------
   Excel 里的日期是一颗雷：单元格看起来是「2022-03-18」，
   实际存的是序列号 44638（t="n" 的数字单元格），
   只有靠单元格样式才知道它是日期。我们只读值不读样式，
   所以在「购置日期」这一类字段上必须对数字做一次序列号还原。
   ============================================================ */

const PAD = (n) => String(n).padStart(2, '0')

/** Date → 'YYYY-MM-DD' */
export const toISO = (d) => (d ? `${d.getFullYear()}-${PAD(d.getMonth() + 1)}-${PAD(d.getDate())}` : '')

/* ---------- 月份（成本 / 收入按月看的时候用） ---------- */

/** 当前月份 'YYYY-MM' */
export const currentMonth = (today = new Date()) => `${today.getFullYear()}-${PAD(today.getMonth() + 1)}`

/** 是不是未来的月份（字符串比较对 'YYYY-MM' 是成立的） */
export const isFutureMonth = (m, today = new Date()) => !!m && m !== 'all' && String(m) > currentMonth(today)

/**
 * 把月份钳到「不超过当月」。
 * 未来的月份没有意义 —— 折旧不会提前计提，趟次与成本也不允许填未来的日期，
 * 所以那个月份永远是空的；允许选到它只会让人以为「数据丢了」。
 */
export function clampMonth(m, today = new Date()) {
  if (!m || m === 'all') return m
  const now = currentMonth(today)
  return String(m) > now ? now : String(m)
}

/* Excel 序列号以 1899-12-30 为原点，
   这样正好抵消 Excel 把 1900 当成闰年的历史 bug */
const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30)

export function excelSerialToDate(n) {
  const t = EXCEL_EPOCH_UTC + Math.round(n) * 86400000
  const d = new Date(t)
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

/** 严格构造，拒绝 2023-02-30 这种被 Date 自动进位的假日期 */
function mk(y, mo, d) {
  if (!(y >= 1900 && y <= 2200) || mo < 1 || mo > 12 || d < 1 || d > 31) return null
  const dt = new Date(y, mo - 1, d)
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null
  return dt
}

/**
 * 把各种写法解析成当天零点的 Date；解析不了返回 null。
 * 支持：Date、Excel 序列号、2022-03-18、2022/3/18、2022.3.18、
 *      2022年3月18日、20220318、2022-03（当月 1 号）
 */
export function parseDate(v) {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : mk(v.getFullYear(), v.getMonth() + 1, v.getDate())
  if (typeof v === 'number' && Number.isFinite(v)) {
    if (v < 1000 || v > 80000) return null // 不在合理日期区间，当脏数据
    return excelSerialToDate(v)
  }
  const s = String(v ?? '').trim()
  if (!s) return null

  let m = /^(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?$/.exec(s)
  if (m) return mk(+m[1], +m[2], +m[3])

  m = /^(\d{4})(\d{2})(\d{2})$/.exec(s)
  if (m) return mk(+m[1], +m[2], +m[3])

  m = /^(\d{4})\s*[-/.年]\s*(\d{1,2})\s*月?$/.exec(s)
  if (m) return mk(+m[1], +m[2], 1)

  const t = Date.parse(s)
  if (!Number.isNaN(t)) {
    const d = new Date(t)
    return mk(d.getFullYear(), d.getMonth() + 1, d.getDate())
  }
  return null
}

/** 任意写法 → 'YYYY-MM-DD'；解析不了返回 '' */
export const toISODate = (v) => toISO(parseDate(v))

/** 两个日期之间的整月数（不足一月不计） */
export function monthsBetween(from, to) {
  if (!from || !to) return 0
  let m = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth())
  if (to.getDate() < from.getDate()) m -= 1
  return Math.max(0, m)
}
