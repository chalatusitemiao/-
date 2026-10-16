/* ============================================================
   手工成本：唯一数据源
   ------------------------------------------------------------
   · 初始为空 —— 不内置任何数据，全部由录入产生
   · 存在 sessionStorage：刷新不丢，关掉标签页就清空
   · 只有「车辆配件 / 车辆证件」才挂车辆，其他用途不挂
   ============================================================ */
import { reactive } from 'vue'
import { needVehicle } from '../data/costs.js'
import { parseNumber } from '../utils/vehicleRules.js'

const SS_KEY = 'fleet.costs.v1'

/* ---------------- 持久化 ---------------- */
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

function readStored() {
  if (!storage) return null
  try {
    const raw = storage.getItem(SS_KEY)
    if (raw === null) return null
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return null
    return arr.filter((c) => c && typeof c.id === 'string' && c.date && c.purpose)
  } catch {
    return null
  }
}

/* ---------------- 状态 ---------------- */
export const costs = reactive(readStored() ?? [])
export const costMap = reactive({})

function reindex() {
  for (const k of Object.keys(costMap)) {
    if (!costs.some((c) => c.id === k)) delete costMap[k]
  }
  for (const c of costs) costMap[c.id] = c
}
reindex()

function persist() {
  if (!storage) return
  try {
    storage.setItem(SS_KEY, JSON.stringify(costs.map((c) => ({ ...c }))))
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
  for (const c of costs) {
    const m = /(\d+)\s*$/.exec(String(c.id || ''))
    if (m) max = Math.max(max, Number(m[1]))
  }
  return max + 1
}
export const nextCostId = () => 'C' + String(nextSeq()).padStart(4, '0')

export const findCost = (id) => costMap[id] || null
export const costsOfVehicle = (vehicleId) => costs.filter((c) => c.vehicleId === vehicleId)
export const costsOfMonth = (month) => costs.filter((c) => String(c.date).slice(0, 7) === month)

/* ---------------- 组装记录 ---------------- */
function buildRecord(form, base = {}) {
  const purpose = String(form.purpose || '')
  return {
    ...base,
    id: base.id || nextCostId(),
    date: String(form.date || '').trim(),
    purpose,
    // 「其他」不挂车 —— 表单里残留的车辆 id 也清掉，免得被算进某台车
    vehicleId: needVehicle(purpose) ? String(form.vehicleId || '').trim() : '',
    amount: Math.round((Number(parseNumber(form.amount)) || 0) * 100) / 100,
    note: String(form.note || '').trim(),
    manual: true,
  }
}

/* ---------------- 增删改 ---------------- */
export function addCost(form) {
  const rec = buildRecord(form)
  costs.unshift(rec)
  commit()
  return rec
}

export function updateCost(id, form) {
  const i = costs.findIndex((c) => c.id === id)
  if (i < 0) return null
  Object.assign(costs[i], buildRecord(form, { ...costs[i], id }))
  commit()
  return costs[i]
}

export function removeCost(id) {
  const i = costs.findIndex((c) => c.id === id)
  if (i < 0) return false
  costs.splice(i, 1)
  commit()
  return true
}

/** 删车时清掉挂在它身上的成本记录（留着会变成孤儿） */
export function removeCostsByVehicle(vehicleId) {
  const n = costs.length
  for (let i = costs.length - 1; i >= 0; i--) {
    if (costs[i].vehicleId === vehicleId) costs.splice(i, 1)
  }
  commit()
  return n - costs.length
}

/* ---------------- 批量导入 ---------------- */
export function importCosts(drafts) {
  const fresh = []
  let updated = 0
  // 同一「日期 + 用途 + 车辆 + 金额 + 备注」视为同一笔，重复导入按替换处理
  const key = (c) => [c.date, c.purpose, c.vehicleId || '', c.amount, c.note || ''].join('|')
  const byKey = new Map(costs.map((c) => [key(c), c]))
  let seq = nextSeq()

  for (const d of drafts) {
    const form = d.draft || d
    if (!form.date || !form.purpose) continue
    const k = key(buildRecord({ ...form, id: 'tmp' }))
    const prev = byKey.get(k)
    if (prev) {
      Object.assign(prev, buildRecord(form, { ...prev, id: prev.id }))
      updated++
    } else {
      const rec = buildRecord(form, { id: 'C' + String(seq++).padStart(4, '0') })
      byKey.set(k, rec)
      fresh.push(rec)
    }
  }

  if (fresh.length) costs.unshift(...fresh)
  commit()
  return { added: fresh.length, updated }
}

/* ---------------- 清空 ---------------- */
/** 清空全部手工成本。界面上没有这个入口，只给自检脚本重置状态用。 */
export function clearAll() {
  costs.splice(0, costs.length)
  commit()
}
