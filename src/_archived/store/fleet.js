/* ============================================================
   车队分析层（纯前端计算）
   ------------------------------------------------------------
   口径说明（很重要，否则报表会自相矛盾）：
   · 变动成本（油 / 路 / 司机提成 / 维保）挂在「出车日」上 —— 车不动就不发生。
   · 固定成本（保险/折旧/车贷/停车/管理）与司机底薪+社保按「日历天数」
     计提 —— 车停着也在烧钱。这才是真实成本口径，也是“成本控制”里
     最容易被忽略的一块。
   · 明细派生自同一批流水，所以「明细相加 = 报表合计」天然成立。
   ============================================================ */
import { reactive } from 'vue'
import {
  DAILY, DAILY_TS, DRIVERS, DRIVER_MAP, ROUTES, ROUTE_MAP,
  FIXED_MAP, TODAY, DAY_MS, CATS, CAT_MAP, MONTHS, STATUS,
  ymKey, addDays, daysInMonth, spanDays, dayKey, round1,
  fixedMonthlyTotal, driverMonthlyTotal,
} from '../data/mock.js'
// 车辆清单以 store/vehicles.js 为唯一来源（支持录入 / 编辑），
// 历史流水与固定成本仍来自 data/mock.js 的生成数据。
import { vehicles as VEHICLES, vehicleMap as VEHICLE_MAP } from './vehicles.js'

/* ============================================================
   1. 周期
   ============================================================ */
export const PERIODS = [
  { key: 'd7', name: '近 7 天' },
  { key: 'd30', name: '近 30 天' },
  { key: 'mtd', name: '本月' },
  { key: 'lm', name: '上月' },
  { key: 'd90', name: '近 90 天' },
  { key: 'qtd', name: '本季度' },
  { key: 'ytd', name: '本年' },
  { key: 'y12', name: '近 12 个月' },
]
export const REPORTS_PERIODS = [
  { key: 'mtd', name: '本月' },
  { key: 'lm', name: '上月' },
  { key: 'qtd', name: '本季度' },
  { key: 'ytd', name: '本年' },
  { key: 'y12', name: '近 12 个月' },
]

export function resolveRange(key) {
  const y = TODAY.getFullYear()
  const m = TODAY.getMonth()
  switch (key) {
    case 'd1': return { s: TODAY, e: TODAY }
    case 'd7': return { s: addDays(TODAY, -6), e: TODAY }
    case 'd30': return { s: addDays(TODAY, -29), e: TODAY }
    case 'd90': return { s: addDays(TODAY, -89), e: TODAY }
    case 'mtd': return { s: new Date(y, m, 1), e: TODAY }
    case 'lm': return { s: new Date(y, m - 1, 1), e: new Date(y, m, 0) }
    case 'qtd': { const q = Math.floor(m / 3) * 3; return { s: new Date(y, q, 1), e: TODAY } }
    case 'lq': { const q = Math.floor(m / 3) * 3; return { s: new Date(y, q - 3, 1), e: new Date(y, q, 0) } }
    case 'ytd': return { s: new Date(y, 0, 1), e: TODAY }
    case 'y12': return { s: addDays(TODAY, -364), e: TODAY }
    default: return { s: addDays(TODAY, -29), e: TODAY }
  }
}
/** 等长的上一期，用于环比 */
export function prevRange(r) {
  const len = spanDays(r.s, r.e)
  return { s: addDays(r.s, -len), e: addDays(r.s, -1) }
}
export const fmtDate = (d) => `${d.getMonth() + 1}月${d.getDate()}日`
export const fmtDateFull = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
export const rangeLabel = (r) => `${fmtDateFull(r.s)} ~ ${fmtDateFull(r.e)}`
export const monthLabel = (ym) => `${ym.slice(0, 4)}年${Number(ym.slice(5))}月`
export const shortMonth = (ym) => `${Number(ym.slice(5))}月`

/** 最近 n 个月（含本月），升序 */
export function lastMonths(n) {
  const out = []
  for (let i = n - 1; i >= 0; i--) out.push(ymKey(new Date(TODAY.getFullYear(), TODAY.getMonth() - i, 1)))
  return out
}
/** 区间覆盖到的所有月份（升序）—— 用它的粒度画长周期趋势 */
export function monthsIn(s, e) {
  const out = []
  const c = new Date(s.getFullYear(), s.getMonth(), 1)
  while (c <= e) {
    out.push(ymKey(c))
    c.setMonth(c.getMonth() + 1)
  }
  return out
}
export { MONTHS }

