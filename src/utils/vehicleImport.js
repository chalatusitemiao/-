/* ============================================================
   车辆导入：表头识别 + 逐行校验
   ------------------------------------------------------------
   导入不是「读进来就算数」——Excel 里的数据脏得很：
   带单位的数字、简写的车型、各种写法的日期、重复的车牌、空行。
   所以这里把每一行都过一遍和表单完全相同的校验规则，
   分成「可导入 / 有错误」两类，让人先看清楚再决定。
   ============================================================ */
import { FIELDS, validateVehicle, normalizeCarType, parseNumber, normalizePlate } from './vehicleRules.js'
import { toISODate } from './date.js'

const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/[\s()（）_\-·、/]/g, '')

/**
 * 根据表头行自动匹配列。
 * 先精确匹配别名，再退化为包含匹配（能容忍「载重（吨）」「车辆类型」这类写法）。
 * @returns {{ mapping: Record<string, number>, missing: string[], extra: number[] }}
 */
export function matchColumns(header = []) {
  const heads = header.map(norm)
  const mapping = {}
  const used = new Set()

  for (const f of FIELDS) {
    const idx = heads.findIndex((h) => h && f.aliases.some((a) => norm(a) === h))
    if (idx >= 0) {
      mapping[f.key] = idx
      used.add(idx)
    }
  }
  for (const f of FIELDS) {
    if (mapping[f.key] !== undefined) continue
    const idx = heads.findIndex(
      (h, i) => h && !used.has(i) && f.aliases.some((a) => h.includes(norm(a)) || norm(a).includes(h))
    )
    if (idx >= 0) {
      mapping[f.key] = idx
      used.add(idx)
    }
  }
  return {
    mapping,
    missing: FIELDS.filter((f) => f.required && mapping[f.key] === undefined).map((f) => f.key),
    extra: heads.map((_, i) => i).filter((i) => !used.has(i)),
  }
}

/** 把一行原始单元格转成规范形态。
    车牌必须在这里就归一化 —— 否则「苏E8K215」和「苏E·8K215」会被当成两台车，
    文件内查重与「车牌已存在」判断都会失效。
    日期必须在这里还原 —— Excel 的日期单元格读出来是序列号数字。 */
export function coerceRow(row = [], mapping = {}) {
  const get = (k) => {
    const i = mapping[k]
    return i === undefined || i < 0 ? '' : row[i]
  }
  const rawPlate = String(get('plate') ?? '').trim()
  return {
    plate: rawPlate ? normalizePlate(rawPlate) : '',
    type: normalizeCarType(get('type')),
    tonnage: parseNumber(get('tonnage')),
    price: parseNumber(get('price')),
    buyDate: toISODate(get('buyDate')),
    odo: parseNumber(get('odo')),
  }
}

const isBlank = (row) => !row || row.every((c) => String(c ?? '').trim() === '')

/**
 * 逐行校验，产出草稿。
 * 车牌号是主键：已在系统里 → 替换（update），不在 → 新增（add）。
 * 没有「跳过」这种中间状态。
 * @param rows      二维数组（第 0 行是表头）
 * @param mapping   字段 → 列号
 * @param opts      { existingPlates:Set }
 */
export function buildDrafts(rows, mapping, opts = {}) {
  const { existingPlates = new Set() } = opts
  const drafts = []
  const seenPlate = new Set()

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]
    if (isBlank(row)) continue

    const draft = coerceRow(row, mapping)
    const dupInFile = !!draft.plate && seenPlate.has(draft.plate)
    const existsInStore = !!draft.plate && existingPlates.has(draft.plate)

    const { errors, warnings } = validateVehicle(draft)
    // 同一份文件里出现两次相同车牌 —— 后面那行会把前面覆盖掉，属于数据错误
    if (dupInFile) errors.plate = '这份文件里前面的行已经用过这个车牌了'

    drafts.push({
      /** 原始文件里的行号（表头是第 1 行） */
      line: i + 1,
      draft,
      errors,
      warnings,
      exists: existsInStore,
      action: Object.keys(errors).length ? 'error' : existsInStore ? 'update' : 'add',
    })

    if (draft.plate) seenPlate.add(draft.plate)
  }
  return drafts
}

/** 生成导入结果的摘要 */
export function summarizeDrafts(drafts) {
  return drafts.reduce(
    (a, d) => {
      if (d.action === 'error') a.error++
      else if (d.action === 'update') a.update++
      else a.add++
      return a
    },
    { add: 0, update: 0, error: 0, total: drafts.length }
  )
}

/* ---------------- 模板 ---------------- */
/** 生成 CSV 模板（带 BOM，Excel 双击不乱码） */
export function templateCsv() {
  const headers = FIELDS.map((f) => f.label + (f.unit ? `(${f.unit})` : ''))
  const sample = [
  ]
  const esc = (v) => {
    const s = String(v ?? '')
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return '\ufeff' + [headers, ...sample].map((r) => r.map(esc).join(',')).join('\r\n')
}

export function downloadTemplate() {
  const blob = new Blob([templateCsv()], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = '车辆导入模板.csv'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export { normalizePlate }
