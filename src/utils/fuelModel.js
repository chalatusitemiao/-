/* ============================================================
   油耗指标
   ------------------------------------------------------------
   ★ 核心指标：每吨每百公里耗油量（L / 吨·百公里）★

       实际油耗 ÷ (载重 × 公里数 ÷ 100)

   为什么用这个而不是「百公里油耗」：百公里油耗不区分拉了 30 吨还是 5 吨，
   同样一条路，拉轻货的司机数字天然好看。
   按「吨·百公里」一除，载重就被归一化掉了 ——
   于是同一条路线、同一类型车辆的司机可以直接横向比。

   车型基准表（data/vehicles.js）仍然保留，但只用于两件事：
     1. 新车录入时给一个满载参考油耗与油箱容量
     2. 数据体检：判断某一趟的油耗是否低到物理上不可能
   不再用它算「标准油耗」，也就没有节油率与奖金了。
   ============================================================ */
import { profileOf } from '../data/vehicles.js'

/**
 * 车型的油耗基准档位。
 * 车型名是自由输入的，所以这里可能返回「靠关键词推断」或「通用估算」的档位。
 */
export const typeProfile = (type) => profileOf(type)

/** 车型名是否原样存在于基准表 */
export { isKnownType, isEstimatedType } from '../data/vehicles.js'

/* ---------------- 车型基准（仅用于默认值与数据体检） ---------------- */

/** 某车型在某个载重下的参考百公里油耗（L/100km） */
export function fuelRate(type, tonnage) {
  const p = typeProfile(type)
  const t = Number(tonnage)
  const load = Number.isFinite(t) && t >= 0 ? t : p.normTonnage
  return Math.round((p.baseFuel + p.fuelPerTon * load) * 100) / 100
}

/** 空载百公里油耗（那条直线的截距） */
export const idleFuelRate = (type) => fuelRate(type, 0)

/** 满载参考百公里油耗（额定载重下） */
export const normFuelRate = (type) => fuelRate(type, typeProfile(type).normTonnage)

/**
 * 数据体检：油耗低于物理下限基本可以断定是数据错了（少报加油量之类）。
 * 下限取「空载油耗的 60%」—— 再省也省不到这个程度。
 */
export function isSuspicious({ type, actualFuel, distance }) {
  const km = Number(distance) || 0
  const actual = Number(actualFuel) || 0
  if (km <= 0 || actual <= 0) return false
  const floor = (idleFuelRate(type) * 0.6) / 100
  return actual / km < floor
}

/* ---------------- 核心指标 ---------------- */

/** 「吨·百公里」：载重 × 公里数 ÷ 100，指标的加权分母 */
export function tonHundredKm(tonnage, distance) {
  const t = Number(tonnage)
  const km = Number(distance)
  if (!(t > 0) || !(km > 0)) return 0
  return (t * km) / 100
}

/**
 * 每吨每百公里耗油量（L / 吨·百公里）。
 * 空载（载重 0）或数据不全时算不出来，返回 null —— 不能拿 0 冒充，
 * 否则空载返程会把平均值拉得好看得不真实。
 */
export function fuelPerTon100km(tonnage, distance, actualFuel) {
  const base = tonHundredKm(tonnage, distance)
  const fuel = Number(actualFuel)
  if (base <= 0 || !(fuel > 0)) return null
  return Math.round((fuel / base) * 1000) / 1000
}

/** 这一趟的百公里油耗（不带载重归一化，只作参考） */
export function fuelPer100km(distance, actualFuel) {
  const km = Number(distance)
  const fuel = Number(actualFuel)
  if (!(km > 0) || !(fuel > 0)) return 0
  return Math.round((fuel / km) * 100 * 100) / 100
}

/**
 * 汇总一组趟次。加权口径：
 *   每吨百公里 = Σ油耗 ÷ Σ(载重 × 公里数 ÷ 100)
 * 而不是各趟指标的算术平均 —— 否则跑一趟短途就会和长途等权。
 *
 * 同时给出单趟的**波动范围**（min~max），
 * 用来回答「同一位司机在同一条路上大概烧多少」。
 */
export function aggregateTrips(trips) {
  const all = Array.isArray(trips) ? trips : []
  const rows = all.filter(
    (t) => Number(t.actualFuel) > 0 && Number(t.distance) > 0 && Number(t.tonnage) > 0
  )

  const base = {
    trips: rows.length,
    skipped: all.length - rows.length,
    distance: 0,
    actual: 0,
    revenue: 0,
    toll: 0,
    tonHundred: 0,
    perTon100: null,
    perTon100Min: null,
    perTon100Max: null,
    per100km: 0,
    avgTonnage: 0,
  }
  if (!rows.length) return base

  const values = []
  let tonnageSum = 0
  for (const t of rows) {
    base.distance += Number(t.distance) || 0
    base.actual += Number(t.actualFuel) || 0
    base.revenue += Number(t.revenue) || 0
    base.toll += Number(t.toll) || 0
    base.tonHundred += tonHundredKm(t.tonnage, t.distance)
    tonnageSum += Number(t.tonnage) || 0
    const v = fuelPerTon100km(t.tonnage, t.distance, t.actualFuel)
    if (v !== null) values.push(v)
  }

  base.perTon100 = base.tonHundred > 0 ? Math.round((base.actual / base.tonHundred) * 1000) / 1000 : null
  base.perTon100Min = values.length ? Math.min(...values) : null
  base.perTon100Max = values.length ? Math.max(...values) : null
  base.per100km = base.distance > 0 ? Math.round((base.actual / base.distance) * 100 * 100) / 100 : 0
  base.avgTonnage = Math.round((tonnageSum / rows.length) * 10) / 10
  return base
}