/* ============================================================
   2. 手工录入（演示用：新增的成本会真正进入所有统计）
   ============================================================ */
export const state = reactive({
  entries: [],
  seq: 0,
})

/**
 * 新增一笔成本。
 * cat: fuel | toll | driver | maint | fixed
 * 录入后会自动并入流水，概览/报表/成本页的数字同步变化。
 */
export function addEntry(e) {
  const d = e.date ? new Date(e.date + 'T00:00:00') : TODAY
  const ts = d.getTime()
  const cat = e.cat || 'fuel'
  const km = Number(e.km) || 0
  const liters = Number(e.liters) || 0
  const amount = Math.round(Number(e.amount) || 0)
  const row = {
    d: dayKey(d), ts, ym: ymKey(d),
    v: e.vehicleId || null,
    dr: e.driverId || VEHICLE_MAP[e.vehicleId]?.driverId || null,
    r: e.routeId || null,
    km, trips: 0, liters,
    rev: 0,
    fuel: 0, toll: 0, driver: 0, maint: 0, svc: 0, cons: 0,
    var: amount,
    manual: true,
    note: e.note || '',
    seq: ++state.seq,
  }
  if (cat === 'fixed') {
    // 固定成本不并入变动流水，单独进 accrual 池
    row.fixedManual = amount
    row.var = 0
  } else {
    row[cat] = amount
  }
  state.entries.push(row)
  return row
}
export function removeEntry(id) {
  const i = state.entries.findIndex((x) => x.seq === id)
  if (i >= 0) state.entries.splice(i, 1)
}
export const manualEntries = () => state.entries.slice().sort((a, b) => b.ts - a.ts)

/* ============================================================
   3. 区间切片
   ============================================================ */
const _cache = new Map()
function sliceBase(s, e) {
  const a = s.getTime()
  const b = e.getTime() + DAY_MS - 1
  let lo = 0
  let hi = DAILY_TS.length
  while (lo < hi) { const mid = (lo + hi) >> 1; if (DAILY_TS[mid] < a) lo = mid + 1; else hi = mid }
  const start = lo
  hi = DAILY_TS.length
  while (lo < hi) { const mid = (lo + hi) >> 1; if (DAILY_TS[mid] <= b) lo = mid + 1; else hi = mid }
  return DAILY.slice(start, lo)
}
function arrange(s, e) {
  const base = sliceBase(s, e)
  const extra = state.entries.filter((x) => x.ts >= s.getTime() && x.ts <= e.getTime() + DAY_MS - 1)
  return extra.length ? base.concat(extra) : base
}
/** 取区间内的每日流水（含手工录入），带缓存 */
export function sliceRange(s, e) {
  const k = s.getTime() + '|' + e.getTime() + '|' + state.entries.length + '|' + state.seq
  if (_cache.has(k)) return _cache.get(k)
  const v = arrange(s, e)
  if (_cache.size > 40) _cache.clear()
  _cache.set(k, v)
  return v
}

/* ============================================================
   4. 固定成本 / 底薪计提（按日历天）
   ============================================================ */
export function accrual(s, e, perMonthFn) {
  let total = 0
  const cur = new Date(s.getFullYear(), s.getMonth(), 1)
  while (cur <= e) {
    const ym = ymKey(cur)
    const dim = daysInMonth(ym)
    const ms = new Date(cur.getFullYear(), cur.getMonth(), 1)
    const me = new Date(cur.getFullYear(), cur.getMonth(), dim)
    const a = s > ms ? s : ms
    const b = e < me ? e : me
    const days = Math.max(0, Math.round((b - a) / DAY_MS) + 1)
    if (days > 0) total += perMonthFn(ym, days / dim)
    cur.setMonth(cur.getMonth() + 1)
  }
  return total
}
const manualFixed = (s, e) =>
  state.entries.reduce((a, x) => (x.fixedManual && x.ts >= s.getTime() && x.ts <= e.getTime() + DAY_MS - 1 ? a + x.fixedManual : a), 0)

