/* ============================================================
   趟次字段定义与校验
   ------------------------------------------------------------
   一条趟次记录这些：日期、路线、车型（考核维度）、司机（考核对象）、
   车辆（可选，用于「同一辆车」的严格对比）、载重、实际油耗、
   过路费、运费。

   公里数与车型在录入时就从路线/车辆**快照**下来：
   路线以后改了公里数，历史趟次不该被改写。
   ============================================================ */
import { parseDate, toISODate } from './date.js'
import { parseNumber } from './vehicleRules.js'
import { isSuspicious } from './fuelModel.js'

export const TRIP_FIELDS = [
  { key: 'date', label: '运输日期', required: true, type: 'date' },
  { key: 'routeId', label: '路线', required: true, type: 'ref' },
  // 车型不在这里：它绑定在车辆上，选完车辆自动带出（记录里存一份快照）
  { key: 'driverId', label: '司机', required: true, type: 'ref', hint: '考核对象' },
  { key: 'vehicleId', label: '车辆', required: true, type: 'ref', hint: '车型由车辆带出' },
  { key: 'tonnage', label: '实际载重', required: true, type: 'number', unit: '吨' },
  { key: 'actualFuel', label: '实际油耗', required: true, type: 'number', unit: 'L', hint: '这一趟实际加了多少油' },
  { key: 'toll', label: '过路费', required: false, type: 'number', unit: '元', hint: '留空按路线的收费站价格自动带出' },
  { key: 'revenue', label: '运费收入', required: false, type: 'number', unit: '元', hint: '用于统计司机当月创收' },
  { key: 'note', label: '备注', required: false, type: 'text' },
]
export const TRIP_FIELD_MAP = Object.fromEntries(TRIP_FIELDS.map((f) => [f.key, f]))

/** 同一「日期 + 路线 + 司机 + 车」视为同一趟（导入去重用） */
export const tripKeyFields = (t) =>
  [t.date, t.routeId, t.driverId || '', t.vehicleId || ''].join('|')

const MAX_DISTANCE = 20000

/**
 * @param form { date, routeId, type, driverId, vehicleId, tonnage, actualFuel, toll, revenue, distance }
 * @param ctx  { today? }
 */
export function validateTrip(form, ctx = {}) {
  const errors = {}
  const warnings = {}
  const today = ctx.today || new Date()

  // 日期
  const date = parseDate(form.date)
  if (!form.date) errors.date = '请选择运输日期'
  else if (!date) errors.date = '日期格式不对'
  else if (date.getTime() > today.getTime()) errors.date = '运输日期不能晚于今天'

  if (!form.routeId) errors.routeId = '请选择路线'
  if (!form.driverId) errors.driverId = '请选择司机'
  // 车辆必选：车型是从车辆上带出来的，没有车辆就没有车型，也算不出油耗指标
  if (!form.vehicleId) errors.vehicleId = '请选择车辆'

  // 公里数（从路线带出，允许改）
  const rawKm = String(form.distance ?? '').trim()
  const km = parseNumber(form.distance)
  if (!rawKm) errors.distance = '请先选择路线（或手动填公里数）'
  else if (Number.isNaN(km)) errors.distance = '公里数必须是数字'
  else if (km <= 0) errors.distance = '公里数必须大于 0'
  else if (km > MAX_DISTANCE) errors.distance = '公里数异常，请确认'

  // 载重
  const rawT = String(form.tonnage ?? '').trim()
  const tonnage = parseNumber(form.tonnage)
  if (rawT === '') errors.tonnage = '请填写实际载重'
  else if (Number.isNaN(tonnage)) errors.tonnage = '载重必须是数字'
  else if (tonnage < 0) errors.tonnage = '载重不能为负'
  else if (tonnage > 100) errors.tonnage = '载重超过 100 吨，请确认是否填错'

  // 实际油耗
  const rawF = String(form.actualFuel ?? '').trim()
  const fuel = parseNumber(form.actualFuel)
  if (rawF === '') errors.actualFuel = '请填写这一趟的实际油耗'
  else if (Number.isNaN(fuel)) errors.actualFuel = '油耗必须是数字'
  else if (fuel <= 0) errors.actualFuel = '实际油耗必须大于 0'
  else if (fuel > 5000) errors.actualFuel = '油耗数值异常，请确认'

  // 数据体检：只拦「物理上不可能」的油耗，不再和车型标准值比
  // （标准油耗那套已经按需求去掉，考核看的是每吨每百公里耗油量）
  if (!errors.actualFuel && !errors.distance && !errors.tonnage && isSuspicious({ type: form.type, actualFuel: fuel, distance: km })) {
    warnings.actualFuel = `折合 ${((fuel / km) * 100).toFixed(1)} L/100km，低于该车型的物理下限，请核对里程与加油量`
  }

  // 过路费 / 运费
  for (const [k, label] of [['toll', '过路费'], ['revenue', '运费收入']]) {
    const raw = String(form[k] ?? '').trim()
    if (raw === '') continue
    const n = Number(raw)
    if (Number.isNaN(n)) errors[k] = `${label}必须是数字`
    else if (n < 0) errors[k] = `${label}不能为负`
  }

  return { errors, warnings, ok: Object.keys(errors).length === 0 }
}

export function toTripPayload(form) {
  return {
    date: toISODate(form.date),
    routeId: String(form.routeId || ''),
    type: form.type,
    distance: Number(parseNumber(form.distance)) || 0,
    driverId: String(form.driverId || ''),
    vehicleId: String(form.vehicleId || ''),
    tonnage: Number(parseNumber(form.tonnage)) || 0,
    actualFuel: Number(parseNumber(form.actualFuel)) || 0,
    toll: Number(parseNumber(form.toll)) || 0,
    revenue: Number(parseNumber(form.revenue)) || 0,
    note: String(form.note || '').trim(),
  }
}
