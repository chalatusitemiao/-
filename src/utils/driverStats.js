/* ============================================================
   司机运营统计的汇总逻辑（纯函数，不依赖 Vue）
   ------------------------------------------------------------
   当月创收 / 当月总里程 / 当月总油耗电耗 由运营流水汇总而来。
   这里只放算法，数据源在 store/driverOps.js。
   拆开是为了能脱离 Vue 直接单测。
   ============================================================ */
import { ENERGY_TYPES } from '../data/drivers.js'
import { num } from './format.js'

/** 'YYYY-MM' */
export const monthKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

/**
 * 把若干条运营记录汇总成当月指标。
 * 没有任何记录时返回 null —— 界面据此显示「—」而不是 0，
 * 这样「真的跑了 0 公里」和「还没接入数据」不会被混为一谈。
 *
 * 记录结构：{ driverId, month:'YYYY-MM', revenue:元, mileage:km,
 *            energy:数字, energyType:'fuel'|'electric' }
 */
export function aggregateOps(rows) {
  if (!rows || !rows.length) return null
  let revenue = 0
  let mileage = 0
  const byType = {}
  for (const r of rows) {
    revenue += Number(r.revenue) || 0
    mileage += Number(r.mileage) || 0
    const t = r.energyType === 'electric' ? 'electric' : 'fuel'
    byType[t] = (byType[t] || 0) + (Number(r.energy) || 0)
  }
  const energy = Object.keys(byType)
    .filter((t) => byType[t] > 0)
    .map((t) => ({ type: t, value: Math.round(byType[t]) }))
  return {
    revenue: Math.round(revenue),
    mileage: Math.round(mileage),
    energy,
    days: rows.length,
    perKm: mileage > 0 ? revenue / mileage : 0,
  }
}

/** 能耗展示：'1,200 L' / '890 kWh' / '1,200 L + 90 kWh' */
export function formatEnergy(parts) {
  if (!parts || !parts.length) return '—'
  return parts.map((p) => `${num(p.value)} ${ENERGY_TYPES[p.type]?.unit || ''}`.trim()).join(' + ')
}