export const fleetFixed = (s, e) =>
  accrual(s, e, (ym, f) => VEHICLES.reduce((a, v) => a + fixedMonthlyTotal(ym, v.id), 0) * f) + manualFixed(s, e)
export const fleetSalary = (s, e) =>
  accrual(s, e, (ym, f) => DRIVERS.reduce((a, d) => a + driverMonthlyTotal(d), 0) * f)
export const vehicleFixed = (s, e, v) =>
  accrual(s, e, (ym, f) => fixedMonthlyTotal(ym, v) * f) +
  state.entries.reduce((a, x) => (x.fixedManual && x.v === v && x.ts >= s.getTime() && x.ts <= e.getTime() + DAY_MS - 1 ? a + x.fixedManual : a), 0)
export const vehicleSalary = (s, e, v) => {
  const veh = VEHICLE_MAP[v]
  const d = DRIVER_MAP[veh?.driverId]
  const d2 = veh?.coDriverId ? DRIVER_MAP[veh.coDriverId] : null
  return accrual(s, e, (ym, f) => (driverMonthlyTotal(d) + driverMonthlyTotal(d2)) * f)
}

/* ============================================================
   5. 汇总
   ============================================================ */
const EMPTY = () => ({ km: 0, rev: 0, fuel: 0, toll: 0, driverVar: 0, maint: 0, liters: 0, trips: 0, days: 0, manual: 0 })

function rollup(rows) {
  const t = EMPTY()
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    t.km += r.km; t.rev += r.rev
    t.fuel += r.fuel; t.toll += r.toll
    t.driverVar += r.driver + (r.driver2 || 0)
    t.maint += r.maint
    t.liters += r.liters; t.trips += r.trips; t.days += r.trips > 0 ? 1 : 0
    if (r.manual) t.manual += r.var
  }
  return t
}

/**
 * 区间总账。返回字段与成本科目对齐，可直接喂图表。
 */
export function summarize(s, e) {
  const rows = sliceRange(s, e)
  const t = rollup(rows)
  const fixed = fleetFixed(s, e)
  const salary = fleetSalary(s, e)
  const driver = t.driverVar + salary
  const cost = t.fuel + t.toll + driver + t.maint + fixed
  return {
    s, e, rows,
    km: t.km, rev: t.rev, liters: t.liters, trips: t.trips, activeDays: t.days,
    fuel: t.fuel, toll: t.toll, driver, driverVar: t.driverVar, salary, maint: t.maint, fixed,
    manual: t.manual,
    cost,
    profit: t.rev - cost,
    margin: t.rev ? (t.rev - cost) / t.rev : 0,
    costPerKm: t.km ? cost / t.km : 0,
    revPerKm: t.km ? t.rev / t.km : 0,
    per100: t.km ? (t.liters / t.km) * 100 : 0,
    avgKm: t.days ? t.km / t.days : 0,
    vehicles: VEHICLES.length,
  }
}

/** 含环比的总账 */
export function summarizeWithPrev(range) {
  const cur = summarize(range.s, range.e)
  const p = prevRange(range)
  const prev = summarize(p.s, p.e)
  const delta = (a, b) => (b ? (a - b) / b : 0)
  return {
    cur, prev, prevRange: p,
    d: {
      rev: delta(cur.rev, prev.rev),
      cost: delta(cur.cost, prev.cost),
      profit: delta(cur.profit, prev.profit),
      km: delta(cur.km, prev.km),
      costPerKm: delta(cur.costPerKm, prev.costPerKm),
      revPerKm: delta(cur.revPerKm, prev.revPerKm),
      per100: delta(cur.per100, prev.per100),
      marginPts: cur.margin - prev.margin,
    },
  }
}

/** 成本结构（饼图 / 图例 / 列表通用） */
export function costStructure(t) {
  const total = t.cost || 1
  return CATS.map((c) => {
    const value = t[c.key] || 0
    return { ...c, value, pct: value / total }
  }).sort((a, b) => b.value - a.value)
}

/* ============================================================
   6. 趋势序列
   ============================================================ */
