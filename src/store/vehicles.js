/* ============================================================
   车辆档案：全站唯一的车辆数据源
   ------------------------------------------------------------
   · 初始为空 —— 不内置任何数据，全部由录入 / 导入产生
   · 存在 sessionStorage：刷新不丢，关掉标签页就清空
   · 以「车牌号」为主键：相同的车牌是替换，不同的车牌是新增
   · vehicleMap 与 vehicles 保持同步，供页面做 O(1) 查表
   · 车编号由系统分配，前台不提供编辑（导入时可由文件指定）
   ============================================================ */
import { reactive } from 'vue'
import {
  CAR_TYPES, TODAY, typeDefaults,
} from '../data/vehicles.js'
import { normalizePlate, normalizeCarType } from '../utils/vehicleRules.js'
import { toISO } from '../utils/date.js'

const SS_KEY = 'fleet.vehicles.v4'

/* ---------------- 持久化（sessionStorage） ----------------
   注意：有些环境里 storage 这个全局是「存在但一访问就抛错」的
   （Node 未开 --localstorage-file、浏览器隐私模式），
   所以必须用 try 包住判断本身，不能只判断 typeof。 */
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
    return arr.filter((v) => v && typeof v.id === 'string' && typeof v.plate === 'string')
  } catch {
    return null
  }
}

/* ---------------- 状态 ---------------- */
/** 初始为空列表：没有存过就什么都不放，而不是塞一堆假数据 */
export const vehicles = reactive(readStored() ?? [])

/** id → 车辆对象（reactive），供循环里高频查表 */
export const vehicleMap = reactive({})

function reindex() {
  for (const k of Object.keys(vehicleMap)) {
    if (!vehicles.some((v) => v.id === k)) delete vehicleMap[k]
  }
  for (const v of vehicles) vehicleMap[v.id] = v
}
reindex()

function persist() {
  if (!storage) return
  try {
    storage.setItem(SS_KEY, JSON.stringify(vehicles.map((v) => ({ ...v }))))
  } catch {
    /* 配额满：降级为仅本次会话有效 */
  }
}

/** 数据变更后统一收口：重建索引 + 落盘 */
function commit() {
  reindex()
  persist()
}

/* ---------------- 编号 ---------------- */
/** 取现有 id / code 末尾数字的最大值，保证新编号不撞车 */
function nextSeq() {
  let max = 0
  const scan = (s) => {
    const m = /(\d+)\s*$/.exec(String(s || ''))
    if (m) max = Math.max(max, Number(m[1]))
  }
  for (const v of vehicles) {
    scan(v.id)
    scan(v.code)
  }
  return max + 1
}

export const nextVehicleId = () => 'V' + String(nextSeq()).padStart(2, '0')
/** 车编号由系统分配，与内部 id 保持一致 */
export const assignCode = () => nextVehicleId()

/* ---------------- 查询 ---------------- */
export const findVehicle = (id) => vehicleMap[id] || null

/* ---------------- 车队里实际出现过的车型 ---------------- */
/**
 * 车辆档案里去重后的车型列表。
 * 车型是自由输入的，所以路线 / 趟次里的车型下拉都从这里取 ——
 * 「只给你有的车型填过路费价格」比列一堆用不上的车型实在。
 * 排序：先按基准表顺序，自定义车型按名称排在后面。
 */
export function fleetTypes() {
  const seen = new Set()
  for (const v of vehicles) {
    const t = String(v.type || '').trim()
    if (t) seen.add(t)
  }
  const known = CAR_TYPES.filter((t) => seen.has(t))
  const rest = [...seen].filter((t) => !CAR_TYPES.includes(t)).sort((a, b) => a.localeCompare(b, 'zh'))
  return [...known, ...rest]
}

/** 下拉选项：车队里有车型就用车队的，一辆车都没录时退回基准表，免得表单直接没法用 */
export function typeOptions() {
  const t = fleetTypes()
  return t.length ? t : CAR_TYPES
}

