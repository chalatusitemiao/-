/* ============================================================
   路线字段定义与校验（唯一来源）
   ------------------------------------------------------------
   一条路线 = 起点 + 终点 + 公里数 + 途经收费站。
   收费站的价格**按车型逐个存**：同一个站，皮卡和自卸车不是一个价
   （2020 年起全国货车高速按轴型收费，就是这个道理）。

   路线的「主键」是「起点 + 终点」—— 导入时同一个起终点视为同一条路线。
   ============================================================ */
import { parseNumber } from './vehicleRules.js'

export const ROUTE_FIELDS = [
  {
    key: 'from', label: '起点名', required: true, type: 'text', placeholder: 'lubembashi',
    aliases: ['起点名', '起点', '出发地', '发货地', '始发地', 'from', 'origin'],
  },
  {
    key: 'to', label: '终点名', required: true, type: 'text', placeholder: 'kolwezi',
    aliases: ['终点名', '终点', '目的地', '到达地', '卸货地', 'to', 'destination'],
  },
  {
    key: 'distance', label: '公里数', required: true, type: 'number', unit: 'km', placeholder: '108',
    aliases: ['公里数', '里程', '距离', '总里程', '公里', 'distance', 'km'],
  },
]

/** 导入时允许的「长表」附加列：一行一个「收费站 × 车型」的价格 */
export const TOLL_FIELDS = [
  { key: 'station', label: '收费站', required: false, aliases: ['收费站', '收费站名称', '站点', '站名', '收费点'] },
  { key: 'type', label: '车型', required: false, aliases: ['车型', '车辆类型'] },
  { key: 'price', label: '价格', required: false, unit: '元', aliases: ['价格', '收费', '金额', '过路费', '通行费', '费用'] },
]

export const ROUTE_FIELD_MAP = Object.fromEntries(ROUTE_FIELDS.map((f) => [f.key, f]))
export const TOLL_FIELD_MAP = Object.fromEntries(TOLL_FIELDS.map((f) => [f.key, f]))

/* ---------- 归一化 ---------- */
export const normPlace = (v) => String(v ?? '').trim().replace(/\s+/g, '')

/** 路线的标识：起点→终点 */
export const routeKey = (from, to) => `${normPlace(from)}→${normPlace(to)}`
export const routeOf = (r) => routeKey(r.from, r.to)

/** 路线显示名 */
export const routeName = (r) => `${normPlace(r.from)} → ${normPlace(r.to)}`

/** 该车型在这条路线上的总过路费 */
export function routeTollTotal(route, type) {
  if (!route || !Array.isArray(route.tolls)) return 0
  return route.tolls.reduce((a, t) => a + (Number(t.prices?.[type]) || 0), 0)
}

/** 某个收费站在某车型上的价格（没有记就是 0 / 不走这个站） */
export const tollPrice = (toll, type) => Number(toll?.prices?.[type]) || 0

/** 一条路线上的所有非零价格里，最低/最高 —— 列表里用来看区间 */
export function tollRange(route) {
  const vals = []
  for (const t of route?.tolls || []) {
    for (const v of Object.values(t.prices || {})) {
      const n = Number(v)
      if (n > 0) vals.push(n)
    }
  }
  if (!vals.length) return null
  return { min: Math.min(...vals), max: Math.max(...vals) }
}

/* ---------- 校验 ---------- */
const MAX_DISTANCE = 20000

/**
 * @param form { from, to, distance, tolls? }
 * @param ctx  { takenRouteKeys?:Set, selfKey?:string }
 */