/** 按天：收入 / 成本 / 里程 */
export function dailySeries(s, e) {
  const rows = sliceRange(s, e)
  const map = new Map()
  for (const r of rows) {
    let o = map.get(r.d)
    if (!o) { o = { d: r.d, ts: r.ts, rev: 0, varCost: 0, km: 0 }; map.set(r.d, o) }
    o.rev += r.rev; o.varCost += r.var; o.km += r.km
    if (r.ts < o.ts) o.ts = r.ts
  }
  const out = []
  const cur = new Date(s.getFullYear(), s.getMonth(), s.getDate())
  while (cur <= e) {
    const k = dayKey(cur)
    const o = map.get(k) || { d: k, ts: cur.getTime(), rev: 0, varCost: 0, km: 0 }
    // 固定成本与底薪按天摊进来，趋势线才是“全成本”
    const ym = ymKey(cur)
    const dim = daysInMonth(ym)
    const fixedDay =
      (VEHICLES.reduce((a, v) => a + fixedMonthlyTotal(ym, v.id), 0) +
        DRIVERS.reduce((a, d) => a + driverMonthlyTotal(d), 0)) /
      dim
    out.push({
      date: k,
      ts: cur.getTime(),
      rev: Math.round(o.rev),
      cost: Math.round(o.varCost + fixedDay),
      km: o.km,
    })
    cur.setDate(cur.getDate() + 1)
  }
  return out
}

/** 按月：各科目堆叠 */
export function monthlySeries(months) {
  return months.map((ym) => {
    const [y, m] = ym.split('-').map(Number)
    const s = new Date(y, m - 1, 1)
    const last = new Date(y, m, 0)
    const e = last > TODAY ? TODAY : last
    const t = summarize(s, e)
    return {
      ym,
      label: shortMonth(ym),
      full: monthLabel(ym),
      partial: e < last,
      rev: t.rev, cost: t.cost, profit: t.profit, margin: t.margin,
      km: t.km, per100: t.per100, costPerKm: t.costPerKm,
      fuel: t.fuel, toll: t.toll, driver: t.driver, fixed: t.fixed, maint: t.maint,
    }
  })
}

/* ============================================================
   7. 维度排行
   ============================================================ */
export function byVehicle(s, e) {
  const rows = sliceRange(s, e)
  const acc = new Map()
  for (const r of rows) {
    let o = acc.get(r.v)
    if (!o) { o = { ...EMPTY(), id: r.v }; acc.set(r.v, o) }
    o.km += r.km; o.rev += r.rev
    o.fuel += r.fuel; o.toll += r.toll
    o.driverVar += r.driver + (r.driver2 || 0)
    o.maint += r.maint
    o.liters += r.liters; o.trips += r.trips; o.days += r.trips > 0 ? 1 : 0
  }
  return VEHICLES.map((v) => {
    const a = acc.get(v.id) || { ...EMPTY(), id: v.id }
    const fixed = vehicleFixed(s, e, v.id)
    const salary = vehicleSalary(s, e, v.id)
    const driver = a.driverVar + salary
    const cost = a.fuel + a.toll + driver + a.maint + fixed
    const drv = DRIVER_MAP[v.driverId]
    const drv2 = v.coDriverId ? DRIVER_MAP[v.coDriverId] : null
    return {
      id: v.id, plate: v.plate, model: v.model, type: v.type, status: v.status,
      driverId: v.driverId, driverName: drv ? drv.name : '—',
      coDriverId: v.coDriverId, coDriverName: drv2 ? drv2.name : null,
      km: a.km, rev: a.rev, liters: a.liters, days: a.days, trips: a.trips,
      fuel: a.fuel, toll: a.toll, driver, salary, driverVar: a.driverVar, maint: a.maint, fixed,
      cost, profit: a.rev - cost,
      margin: a.rev ? (a.rev - cost) / a.rev : 0,
      costPerKm: a.km ? cost / a.km : 0,
      revPerKm: a.km ? a.rev / a.km : 0,
      per100: a.km ? (a.liters / a.km) * 100 : 0,
      normFuel: v.normFuel,
      odo: v.odo,
      serviceIn: Math.max(0, v.nextServiceOdo - v.odo),
      price: v.price, age: v.age, tonnage: v.tonnage, fuelType: v.fuelType, gps: v.gps,
      tank: v.tank, buyYear: v.buyYear,
    }
  })
}