/** 是不是退回用了基准表（界面据此提示「车辆管理里还没有车辆」） */
export const usingFallbackTypes = () => fleetTypes().length === 0
export const plateSet = () => new Set(vehicles.map((v) => v.plate))
export const isPlateTaken = (plate, exceptId) =>
  vehicles.some((v) => v.id !== exceptId && v.plate === normalizePlate(plate))

/* ---------------- 组装记录 ---------------- */
/**
 * 表单收 5 个字段，其余按车型给合理默认值，
 * 这样录入的车是一条完整记录，而不是缺胳膊少腿。
 * 车编号（code）由系统分配，前台不显示也不允许编辑。
 */
function buildRecord(form, base = {}) {
  // 车型是自由输入的，不再往枚举上拽；基准表里没有就按关键词或通用货车估算
  const type = normalizeCarType(form.type) || base.type || ''
  const changed = !!base.type && base.type !== type
  const d = typeDefaults(type)
  const price = Math.round(Number(form.price) || 0)
  const odo = Math.round(Number(form.odo) || 0)

  return {
    ...base,
    id: base.id || nextVehicleId(),
    code: base.code || assignCode(),
    plate: normalizePlate(form.plate),
    type,
    tonnage: Number(form.tonnage) || 0,
    price,
    // 折旧全靠它，所以必须有一条；缺了就按今天算（相当于新车）
    buyDate: form.buyDate || base.buyDate || toISO(TODAY),
    odo,
    model: changed ? `${type}（待补充车型）` : base.model || `${type}（待补充车型）`,
    // 换车型要把油耗基准与油箱一起换掉，否则会拿牵引车的油耗去套厢式货车。
    // 车型是自由输入的，基准表里没有的写法会按关键词或通用货车估算（typeDefaults）。
    normFuel: changed ? d.normFuel : base.normFuel || d.normFuel,
    tank: changed ? d.tank : base.tank || d.tank,
    fuelType: base.fuelType || '0# 柴油',
    status: base.status || 'idle',
    nextServiceOdo: base.nextServiceOdo || odo + 15000,
    manual: true,
  }
}

/* ---------------- 增删改 ---------------- */
export function addVehicle(form) {
  const rec = buildRecord(form)
  vehicles.unshift(rec)
  commit()
  return rec
}

export function updateVehicle(id, form) {
  const i = vehicles.findIndex((v) => v.id === id)
  if (i < 0) return null
  const next = buildRecord(form, { ...vehicles[i], id })
  Object.assign(vehicles[i], next)
  commit()
  return vehicles[i]
}

/* ---------------- 清空 ---------------- */
/** 清空全部车辆。
    界面上**没有**这个入口 —— 「清空全部」按钮按需求去掉了。
    保留这个函数只是给自检脚本重置状态用。 */
export function clearAll() {
  vehicles.splice(0, vehicles.length)
  commit()
}

export function removeVehicle(id) {
  const i = vehicles.findIndex((v) => v.id === id)
  if (i < 0) return false
  vehicles.splice(i, 1)
  commit()
  return true
}

/* ---------------- 批量导入 ----------------
   以车牌号为主键：相同车牌 → 替换（保留原 id 与车编号）；
   不同车牌 → 新增。没有「跳过」这种中间状态。 */
export function importVehicles(drafts) {
  const fresh = []
  let updated = 0
  const byPlate = new Map(vehicles.map((v) => [v.plate, v]))
  // 新记录要等循环结束才入数组，所以编号必须自己递增着分配 ——
  // 否则每一行都会基于「还没入库」的现有数据算出同一个编号。
  let seq = nextSeq()

  for (const d of drafts) {
    const form = d.draft || d
    const plate = normalizePlate(form.plate)
    if (!plate) continue

    const prev = byPlate.get(plate)
    if (prev) {
      // 替换：保留原 id 与车编号
      Object.assign(prev, buildRecord(form, { ...prev, id: prev.id }))
      updated++
    } else {
      const id = 'V' + String(seq++).padStart(2, '0')
      const rec = buildRecord(form, { id, code: id })
      byPlate.set(plate, rec)
      fresh.push(rec)
    }
  }

  if (fresh.length) vehicles.unshift(...fresh)
  commit()
  return { added: fresh.length, updated }
}

