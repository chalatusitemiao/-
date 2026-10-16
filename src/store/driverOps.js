/* ============================================================
   司机当月运营统计
   ------------------------------------------------------------
   数据源就是**趟次记录**（store/trips.js）——
   司机当月创收 = Σ运费、当月总里程 = Σ公里数、当月总油耗 = Σ实际油耗。
   所以运单/趟次模块一落地，司机那三个字段自动就有数了。

   汇总算法在 utils/driverStats.js（纯函数，可脱离 Vue 单测），
   这里只负责把趟次投影成运营记录。
   ============================================================ */
import { trips } from './trips.js'
import { aggregateOps, formatEnergy, monthKey } from '../utils/driverStats.js'

/**
 * 把一条趟次投影成运营记录。
 * 目前车型表里都是燃油车，所以能耗类型恒为 fuel；
 * 以后加了电动车，在这里按车辆的燃料类型区分即可（界面不用改）。
 */
function toOpsRow(t, month) {
  return {
    driverId: t.driverId,
    month,
    revenue: Number(t.revenue) || 0,
    mileage: Number(t.distance) || 0,
    energy: Number(t.actualFuel) || 0,
    energyType: 'fuel',
  }
}

/** 某司机某月的统计；没有数据返回 null（界面显示「—」而不是 0） */
export function monthlyStats(driverId, month = monthKey()) {
  const rows = trips
    .filter((t) => t.driverId === driverId && String(t.date).slice(0, 7) === month)
    .map((t) => toOpsRow(t, month))
  return aggregateOps(rows)
}

/** 汇总所有司机某月的指标（列表页汇总卡用） */
export function allMonthlyStats(month = monthKey()) {
  const rows = trips
    .filter((t) => String(t.date).slice(0, 7) === month)
    .map((t) => toOpsRow(t, month))
  return aggregateOps(rows)
}

/** 是否有任何趟次数据 */
export const hasOpsData = () => trips.length > 0

/** 有运营数据的月份列表（倒序），用于按月份查看 */
export function monthsWithData() {
  return [...new Set(trips.map((t) => String(t.date).slice(0, 7)).filter(Boolean))].sort().reverse()
}

export { monthKey, aggregateOps, formatEnergy }
