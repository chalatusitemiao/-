/* ============================================================
   司机档案：全站唯一的司机数据源
   ------------------------------------------------------------
   · 初始为空 —— 不内置任何数据，全部由录入 / 导入产生
   · 存在 sessionStorage：刷新不丢，关掉标签页就清空
   · 以「手机号」为主键：相同手机号是替换，不同手机号是新增
   · 事故/违章是司机名下的子记录，只能手工增删，不从表格导入
   ============================================================ */
import { reactive } from 'vue'
import { normalizePhone, normalizeLicenseNo, parseSalary } from '../utils/driverRules.js'

const SS_KEY = 'fleet.drivers.v1'

/* ---------------- 持久化（sessionStorage） ---------------- */
function pickStorage(name) {
  try {
    const s = globalThis[name]
    if (!s) return null
    s.setItem('__probe__', '1')
    const ok = s.getItem('__probe__') === '1'
    s.removeItem('__probe__')
    return ok ? s : null
  } catch {
    return null
  }
}
const storage = pickStorage('sessionStorage')

/** 事故记录也补上稳定 id，方便列表 key 与单条删改 */
let incidentSeq = 0
const nextIncidentId = () => 'inc_' + (++incidentSeq) + '_' + Math.random().toString(36).slice(2, 7)

function tidyIncidents(list) {
  return (Array.isArray(list) ? list : [])
    .filter((i) => i && typeof i === 'object')
    .map((i) => ({
      id: i.id || nextIncidentId(),
      date: String(i.date || ''),
      desc: String(i.desc || ''),
      loss: Number(i.loss) || 0,
    }))
}

function readStored() {
  if (!storage) return null
  try {
    const raw = storage.getItem(SS_KEY)
    if (raw === null) return null
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return null
    return arr
      .filter((d) => d && typeof d.id === 'string' && typeof d.phone === 'string')
      .map((d) => ({ ...d, incidents: tidyIncidents(d.incidents) }))
  } catch {
    return null
  }
}

/* ---------------- 状态 ---------------- */
export const drivers = reactive(readStored() ?? [])

export const driverMap = reactive({})

function reindex() {
  for (const k of Object.keys(driverMap)) {
    if (!drivers.some((d) => d.id === k)) delete driverMap[k]
  }
  for (const d of drivers) driverMap[d.id] = d
}
reindex()

function persist() {
  if (!storage) return
  try {
    storage.setItem(SS_KEY, JSON.stringify(drivers.map((d) => ({ ...d }))))
  } catch {
    /* 配额满：降级为仅本次会话有效 */
  }
}

function commit() {
  reindex()
  persist()
}

/* ---------------- 编号与查询 ---------------- */
function nextSeq() {
  let max = 0
  for (const d of drivers) {
    const m = /(\d+)\s*$/.exec(String(d.id || ''))
    if (m) max = Math.max(max, Number(m[1]))
  }
  return max + 1
}
export const nextDriverId = () => 'D' + String(nextSeq()).padStart(2, '0')

export const findDriver = (id) => driverMap[id] || null
export const phoneSet = () => new Set(drivers.map((d) => d.phone))
export const licenseSet = () =>
  new Set(drivers.map((d) => normalizeLicenseNo(d.licenseNo)).filter(Boolean))
export const isPhoneTaken = (phone, exceptId) =>
  drivers.some((d) => d.id !== exceptId && d.phone === normalizePhone(phone))
export const isLicenseTaken = (no, exceptId) => {
  const v = normalizeLicenseNo(no)
  if (!v) return false
  return drivers.some((d) => d.id !== exceptId && normalizeLicenseNo(d.licenseNo) === v)
}

/* ---------------- 组装记录 ---------------- */
function buildRecord(form, base = {}) {
  return {
    ...base,
    id: base.id || nextDriverId(),
    name: String(form.name ?? '').trim(),
    phone: normalizePhone(form.phone),
    hireDate: form.hireDate || base.hireDate || '',
    licenseNo: normalizeLicenseNo(form.licenseNo),
    salary: parseSalary(form.salary),
    incidents: base.incidents || [],
    manual: true,
  }
}

/* ---------------- 增删改 ---------------- */
export function addDriver(form) {
  const rec = buildRecord(form)
  drivers.unshift(rec)
  commit()
  return rec
}

export function updateDriver(id, form) {
  const i = drivers.findIndex((d) => d.id === id)
  if (i < 0) return null
  const next = buildRecord(form, { ...drivers[i], id })
  // 表单里如果带了事故/违章列表（编辑态会带），整份替换；
  // 不带就保留原有的，避免调用方漏传把记录清空
  if (Array.isArray(form.incidents)) next.incidents = tidyIncidents(form.incidents)
  Object.assign(drivers[i], next)
  commit()
  return drivers[i]
}

export function removeDriver(id) {
  const i = drivers.findIndex((d) => d.id === id)
  if (i < 0) return false
  drivers.splice(i, 1)
  commit()
  return true
}

/** 某司机的事故统计：次数与累计经济损失 */
export function incidentSummary(driver) {
  const list = (driver && driver.incidents) || []
  return {
    count: list.length,
    loss: list.reduce((a, x) => a + (Number(x.loss) || 0), 0),
    latest: list.reduce((a, x) => (!a || x.date > a ? x.date : a), ''),
  }
}

/* ---------------- 批量导入（手机号为主键） ---------------- */
export function importDrivers(drafts) {
  const fresh = []
  let updated = 0
  const byPhone = new Map(drivers.map((d) => [d.phone, d]))
  // 新记录要等循环结束才入数组，编号得自己递增着分配
  let seq = nextSeq()

  for (const d of drafts) {
    const form = d.draft || d
    const phone = normalizePhone(form.phone)
    if (!phone) continue

    const prev = byPhone.get(phone)
    if (prev) {
      // 替换：保留原 id 与已有的事故记录
      Object.assign(prev, buildRecord(form, { ...prev, id: prev.id }))
      updated++
    } else {
      const id = 'D' + String(seq++).padStart(2, '0')
      const rec = buildRecord(form, { id })
      byPhone.set(phone, rec)
      fresh.push(rec)
    }
  }

  if (fresh.length) drivers.unshift(...fresh)
  commit()
  return { added: fresh.length, updated }
}

/* ---------------- 清空 ---------------- */
/** 清空全部司机。界面上没有这个入口，只给自检脚本重置状态用。 */
export function clearAll() {
  drivers.splice(0, drivers.length)
  commit()
}
