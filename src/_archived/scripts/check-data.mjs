/* 数据校准自检：node scripts/check-data.mjs
   打印车队整体毛利率、成本结构、单车离散度，用来核对模拟数据是否“像真的”。
   调整 src/data/mock.js 里的 RATE 表后重跑即可。 */
import {
  DAILY, VEHICLES, DRIVERS, FIXED_MAP, MONTHS, TODAY, DAY_MS,
  ymKey, daysInMonth, round1,
} from '../src/data/mock.js'

const t0 = Date.now()

function accrue(start, end, perVehicleMonth) {
  // 按日历天数计提固定成本 / 底薪（与当天是否出车无关）
  let total = 0
  const cur = new Date(start.getFullYear(), start.getMonth(), 1)
  while (cur <= end) {
    const ym = ymKey(cur)
    const dim = daysInMonth(ym)
    const monthStart = new Date(cur.getFullYear(), cur.getMonth(), 1)
    const monthEnd = new Date(cur.getFullYear(), cur.getMonth(), dim)
    const s = start > monthStart ? start : monthStart
    const e = end < monthEnd ? end : monthEnd
    const days = Math.max(0, Math.round((e - s) / DAY_MS) + 1)
    if (days > 0) total += perVehicleMonth(ym, days / dim)
    cur.setMonth(cur.getMonth() + 1)
  }
  return total
}

function report(label, start, end) {
  const rows = DAILY.filter((r) => r.ts >= start.getTime() && r.ts <= end.getTime())
  const t = { km: 0, rev: 0, fuel: 0, toll: 0, driver: 0, maint: 0 }
  const perV = {}
  for (const r of rows) {
    t.km += r.km; t.rev += r.rev
    t.fuel += r.fuel; t.toll += r.toll; t.driver += r.driver; t.maint += r.maint
    const p = (perV[r.v] ||= { rev: 0, var: 0, km: 0 })
    p.rev += r.rev; p.var += r.var; p.km += r.km
  }
  const fixed = accrue(start, end, (ym, f) =>
    VEHICLES.reduce((a, v) => a + (FIXED_MAP[ym + '|' + v.id]?.total || 0), 0) * f)
  const salary = accrue(start, end, (ym, f) =>
    DRIVERS.reduce((a, d) => a + d.baseSalary + d.social + d.bonus, 0) * f)

  const driverTotal = t.driver + salary
  const cost = t.fuel + t.toll + driverTotal + t.maint + fixed
  const profit = t.rev - cost
  const margin = t.rev ? profit / t.rev : 0

  // 单车毛利率离散度
  const perVArr = VEHICLES.map((v) => {
    const p = perV[v.id] || { rev: 0, var: 0, km: 0 }
    const fx = accrue(start, end, (ym, f) => (FIXED_MAP[ym + '|' + v.id]?.total || 0) * f)
    const sal = accrue(start, end, (ym, f) => {
      const d = DRIVERS.find((x) => x.id === v.driverId)
      return (d ? d.baseSalary + d.social + d.bonus : 0) * f
    })
    const c = p.var + fx + sal
    return { id: v.id, plate: v.plate, km: p.km, rev: p.rev, cost: c, margin: p.rev ? (p.rev - c) / p.rev : 0, cpk: p.km ? c / p.km : 0 }
  }).filter((x) => x.km > 0)

  const sorted = [...perVArr].sort((a, b) => a.margin - b.margin)
  const pct = (k) => ((t[k] / cost) * 100).toFixed(1) + '%'

  console.log(`\n===== ${label} =====`)
  console.log(`  记录数 ${rows.length}  车日 ${rows.length}  里程 ${(t.km / 10000).toFixed(2)} 万公里`)
  console.log(`  收入        ¥${(t.rev / 10000).toFixed(1)} 万`)
  console.log(`  总成本      ¥${(cost / 10000).toFixed(1)} 万`)
  console.log(`  毛利        ¥${(profit / 10000).toFixed(1)} 万   毛利率 ${(margin * 100).toFixed(1)}%`)
  console.log(`  单公里: 收入 ${(t.rev / t.km).toFixed(2)}  成本 ${(cost / t.km).toFixed(2)}  毛利 ${((t.rev - cost) / t.km).toFixed(2)} 元/km`)
  console.log(`  成本结构: 油耗 ${pct('fuel')} | 过路费 ${pct('toll')} | 司机 ${((driverTotal / cost) * 100).toFixed(1)}% | 固定 ${((fixed / cost) * 100).toFixed(1)}% | 维保 ${pct('maint')}`)
  console.log(`  百公里油耗(车队加权) ${((rows.reduce((a, r) => a + r.liters, 0) / t.km) * 100).toFixed(1)} L/100km`)
  console.log(`  车日均里程 ${Math.round(t.km / rows.length)} km/车日`)
  console.log(`  单车毛利率: 最差 ${sorted[0]?.plate} ${(sorted[0]?.margin * 100).toFixed(1)}%  |  最好 ${sorted[sorted.length - 1]?.plate} ${(sorted[sorted.length - 1]?.margin * 100).toFixed(1)}%`)
  console.log(`  亏损车辆数 ${perVArr.filter((x) => x.margin < 0).length} / ${perVArr.length}`)
  console.log(`  单车单公里成本 区间 ${Math.min(...perVArr.map((x) => x.cpk)).toFixed(2)} ~ ${Math.max(...perVArr.map((x) => x.cpk)).toFixed(2)} 元/km`)
  return { margin, cost, rev: t.rev }
}

const end = TODAY
const d = (n) => new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate() - n)
report('近 30 天', d(29), end)
report('本月至今', new Date(TODAY.getFullYear(), TODAY.getMonth(), 1), end)
report('近 90 天', d(89), end)
report('近 12 个月', d(364), end)

console.log(`\n数据规模：DAILY ${DAILY.length} 行 / 车辆 ${VEHICLES.length} / 司机 ${DRIVERS.length} / 月份 ${MONTHS.length}`)
console.log(`生成 + 统计耗时 ${Date.now() - t0} ms`)
