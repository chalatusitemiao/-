/* ============================================================
   司机导入：表头识别 + 逐行校验
   ------------------------------------------------------------
   只处理「可上传」的四个字段。当月创收/里程/油耗电耗是自动统计的，
   事故违章是手工子记录 —— 这两类都不参与导入，模板里也没有它们的列。
   规则和车辆模块一致：手机号是主键，已存在判替换、不存在判新增。
   ============================================================ */
import { UPLOAD_FIELDS, validateDriver, normalizePhone, normalizeLicenseNo } from './driverRules.js'
import { toISODate } from './date.js'

const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/[\s()（）_\-·、/]/g, '')

/**
 * 根据表头行自动匹配列。
 * 先精确匹配别名，再退化为包含匹配（能容忍「手机号码」「入职时间」这类写法）。
 */
export function matchColumns(header = []) {
  const heads = header.map(norm)
  const mapping = {}
  const used = new Set()

  for (const f of UPLOAD_FIELDS) {
    const idx = heads.findIndex((h) => h && f.aliases.some((a) => norm(a) === h))
    if (idx >= 0) {
      mapping[f.key] = idx
      used.add(idx)
    }
  }
  for (const f of UPLOAD_FIELDS) {
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
    missing: UPLOAD_FIELDS.filter((f) => f.required && mapping[f.key] === undefined).map((f) => f.key),
    extra: heads.map((_, i) => i).filter((i) => !used.has(i)),
  }
}

/** 把一行原始单元格转成规范形态（手机号必须在这里就归一化，否则查重会失效） */
export function coerceRow(row = [], mapping = {}) {
  const get = (k) => {
    const i = mapping[k]
    return i === undefined || i < 0 ? '' : row[i]
  }
  const rawPhone = String(get('phone') ?? '').trim()
  return {
    name: String(get('name') ?? '').trim(),
    phone: rawPhone ? normalizePhone(rawPhone) : '',
    hireDate: toISODate(get('hireDate')),
    licenseNo: normalizeLicenseNo(get('licenseNo')),
    salary: String(get('salary') ?? '').trim(),
  }
}

const isBlank = (row) => !row || row.every((c) => String(c ?? '').trim() === '')

/**
 * 逐行校验，产出草稿。
 * @param rows      二维数组（第 0 行是表头）
 * @param mapping   字段 → 列号
 * @param opts      { existingPhones:Set, existingLicenses:Set }
 */
export function buildDrafts(rows, mapping, opts = {}) {
  const { existingPhones = new Set(), existingLicenses = new Set() } = opts
  const drafts = []
  const seenPhone = new Set()
  const seenLicense = new Set()

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]
    if (isBlank(row)) continue

    const draft = coerceRow(row, mapping)
    const dupInFile = !!draft.phone && seenPhone.has(draft.phone)
    const existsInStore = !!draft.phone && existingPhones.has(draft.phone)

    const { errors, warnings } = validateDriver(draft, {
      licenseTaken: (no) => seenLicense.has(no),
    })
    if (dupInFile) errors.phone = '这份文件里前面的行已经用过这个手机号了'

    drafts.push({
      line: i + 1,
      draft,
      errors,
      warnings,
      exists: existsInStore,
      action: Object.keys(errors).length ? 'error' : existsInStore ? 'update' : 'add',
    })

    if (draft.phone) seenPhone.add(draft.phone)
    if (draft.licenseNo) seenLicense.add(draft.licenseNo)
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
/** 模板只含四个可上传字段 —— 统计列与事故记录本来就不该出现在导入文件里 */
export function templateCsv() {
  const headers = UPLOAD_FIELDS.map((f) => f.label)
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
  a.download = '司机导入模板.csv'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
