/* ============================================================
   路线库：全站唯一的路线数据源
   ------------------------------------------------------------
   · 初始为空 —— 不内置任何路线，数据由录入 / 导入产生
   · 存在 sessionStorage：刷新不丢，关掉标签页就清空
   · 主键是「起点 + 终点」：相同起终点是替换，不同是新增
   · 收费站是路线的子记录，价格按车型逐个存
   ============================================================ */
import { reactive } from 'vue'
import { CAR_TYPES } from '../data/vehicles.js'
import { routeKey, routeOf, normPlace } from '../utils/routeRules.js'

const SS_KEY = 'fleet.routes.v1'

/* ---------------- 持久化 ---------------- */
function pickStorage(name) {
  try {
    const s = globalThis[name]
    if (!s) return null
    s.setItem('__probe__', '1')
    const ok = s.getItem('__probe__') === '1'
    s.removeItem('__probe__')
    return ok ? s : null
  } catch {
    return null
  }
}
const storage = pickStorage('sessionStorage')

let tollSeq = 0
const nextTollId = () => 'tol_' + ++tollSeq + '_' + Math.random().toString(36).slice(2, 7)

/** 收费站也补上稳定 id，方便列表 key 与单条删改。
    价格按**实际写进去的车型名**保留 —— 车型是自由输入的，
    这里不能拿基准表去过滤，否则自定义车型的价格会被悄悄丢掉。 */
function tidyTolls(list) {
  return (Array.isArray(list) ? list : [])
    .filter((t) => t && typeof t === 'object')
    .map((t) => {
      const prices = {}
      for (const [type, v] of Object.entries(t.prices || {})) {
        const name = String(type).trim()
        const n = Number(v)
        if (name && Number.isFinite(n) && n > 0) prices[name] = n
      }
      return { id: t.id || nextTollId(), station: String(t.station || ''), prices }
    })
    .filter((t) => t.station)
}

function readStored() {
  if (!storage) return null
  try {
    const raw = storage.getItem(SS_KEY)
    if (raw === null) return null
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return null
    return arr
      .filter((r) => r && typeof r.id === 'string' && r.from && r.to)
      .map((r) => ({ ...r, tolls: tidyTolls(r.tolls) }))
  } catch {
    return null
  }
}

/* ---------------- 状态 ---------------- */
export const routes = reactive(readStored() ?? [])
export const routeMap = reactive({})

function reindex() {
  for (const k of Object.keys(routeMap)) {
    if (!routes.some((r) => r.id === k)) delete routeMap[k]
  }
  for (const r of routes) routeMap[r.id] = r
}
reindex()

function persist() {
  if (!storage) return
  try {
    storage.setItem(SS_KEY, JSON.stringify(routes.map((r) => ({ ...r, tolls: r.tolls.map((t) => ({ ...t })) }))))
  } catch {
    /* 配额满：降级为仅本次会话有效 */
  }
}
function commit() {
  reindex()
  persist()
}

/* ---------------- 编号与查询 ---------------- */
function nextSeq() {
  let max = 0
  for (const r of routes) {
    const m = /(\d+)\s*$/.exec(String(r.id || ''))
    if (m) max = Math.max(max, Number(m[1]))
  }
  return max + 1
}
export const nextRouteId = () => 'R' + String(nextSeq()).padStart(2, '0')

export const findRoute = (id) => routeMap[id] || null
export const routeKeySet = () => new Set(routes.map(routeOf))
export const findRouteByKey = (from, to) => routes.find((r) => routeOf(r) === routeKey(from, to)) || null
export const isRouteTaken = (from, to, exceptId) => {
  const k = routeKey(from, to)
  return routes.some((r) => r.id !== exceptId && routeOf(r) === k)
}

/** 按起点/终点/收费站名搜（列表搜索用） */
export function searchRoutes(kw) {
  const q = String(kw ?? '').trim().toLowerCase()
  if (!q) return routes
  return routes.filter(
    (r) =>
      r.from.toLowerCase().includes(q) ||
      r.to.toLowerCase().includes(q) ||
      String(r.distance).includes(q) ||
      r.tolls.some((t) => t.station.toLowerCase().includes(q))
  )
}

/* ---------------- 组装记录 ---------------- */
function buildRecord(form, base = {}) {
  return {
    ...base,
    id: base.id || nextRouteId(),
    from: normPlace(form.from),
    to: normPlace(form.to),
    distance: Math.round((Number(form.distance) || 0) * 10) / 10,
    tolls: Array.isArray(form.tolls) ? tidyTolls(form.tolls) : base.tolls || [],
    manual: true,
  }
}

/* ---------------- 增删改 ---------------- */
export function addRoute(form) {
  const rec = buildRecord(form)
  routes.unshift(rec)
  commit()
  return rec
}

export function updateRoute(id, form) {
  const i = routes.findIndex((r) => r.id === id)
  if (i < 0) return null
  const next = buildRecord(form, { ...routes[i], id })
  Object.assign(routes[i], next)
  commit()
  return routes[i]
}

export function removeRoute(id) {
  const i = routes.findIndex((r) => r.id === id)
  if (i < 0) return false
  routes.splice(i, 1)
  commit()
  return true
}

/* ---------------- 批量导入（起点+终点 为主键） ---------------- */
export function importRoutes(drafts) {
  const fresh = []
  let updated = 0
  const byKey = new Map(routes.map((r) => [routeOf(r), r]))
  let seq = nextSeq()

  for (const d of drafts) {
    const form = d.draft || d
    const from = normPlace(form.from)
    const to = normPlace(form.to)
    if (!from || !to) continue
    const key = routeKey(from, to)
    const prev = byKey.get(key)
    if (prev) {
      // 替换：保留原 id；如果导入行没带收费站价格，就保留原来的收费站
      const incoming = Array.isArray(form.tolls) ? tidyTolls(form.tolls) : []
      Object.assign(prev, buildRecord({ ...form, tolls: incoming.length ? incoming : prev.tolls }, { ...prev, id: prev.id }))
      updated++
    } else {
      const rec = buildRecord(form, { id: 'R' + String(seq++).padStart(2, '0') })
      byKey.set(key, rec)
      fresh.push(rec)
    }
  }

  if (fresh.length) routes.unshift(...fresh)
  commit()
  return { added: fresh.length, updated }
}

/* ---------------- 清空 ---------------- */
/** 清空全部路线。界面上没有这个入口，只给自检脚本重置状态用。 */
export function clearAll() {
  routes.splice(0, routes.length)
  commit()
}

/* ---------------- 过路费 ---------------- */
/** 这条路线在某车型上的总过路费 */
export function tollTotalFor(route, type) {
  if (!route) return 0
  return route.tolls.reduce((a, t) => a + (Number(t.prices?.[type]) || 0), 0)
}

/** 全部路线在某车型上的过路费合计 */
export function tollTotalAll(type) {
  return routes.reduce((a, r) => a + tollTotalFor(r, type), 0)
}