export function byDriver(s, e) {
  const rows = sliceRange(s, e)
  const acc = new Map()
  const bump = (id, r, amount) => {
    let o = acc.get(id)
    if (!o) { o = { km: 0, rev: 0, commission: 0, trips: 0, days: 0, liters: 0, vehicleId: r.v, asCo: false }; acc.set(id, o) }
    o.km += r.km; o.rev += r.rev; o.commission += amount; o.liters += r.liters
    o.trips += r.trips; o.days += r.trips > 0 ? 1 : 0
    o.vehicleId = r.v
  }
  for (const r of rows) {
    bump(r.dr, r, r.driver)
    if (r.dr2 && r.driver2) {
      bump(r.dr2, r, r.driver2)
      acc.get(r.dr2).asCo = true
    }
  }
  return DRIVERS.map((d) => {
    const a = acc.get(d.id) || { km: 0, rev: 0, commission: 0, trips: 0, days: 0, liters: 0, vehicleId: null, asCo: false }
    const salary = accrual(s, e, (ym, f) => driverMonthlyTotal(d) * f)
    const cost = a.commission + salary
    const v = a.vehicleId ? VEHICLE_MAP[a.vehicleId] : null
    const per100 = a.km ? (a.liters / a.km) * 100 : 0
    const norm = v ? v.normFuel : 0
    return {
      ...d,
      vehicleId: a.vehicleId,
      plate: v ? v.plate : '—',
      asCo: a.asCo,
      km: a.km, rev: a.rev, trips: a.trips, days: a.days, liters: a.liters,
      commission: a.commission, salary, cost,
      costPerKm: a.km ? cost / a.km : 0,
      per100,
      fuelGap: norm && per100 ? per100 / norm - 1 : 0,
      avgKm: a.days ? a.km / a.days : 0,
    }
  })
}

export function byRoute(s, e) {
  const rows = sliceRange(s, e)
  const acc = new Map()
  let totalKm = 0
  for (const r of rows) {
    let o = acc.get(r.r)
    if (!o) { o = { km: 0, rev: 0, fuel: 0, toll: 0, driverVar: 0, maint: 0, liters: 0, trips: 0 }; acc.set(r.r, o) }
    o.km += r.km; o.rev += r.rev; o.fuel += r.fuel; o.toll += r.toll; o.driverVar += r.driver; o.maint += r.maint
    o.liters += r.liters; o.trips += r.trips
    totalKm += r.km
  }
  const overhead = fleetFixed(s, e) + fleetSalary(s, e)
  return [...acc.entries()].map(([id, a]) => {
    const r = ROUTE_MAP[id]
    // 固定成本与底薪按里程占比分摊到线路
    const overheadAlloc = totalKm ? overhead * (a.km / totalKm) : 0
    const cost = a.fuel + a.toll + a.driverVar + a.maint + overheadAlloc
    return {
      id, name: r ? `${r.from} → ${r.to}` : id, cargo: r ? r.cargo : '—',
      seg: r ? r.seg : '—', distance: r ? r.km : 0,
      ...a, overhead: overheadAlloc, cost,
      profit: a.rev - cost,
      margin: a.rev ? (a.rev - cost) / a.rev : 0,
      costPerKm: a.km ? cost / a.km : 0,
      per100: a.km ? (a.liters / a.km) * 100 : 0,
    }
  }).sort((x, y) => y.rev - x.rev)
}

/* ============================================================
   8. 车队状态 / 预警
   ============================================================ */
export function fleetStatus() {
  const counts = { run: 0, idle: 0, fix: 0, ready: 0 }
  VEHICLES.forEach((v) => counts[v.status]++)
  return Object.entries(counts).map(([k, n]) => ({ ...STATUS[k], count: n, pct: n / VEHICLES.length }))
}

/**
 * 经营预警：真实车队最常盯的几件事。
 * 全部由数据推导，没有写死的假警报。
 */
