/* ============================================================
   手工成本：字段定义与校验
   ------------------------------------------------------------
   用途决定要填什么：
     车辆配件 / 车辆证件 → 必须挂到具体车辆（否则算不出「每辆车花了多少」）
     其他               → 只要金额和备注
   ============================================================ */
import { parseDate, toISODate } from './date.js'
import { parseNumber } from './vehicleRules.js'
import { COST_PURPOSES, needVehicle, purposeName } from '../data/costs.js'

export const COST_FIELDS = [
  { key: 'date', label: '发生日期', required: true, type: 'date' },
  { key: 'purpose', label: '用途', required: true, type: 'select', options: COST_PURPOSES.map((p) => p.key) },
  { key: 'vehicleId', label: '车辆', required: false, type: 'ref', hint: '用途是配件或证件时必须选' },
  { key: 'amount', label: '金额', required: true, type: 'number', unit: '元' },
  { key: 'note', label: '备注', required: false, type: 'text', hint: '选「其他」时建议写清楚是什么支出' },
]
export const COST_FIELD_MAP = Object.fromEntries(COST_FIELDS.map((f) => [f.key, f]))

/** 金额上限：单笔超过这个数基本是填错了 */
const MAX_AMOUNT = 10000000

/**
 * @param form { date, purpose, vehicleId, amount, note }
 * @param ctx  { today? }
 */
export function validateCost(form, ctx = {}) {
  const errors = {}
  const warnings = {}
  const today = ctx.today || new Date()

  // 日期
  const date = parseDate(form.date)
  if (!String(form.date ?? '').trim()) errors.date = '请选择发生日期'
  else if (!date) errors.date = '日期格式不对'
  else if (date.getTime() > today.getTime()) errors.date = '发生日期不能晚于今天'

  // 用途
  if (!form.purpose) errors.purpose = '请选择用途'
  else if (!COST_PURPOSES.some((p) => p.key === form.purpose)) errors.purpose = '用途不在可选范围内'

  // 车辆：只有配件 / 证件才要求挂车
  if (needVehicle(form.purpose) && !form.vehicleId) {
    errors.vehicleId = `${purposeName(form.purpose)}必须选一台车`
  }

  // 金额
  const rawAmount = String(form.amount ?? '').trim()
  const amount = parseNumber(form.amount)
  if (rawAmount === '') errors.amount = '请填写金额'
  else if (Number.isNaN(amount)) errors.amount = '金额必须是数字'
  else if (amount <= 0) errors.amount = '金额必须大于 0'
  else if (amount > MAX_AMOUNT) errors.amount = '金额超过 1000 万，请确认是否填错'

  // 备注：选「其他」时不强制，但不写就没人知道这笔是什么
  if (form.purpose === 'other' && !String(form.note ?? '').trim()) {
    warnings.note = '选「其他」建议写个备注，否则以后看不出这笔是什么支出'
  }

  return { errors, warnings, ok: Object.keys(errors).length === 0 }
}

/** 校验通过后转成入库对象 */
export function toCostPayload(form) {
  const purpose = form.purpose
  return {
    date: toISODate(form.date),
    purpose,
    // 「其他」不挂车：即使表单里残留了车辆 id 也清掉，免得统计时被算进某台车
    vehicleId: needVehicle(purpose) ? String(form.vehicleId || '') : '',
    amount: Math.round((Number(parseNumber(form.amount)) || 0) * 100) / 100,
    note: String(form.note ?? '').trim(),
  }
}