export function validateRoute(form, ctx = {}) {
  const errors = {}
  const warnings = {}

  const from = normPlace(form.from)
  const to = normPlace(form.to)
  if (!from) errors.from = '请填写起点名'
  else if (from.length > 20) errors.from = '起点名不超过 20 个字'
  if (!to) errors.to = '请填写终点名'
  else if (to.length > 20) errors.to = '终点名不超过 20 个字'
  if (from && to && from === to) errors.to = '终点不能和起点一样'

  const raw = String(form.distance ?? '').trim()
  const km = parseNumber(form.distance)
  if (!raw) errors.distance = '请填写公里数'
  else if (Number.isNaN(km)) errors.distance = '公里数必须是数字'
  else if (km <= 0) errors.distance = '公里数必须大于 0'
  else if (km > MAX_DISTANCE) errors.distance = `公里数超过 ${MAX_DISTANCE}，请确认是否填错`

  // 起终点重复：这条路线已经有过了
  if (from && to && from !== to && ctx.takenRouteKeys) {
    const key = routeKey(from, to)
    if (key !== ctx.selfKey && ctx.takenRouteKeys.has(key)) {
      errors.to = '这条路线（起点+终点）已经录入过了'
    }
  }

  // 收费站
  const tolls = Array.isArray(form.tolls) ? form.tolls : []
  const tollErrors = {}
  const seen = new Set()
  for (const t of tolls) {
    if (!String(t.station ?? '').trim() && !hasAnyPrice(t)) continue // 整条空行直接忽略
    const r = validateToll(t, { seen })
    if (Object.keys(r.errors).length) tollErrors[t.id] = r.errors
    if (r.warnings.length) warnings['toll_' + t.id] = r.warnings
  }
  if (Object.keys(tollErrors).length) errors.tolls = tollErrors

  return { errors, warnings, ok: Object.keys(errors).length === 0 }
}

const hasAnyPrice = (t) =>
  Object.values(t?.prices || {}).some((v) => String(v ?? '').trim() !== '' && Number(v) > 0)

/**
 * @param toll { station, prices:{车型:价格} }
 * @param ctx  { seen?:Set } 用来查同一路线里的重名收费站
 */
export function validateToll(toll, ctx = {}) {
  const errors = {}
  const warnings = []
  const station = String(toll?.station ?? '').trim()

  if (!station) errors.station = '请填写收费站名称'
  else if (station.length > 30) errors.station = '收费站名称不超过 30 个字'
  else if (ctx.seen && ctx.seen.has(station)) errors.station = '这条路线里已经有同名收费站了'
  if (station && ctx.seen) ctx.seen.add(station)

  const prices = toll?.prices || {}
  let bad = false
  // 车型是自由输入的，所以按实际写进来的键校验，不按基准表遍历
  for (const [type, value] of Object.entries(prices)) {
    const raw = String(value ?? '').trim()
    if (raw === '') continue
    const n = Number(raw)
    if (Number.isNaN(n)) {
      errors['price_' + type] = `${type} 的价格不是数字`
      bad = true
    } else if (n < 0) {
      errors['price_' + type] = `${type} 的价格不能为负`
      bad = true
    } else if (n > 100000) {
      errors['price_' + type] = `${type} 的价格异常，请确认`
      bad = true
    }
  }
  if (!bad && !hasAnyPrice(toll)) warnings.push('这个收费站还没填任何车型的价格，总过路费会算作 0')

  return { errors, warnings, ok: Object.keys(errors).length === 0 }
}

export function toRoutePayload(form) {
  const tolls = (Array.isArray(form.tolls) ? form.tolls : [])
    .filter((t) => String(t.station ?? '').trim() || hasAnyPrice(t))
    .map((t) => {
      // 同样按实际写进来的车型名收，不按基准表过滤，否则自定义车型会被丢掉
      const prices = {}
      for (const [type, value] of Object.entries(t.prices || {})) {
        const name = String(type).trim()
        const raw = String(value ?? '').trim()
        const n = Number(raw)
        if (name && raw !== '' && Number.isFinite(n) && n > 0) prices[name] = Math.round(n * 100) / 100
      }
      return { station: String(t.station).trim(), prices }
    })
  return {
    from: normPlace(form.from),
    to: normPlace(form.to),
    distance: Math.round(parseNumber(form.distance) * 10) / 10,
    tolls,
  }
}