export function alerts(s, e) {
  const vs = byVehicle(s, e).filter((x) => x.km > 0)
  const ds = byDriver(s, e).filter((x) => x.km > 0)
  const out = []
  const fleetCpk = vs.length ? vs.reduce((a, x) => a + x.cost, 0) / vs.reduce((a, x) => a + x.km, 0) : 0

  // 1) 亏损车
  vs.filter((x) => x.margin < 0.02)
    .sort((a, b) => a.margin - b.margin)
    .slice(0, 3)
    .forEach((x) =>
      out.push({
        level: 'high', cat: 'fixed', tag: '亏损',
        title: `${x.plate} 本期毛利 ${(x.margin * 100).toFixed(1)}%`,
        desc: `单公里成本 ${x.costPerKm.toFixed(2)} 元，高于收入 ${x.revPerKm.toFixed(2)} 元 / 公里，建议复核线路与配载`,
      })
    )

  // 2) 油耗异常
  ds.filter((x) => x.fuelGap > 0.1)
    .sort((a, b) => b.fuelGap - a.fuelGap)
    .slice(0, 2)
    .forEach((x) =>
      out.push({
        level: 'mid', cat: 'fuel', tag: '油耗',
        title: `${x.name} 百公里油耗偏高 ${(x.fuelGap * 100).toFixed(0)}%`,
        desc: `实际 ${x.per100.toFixed(1)} L/100km，同车基准应接近 ${(x.per100 / (1 + x.fuelGap)).toFixed(1)} L，建议检查驾驶习惯`,
      })
    )

  // 3) 过路费占比
  vs.filter((x) => x.rev > 0 && x.toll / x.rev > 0.3)
    .sort((a, b) => b.toll / b.rev - a.toll / a.rev)
    .slice(0, 2)
    .forEach((x) =>
      out.push({
        level: 'mid', cat: 'toll', tag: '过路费',
        title: `${x.plate} 过路费占收入 ${((x.toll / x.rev) * 100).toFixed(1)}%`,
        desc: `本期通行费 ¥${Math.round(x.toll).toLocaleString()}，可评估国道 / 省道替代方案`,
      })
    )

  // 4) 保养到期
  vs.filter((x) => x.serviceIn < 2500)
    .sort((a, b) => a.serviceIn - b.serviceIn)
    .slice(0, 2)
    .forEach((x) =>
      out.push({
        level: x.serviceIn < 800 ? 'high' : 'low', cat: 'maint', tag: '保养',
        title: `${x.plate} 距下次保养 ${Math.round(x.serviceIn).toLocaleString()} km`,
        desc: `当前里程 ${x.odo.toLocaleString()} km，建议尽快安排进厂，避免路上抛锚`,
      })
    )

  // 5) 司机安全分
  ds.filter((x) => x.safety < 80)
    .slice(0, 2)
    .forEach((x) =>
      out.push({
        level: 'low', cat: 'driver', tag: '安全',
        title: `${x.name} 安全评分 ${x.safety}`,
        desc: `准驾 ${x.license}，驾龄 ${x.years} 年，建议安排安全培训与跟车复训`,
      })
    )

  // 6) 单车成本显著高于车队均值
  vs.filter((x) => fleetCpk > 0 && x.costPerKm > fleetCpk * 1.15 && x.margin >= 0.02)
    .sort((a, b) => b.costPerKm - a.costPerKm)
    .slice(0, 2)
    .forEach((x) =>
      out.push({
        level: 'low', cat: 'fixed', tag: '成本',
        title: `${x.plate} 单公里成本 ${x.costPerKm.toFixed(2)} 元，高于车队均值`,
        desc: `车队均值 ${fleetCpk.toFixed(2)} 元/公里，该车车龄 ${x.age} 年，可能已进入高维保期`,
      })
    )

  // 7) 固定成本提醒
  const t = summarize(s, e)
  if (t.cost > 0 && t.fixed / t.cost > 0.12) {
    out.push({
      level: 'low', cat: 'fixed', tag: '固定成本',
      title: `固定成本占比 ${((t.fixed / t.cost) * 100).toFixed(1)}%`,
      desc: `本期固定成本 ¥${Math.round(t.fixed).toLocaleString()}，含保险、折旧与车贷，出车率不足时会被放大`,
    })
  }
  return out.slice(0, 6)
}

/* ============================================================
   9. 工具
   ============================================================ */
/** CSV 导出（纯前端 Blob 下载） */
export function exportCsv(filename, headers, rows) {
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const text = '\ufeff' + [headers, ...rows].map((r) => r.map(esc).join(',')).join('\r\n')
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
