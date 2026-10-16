/* ============================================================
   成本汇总（纯函数，不依赖 Vue）
   ------------------------------------------------------------
   成本分五个来源：
     折旧   —— 车辆按月计提（买了没有、提满没有，都要按当月判断）
     人工   —— 司机的月工资
     油耗   —— 趟次的 实际油耗 × 油费单价
     过路费 —— 趟次的过路费
     手工   —— 手工录入的配件 / 证件 / 其他

   折旧与人工是**按月**的概念，油耗/过路费/手工是**按日**的流水，
   所以统一按「某个月」汇总 —— 这也是看成本最自然的粒度。
   ============================================================ */
import { COST_COLORS, needVehicle } from '../data/costs.js'
import { monthlyDepreciationAt, monthEnd } from './depreciation.js'
import { tripCost } from './tripRules.js'

/** 'YYYY-MM' */
export const monthOf = (dateStr) => String(dateStr ?? '').slice(0, 7)

/** 某条流水/趟次是不是落在该月 */
export const inMonth = (dateStr, month) => monthOf(dateStr) === month

/**
 * 汇总一个月的成本。
 * @param data { vehicles, drivers, trips, costs }
 * @param month 'YYYY-MM'
 */
export function costSummary(data, month) {
  const vehicles = data.vehicles || []
  const drivers = data.drivers || []
  const trips = data.trips || []
  const costs = data.costs || []
  const end = monthEnd(month)

  // ---- 按车辆归集 ----
  const byVehicle = new Map()
  const bucket = (v) => {
    if (!byVehicle.has(v.id)) {
      byVehicle.set(v.id, {
        id: v.id,
        plate: v.plate,
        type: v.type,
        depreciation: 0,
        part: 0,
        doc: 0,
        fuel: 0,
        toll: 0,
        manual: 0,
        total: 0,
      })
    }
    return byVehicle.get(v.id)
  }
  for (const v of vehicles) bucket(v)

  // 折旧：按当月是否在册、是否提满判断
  let depreciation = 0
  for (const v of vehicles) {
    const d = monthlyDepreciationAt(v.price, v.buyDate, end)
    if (d > 0) {
      depreciation += d
      bucket(v).depreciation += d
    }
  }

  // 人工：司机月工资合计
  let staff = 0
  for (const d of drivers) staff += Number(d.salary) || 0

  // 油耗 / 过路费：该月趟次
  let fuel = 0
  let toll = 0
  let tripCount = 0
  for (const t of trips) {
    if (!inMonth(t.date, month)) continue
    tripCount++
    const c = tripCost(t)
    fuel += c.fuelCost
    toll += c.toll
    const b = byVehicle.get(t.vehicleId)
    if (b) {
      b.fuel += c.fuelCost
      b.toll += c.toll
    }
  }

  // 手工成本：按用途拆开
  const byPurpose = { part: 0, doc: 0, other: 0 }
  let manual = 0
  let manualCount = 0
  for (const c of costs) {
    if (!inMonth(c.date, month)) continue
    manualCount++
    const amt = Number(c.amount) || 0
    manual += amt
    if (byPurpose[c.purpose] === undefined) byPurpose.other += amt
    else byPurpose[c.purpose] += amt
    if (needVehicle(c.purpose) && byVehicle.has(c.vehicleId)) {
      const b = byVehicle.get(c.vehicleId)
      b[c.purpose] += amt
      b.manual += amt
    }
  }

  const round = (n) => Math.round(n * 100) / 100
  depreciation = round(depreciation)
  staff = round(staff)
  fuel = round(fuel)
  toll = round(toll)
  manual = round(manual)
  const total = round(depreciation + staff + fuel + toll + manual)

  const vehicleRows = [...byVehicle.values()]
    .map((b) => {
      const t = round(b.depreciation + b.fuel + b.toll + b.manual)
      return {
        ...b,
        depreciation: round(b.depreciation),
        part: round(b.part),
        doc: round(b.doc),
        fuel: round(b.fuel),
        toll: round(b.toll),
        manual: round(b.manual),
        total: t,
      }
    })
    .sort((a, b) => b.total - a.total)

  return {
    month,
    depreciation,
    staff,
    fuel,
    toll,
    manual,
    total,
    byPurpose: {
      part: round(byPurpose.part),
      doc: round(byPurpose.doc),
      other: round(byPurpose.other),
    },
    vehicleRows,
    tripCount,
    manualCount,
    /** 没有任何数据来源时界面显示空状态 */
    empty: total === 0,
  }
}

/**
 * 成本构成的饼图数据。
 * 只保留有金额的项 —— 饼图里 0 值扇区没有意义。
 */
export function costBreakdown(summary) {
  const rows = [
    { key: 'depreciation', label: '车辆折旧', value: summary.depreciation, color: COST_COLORS.depreciation },
    { key: 'staff', label: '员工成本', value: summary.staff, color: COST_COLORS.staff },
    { key: 'fuel', label: '油耗成本', value: summary.fuel, color: COST_COLORS.fuel },
    { key: 'toll', label: '过路费', value: summary.toll, color: COST_COLORS.toll },
    { key: 'part', label: '车辆配件', value: summary.byPurpose.part, color: COST_COLORS.part },
    { key: 'doc', label: '车辆证件', value: summary.byPurpose.doc, color: COST_COLORS.doc },
    { key: 'other', label: '其他', value: summary.byPurpose.other, color: COST_COLORS.other },
  ]
  const kept = rows.filter((r) => r.value > 0)
  const sum = kept.reduce((a, r) => a + r.value, 0) || 1
  return kept.map((r) => ({ ...r, pct: r.value / sum })).sort((a, b) => b.value - a.value)
}

/** 可选月份：当前月 + 数据里出现过的月份，倒序 */
export function availableMonths(data, today = new Date()) {
  const set = new Set()
  set.add(`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`)
  set.add(`${today.getFullYear() - 1}-12`) // 给一个方便回看的上一年
  for (const t of data.trips || []) if (t.date) set.add(monthOf(t.date))
  for (const c of data.costs || []) if (c.date) set.add(monthOf(c.date))
  return [...set].filter(Boolean).sort().reverse()
}
