/* ============================================================
   趟次记录：精细化运营的原始凭证
   ------------------------------------------------------------
   一条趟次 = 某天、某司机、开某台车、跑某条路线、拉了多少货、
   实际烧了多少油、交了多少过路费、收了多少运费。

   油耗考核与司机当月统计都是从这张表算出来的 ——
   它同时是「司机当月创收 / 里程 / 油耗电耗」三个字段的数据源。
   ============================================================ */
import { reactive } from 'vue'
import { normalizeCarType, parseNumber } from '../utils/vehicleRules.js'
import { tripKeyFields } from '../utils/tripRules.js'
import { findVehicle } from './vehicles.js'

const SS_KEY = 'fleet.trips.v1'

/* ---------------- 持久化 ---------------- */
function pickStorage(name) {
  try {
    const s = globalThis[name]
    if (!s) return null
    s.setItem('__probe__', '1')
    const ok = s.getItem('__probe__') === '1'
    s.removeItem('__probe__')
    return s
  } catch {
    return null
  }
}
const storage = pickStorage('sessionStorage')

function readStored() {
  if (!storage) return null
  try {
    const raw = storage.getItem(SS_KEY)
    if (raw === null) return null
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return null
    return arr.filter((t) => t && typeof t.id === 'string' && t.date && t.routeId)
  } catch {
    return null
  }
}

/* ---------------- 状态 ---------------- */
export const trips = reactive(readStored() ?? [])
export const tripMap = reactive({})

function reindex() {
  for (const k of Object.keys(tripMap)) {
    if (!trips.some((t) => t.id === k)) delete tripMap[k]
  }
  for (const t of trips) tripMap[t.id] = t
}
reindex()

function persist() {
  if (!storage) return
  try {
    storage.setItem(SS_KEY, JSON.stringify(trips.map((t) => ({ ...t }))))
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
  for (const t of trips) {
    const m = /(\d+)\s*$/.exec(String(t.id || ''))
    if (m) max = Math.max(max, Number(m[1]))
  }
  return max + 1
}
export const nextTripId = () => 'T' + String(nextSeq()).padStart(4, '0')

export const findTrip = (id) => tripMap[id] || null
export const tripsOfRoute = (routeId) => trips.filter((t) => t.routeId === routeId)
export const tripsOfDriver = (driverId) => trips.filter((t) => t.driverId === driverId)
export const tripsOfVehicle = (vehicleId) => trips.filter((t) => t.vehicleId === vehicleId)

/** 某月的趟次（'YYYY-MM'） */
export const tripsOfMonth = (month) => trips.filter((t) => String(t.date).slice(0, 7) === month)

/** 最近一次用过的油价 —— 新增趟次时带出来当默认，省得每次重敲 */
export function lastFuelPrice() {
  for (const t of trips) {
    const p = Number(t.fuelPrice)
    if (p > 0) return p
  }
  return 0
}

/** 有没有还没结算的运费（列表里提示用） */
export const hasUnsettled = () => trips.some((t) => !t.settled && Number(t.revenue) > 0)

/* ---------------- 组装记录 ---------------- */
function buildRecord(form, base = {}) {
  const vehicleId = String(form.vehicleId || '').trim()
  // 车型绑定在车辆上，这里再兜一次：没显式给就从车辆档案取。
  // 存的是**快照** —— 以后这辆车改了车型、甚至被删了，历史趟次的车型不该跟着变。
  const type = normalizeCarType(form.type) || findVehicle(vehicleId)?.type || base.type || ''
  return {
    ...base,
    id: base.id || nextTripId(),
    date: String(form.date || '').trim(),
    routeId: String(form.routeId || '').trim(),
    type,
    distance: Number(parseNumber(form.distance)) || 0,
    vehicleId,
    driverId: String(form.driverId || '').trim(),
    tonnage: Number(parseNumber(form.tonnage)) || 0,
    actualFuel: Number(parseNumber(form.actualFuel)) || 0,
    fuelPrice: Number(parseNumber(form.fuelPrice)) || 0,
    toll: Number(parseNumber(form.toll)) || 0,
    revenue: Number(parseNumber(form.revenue)) || 0,
    // 勾选 = 运费已收到；默认待结算（运费很多不会当场结）
    settled: form.settled === true,
    note: String(form.note || '').trim(),
    manual: true,
  }
}

/* ---------------- 增删改 ---------------- */
export function addTrip(form) {
  const rec = buildRecord(form)
  trips.unshift(rec)
  commit()
  return rec
}

export function updateTrip(id, form) {
  const i = trips.findIndex((t) => t.id === id)
  if (i < 0) return null
  Object.assign(trips[i], buildRecord(form, { ...trips[i], id }))
  commit()
  return trips[i]
}

export function removeTrip(id) {
  const i = trips.findIndex((t) => t.id === id)
  if (i < 0) return false
  trips.splice(i, 1)
  commit()
  return true
}

/** 删路线 / 删司机 / 删车时，连带清掉引用它的趟次，避免留下孤儿记录 */
export function removeTripsByRoute(routeId) {
  const n = trips.length
  for (let i = trips.length - 1; i >= 0; i--) if (trips[i].routeId === routeId) trips.splice(i, 1)
  commit()
  return n - trips.length
}
export function removeTripsByDriver(driverId) {
  const n = trips.length
  for (let i = trips.length - 1; i >= 0; i--) if (trips[i].driverId === driverId) trips.splice(i, 1)
  commit()
  return n - trips.length
}
export function removeTripsByVehicle(vehicleId) {
  const n = trips.length
  for (let i = trips.length - 1; i >= 0; i--) if (trips[i].vehicleId === vehicleId) trips.splice(i, 1)
  commit()
  return n - trips.length
}

/* ---------------- 批量导入 ---------------- */
export function importTrips(drafts) {
  const fresh = []
  let updated = 0
  // 同一「日期 + 路线 + 司机 + 车」视为同一趟，重复导入按替换处理
  const byKey = new Map(trips.map((t) => [tripKeyFields(t), t]))
  let seq = nextSeq()

  for (const d of drafts) {
    const form = d.draft || d
    if (!form.date || !form.routeId) continue
    const key = tripKeyFields(form)
    const prev = byKey.get(key)
    if (prev) {
      Object.assign(prev, buildRecord(form, { ...prev, id: prev.id }))
      updated++
    } else {
      const rec = buildRecord(form, { id: 'T' + String(seq++).padStart(4, '0') })
      byKey.set(key, rec)
      fresh.push(rec)
    }
  }

  if (fresh.length) trips.unshift(...fresh)
  commit()
  return { added: fresh.length, updated }
}

/* ---------------- 清空 ---------------- */
/** 清空全部趟次。界面上没有这个入口，只给自检脚本重置状态用。 */
export function clearAll() {
  trips.splice(0, trips.length)
  commit()
}
