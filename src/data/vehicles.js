/* ============================================================
   车辆模块 · 车型基准表
   ------------------------------------------------------------
   只放「规则」不放「数据」：档案数据一律由用户录入或 Excel 导入产生。
   已经归档的成本流水 / 线路模拟器在 src/_archived/，需要时再取回。

   ★ 油耗是「一条直线」而不是一个固定值 ★
    百公里油耗 = 空载油耗 + 每吨增量 × 实际载重
   因为油耗里只有滚动阻力那部分随总质量线性增长，风阻和怠速跟载重无关。
   皮卡多装 1 吨是增重 50%，牵引车多装 1 吨只增重 2.5%，所以斜率差好几倍。
   —— 这一点是「同车型不同司机公平比油耗」的前提，详见 utils/fuelModel.js
   ============================================================ */

const _now = new Date()
/** 今天（零点） */
export const TODAY = new Date(_now.getFullYear(), _now.getMonth(), _now.getDate())

/**
 * 车型基准表。加车型只改这张表，别处不用动。
 *   baseFuel   空载百公里油耗（L/100km）
 *   fuelPerTon 每多装 1 吨，百公里油耗增加多少（L/100km·t）
 *   tonnage    常见载重区间（吨），只用于表单软提示，不阻塞提交
 *   normTonnage 额定载重（吨），用来算「满载基准油耗」
 *   tank       默认油箱容量（L）
 */
export const VEHICLE_TYPES = [
  { type: '皮卡', baseFuel: 8.0, fuelPerTon: 1.10, tonnage: [0.5, 2], normTonnage: 1.0, tank: 80 },
  { type: '面包车', baseFuel: 9.0, fuelPerTon: 1.00, tonnage: [0.5, 3], normTonnage: 1.5, tank: 70 },
  { type: '轻卡', baseFuel: 12.0, fuelPerTon: 0.90, tonnage: [1, 5], normTonnage: 4, tank: 120 },
  { type: '厢式货车', baseFuel: 15.5, fuelPerTon: 0.85, tonnage: [2, 20], normTonnage: 8, tank: 300 },
  { type: '中卡', baseFuel: 17.0, fuelPerTon: 0.75, tonnage: [4, 15], normTonnage: 10, tank: 200 },
  { type: '冷藏车', baseFuel: 17.5, fuelPerTon: 0.90, tonnage: [3, 20], normTonnage: 12, tank: 600 },
  { type: '平板车', baseFuel: 20.0, fuelPerTon: 0.55, tonnage: [5, 30], normTonnage: 25, tank: 600 },
  { type: '自卸车', baseFuel: 24.0, fuelPerTon: 0.45, tonnage: [10, 40], normTonnage: 30, tank: 400 },
  { type: '牵引车', baseFuel: 26.0, fuelPerTon: 0.28, tonnage: [20, 40], normTonnage: 32, tank: 600 },
]

export const VEHICLE_TYPE_MAP = Object.fromEntries(VEHICLE_TYPES.map((t) => [t.type, t]))

/**
 * 兜底档位：车辆车型是**自由输入**的，遇到基准表里没有的写法，
 * 先按关键词往已知档位上靠（"皮卡车"→皮卡、"9米6冷藏"→冷藏车），
 * 实在认不出来才用这个通用中型货车估，并在界面上明确标注「估算」。
 */
export const GENERIC_PROFILE = {
  type: '通用车型', baseFuel: 18.0, fuelPerTon: 0.70,
  tonnage: [1, 30], normTonnage: 10, tank: 300,
}

/** 关键词 → 基准档位（顺序有意义：先匹配到的先用） */
const TYPE_KEYWORDS = [
  [/皮卡/, '皮卡'],
  [/面包|微面|厢客|商务车/, '面包车'],
  [/冷藏|冷链|保温|冷冻/, '冷藏车'],
  [/自卸|泥头|渣土|翻斗|工程车/, '自卸车'],
  [/牵引|半挂|集卡|拖头|货柜|集装箱/, '牵引车'],
  [/平板|栏板|高栏|低栏|爬梯/, '平板车'],
  [/轻卡|微卡|小卡|轻货/, '轻卡'],
  [/中卡|中货/, '中卡'],
  [/厢式|箱式|封闭|货厢|van/i, '厢式货车'],
]

/**
 * 取车型的油耗基准档位。
 *   matched: 'exact'   完全对得上基准表
 *            'keyword' 靠关键词归到某个已知档位
 *            'generic' 认不出来，用通用货车估（界面要提示）
 */
export function profileOf(type) {
  const name = String(type ?? '').trim()
  if (!name) return { ...GENERIC_PROFILE, matched: 'generic', matchedType: '' }
  const exact = VEHICLE_TYPE_MAP[name]
  if (exact) return { ...exact, matched: 'exact', matchedType: name }
  for (const [re, key] of TYPE_KEYWORDS) {
    if (re.test(name)) return { ...VEHICLE_TYPE_MAP[key], matched: 'keyword', matchedType: key }
  }
  return { ...GENERIC_PROFILE, matched: 'generic', matchedType: '' }
}

/** 这个车型名是不是基准表里原样存在的 */
export const isKnownType = (type) => profileOf(type).matched === 'exact'
/** 是不是只能按通用货车估算（界面上要提示用户） */
export const isEstimatedType = (type) => profileOf(type).matched === 'generic'

/** 车型的默认值（满载基准油耗 / 油箱 / 常见载重区间），自由输入也有值可用 */
export function typeDefaults(type) {
  const p = profileOf(type)
  return {
    profile: p,
    normFuel: Math.round((p.baseFuel + p.fuelPerTon * p.normTonnage) * 10) / 10,
    tank: p.tank,
    tonnage: p.tonnage,
    known: p.matched === 'exact',
  }
}

/* ---------- 从基准表派生的老接口（车辆模块一直在用） ---------- */
/** 车型名列表，顺序与基准表一致 */
export const CAR_TYPES = VEHICLE_TYPES.map((t) => t.type)

/** 各类型的常见载重区间（吨） */
export const CAR_TYPE_TONNAGE = Object.fromEntries(VEHICLE_TYPES.map((t) => [t.type, t.tonnage]))

/** 各类型的「满载基准」百公里油耗（L/100km）—— 额定载重下的参考值 */
export const CAR_TYPE_NORM_FUEL = Object.fromEntries(
  VEHICLE_TYPES.map((t) => [t.type, Math.round((t.baseFuel + t.fuelPerTon * t.normTonnage) * 10) / 10])
)

/** 各类型的默认油箱容量（L） */
export const CAR_TYPE_TANK = Object.fromEntries(VEHICLE_TYPES.map((t) => [t.type, t.tank]))

/* ---------- 车辆状态 ---------- */
export const STATUS = {
  run: { key: 'run', name: '在途', pill: 'pill--run' },
  idle: { key: 'idle', name: '空闲', pill: 'pill--idle' },
  fix: { key: 'fix', name: '维保', pill: 'pill--fix' },
  ready: { key: 'ready', name: '待发', pill: 'pill--info' },
}
export const STATUS_LIST = Object.values(STATUS)
