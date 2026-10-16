/* ============================================================
   车辆字段定义与校验规则（唯一来源）
   ------------------------------------------------------------
   表单录入、Excel 导入、模板下载三处共用这一份定义，
   否则很容易出现「表单拦住了、导入却放进去了」的不一致。

   说明：车编号由系统自动分配，前台不显示也不校验，
   所以在 FIELDS 里没有它 —— 数据模型里仍然保留该字段。
   ============================================================ */
import { CAR_TYPES, typeDefaults, isEstimatedType } from '../data/vehicles.js'
import { parseDate, toISODate, monthsBetween } from './date.js'

/* ---------- 字段定义 ---------- */
/** 顺序即表单顺序、模板列顺序、导入匹配顺序 */
export const FIELDS = [
  {
    key: 'plate', label: '车牌号', required: true, type: 'text', placeholder: '类似3624AV05',
    unit: '', hint: '',
    aliases: ['车牌号', '车牌', '车牌号码', '号牌', 'plate'],
  },
  {
    key: 'type', label: '车类型', required: true, type: 'text', placeholder: '如 牵引车 / 皮卡',
    unit: '', hint: '自由填写；写成基准表里的车型油耗更准',
    aliases: ['车类型', '车辆类型', '类型', '车型', 'type'],
  },
  {
    key: 'tonnage', label: '载重', required: true, type: 'number', unit: '吨', placeholder: '0',
    step: 0.5, hint: '核定载质量',
    aliases: ['载重', '载重吨', '载质量', '核定载重', '吨位', 'tonnage'],
  },
  {
    key: 'price', label: '购置价格', required: true, type: 'number', unit: '元', placeholder: '0',
    step: 1000, hint: '含税落地价',
    aliases: ['购置价格', '购置价', '购买价格', '车价', '价格', 'price'],
  },
  {
    key: 'buyDate', label: '购置日期', required: true, type: 'date', placeholder: '2022-03-18',
    unit: '', hint: '按 8 年直线法计提折旧',
    aliases: ['购置日期', '购买日期', '购入日期', '购车日期', '购置时间', '上牌日期', 'buydate'],
  },
  {
    key: 'odo', label: '当前累计里程', required: true, type: 'number', unit: 'km', placeholder: '0',
    step: 1, hint: '用于推算下次保养',
    aliases: ['当前累计里程', '累计里程', '总里程', '行驶里程', '里程数', '里程', 'odo'],
  },
]
export const FIELD_MAP = Object.fromEntries(FIELDS.map((f) => [f.key, f]))

/* ---------- 车牌 ---------- */
/**
 * 中国大陆车牌正则。
 * **默认不启用** —— 车牌不一定是大陆格式（用户在国外），
 * 留着它是为了以后想开启「格式提醒」时随手能用。
 */
export const PLATE_RE = /^[\u4e00-\u9fa5][A-Z]·[A-Z0-9]{5,6}$/

/**
 * 车牌归一化：只做**不会改变含义**的处理 —— 去首尾空格、内部连续空格压成一个、转大写。
 *
 * 刻意**不**做这些事：去掉 `-` `.` `·` 等分隔符、或者在第二位后面插一个 `·`。
 * 那些都是「假定这是大陆车牌」的做法，遇到国外车牌会直接把数据改坏
 * （`B-MW 1234` 会被改成 `BM·W1234`）。
 * 代价是 `苏E8K215` 与 `苏E·8K215` 会被当成两个车牌 —— 以「不改坏数据」优先。
 */
export function normalizePlate(raw) {
  return String(raw ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase()
}

/* ---------- 数值 / 枚举归一化（Excel 里常带单位、千分位、全角字符） ---------- */
export function parseNumber(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN
  const s = String(v ?? '')
    .replace(/[\s,，_]/g, '')
    .replace(/[¥￥]/g, '')
    .replace(/(元|吨|km|KM|Km|公里|升|L|L\/100km)/g, '')
  if (s === '') return NaN
  const n = Number(s)
  return Number.isFinite(n) ? n : NaN
}

const TYPE_ALIAS = {
  厢式: '厢式货车', 箱式: '厢式货车', 货车: '厢式货车',
  冷藏: '冷藏车', 冷链: '冷藏车', 保温: '冷藏车',
  平板: '平板车', 高栏: '平板车', 栏板: '平板车',
  自卸: '自卸车', 泥头: '自卸车', 渣土: '自卸车',
  牵引: '牵引车', 半挂: '牵引车', 挂车: '牵引车', 货柜: '牵引车', 集卡: '牵引车',
}

export function normalizeCarType(v) {
  const s = String(v ?? '').trim()
  if (!s) return ''
  if (CAR_TYPES.includes(s)) return s
  const direct = CAR_TYPES.find((t) => s.includes(t))
  if (direct) return direct
  for (const k of Object.keys(TYPE_ALIAS)) if (s.includes(k)) return TYPE_ALIAS[k]
  return s
}

/* ---------- 校验 ---------- */
/** 车龄超过这个年限就提醒（货运车辆通常 10~15 年报废） */
const AGE_WARN_YEARS = 12

/**
 * @param form  { plate, type, tonnage, price, buyDate, odo }（数值/日期字段可为字符串）
 * @param ctx   { plateTaken?(plate), today? }
 * @returns     { errors, warnings, ok }
 */
export function validateVehicle(form, ctx = {}) {
  const errors = {}
  const warnings = {}
  const today = ctx.today || new Date()

  // 车牌号：只要求填了、且不与已有重复。
  // 不做任何格式限制 —— 车牌不一定是中国大陆格式，长度/字符集都不该被假定。
  const plateRaw = String(form.plate ?? '').trim()
  const plate = normalizePlate(plateRaw)
  if (!plateRaw) errors.plate = '请填写车牌号'
  else if (ctx.plateTaken && ctx.plateTaken(plate)) errors.plate = '这个车牌已经录入过了'

  // 车类型：**自由输入**，不限定在枚举里；
  // 认不出油耗基准时只给软提示，因为油耗可以按通用货车估算
  const type = normalizeCarType(form.type)
  if (!type) errors.type = '请填写车类型'
  else if (type.length > 20) errors.type = '车类型不超过 20 个字'
  else if (isEstimatedType(type)) {
    warnings.type = '这个车型不在油耗基准表里，油耗基准会按通用中型货车估算（约 25 L/100km）'
  }

  // 载重
  const tonnage = parseNumber(form.tonnage)
  if (String(form.tonnage ?? '').trim() === '') errors.tonnage = '请填写载重'
  else if (Number.isNaN(tonnage)) errors.tonnage = '载重必须是数字'
  else if (tonnage <= 0) errors.tonnage = '载重必须大于 0'
  else {
    const range = typeDefaults(type).tonnage
    if (range && (tonnage < range[0] || tonnage > range[1])) {
      warnings.tonnage = `一般 ${type} 的载重在 ${range[0]}~${range[1]} 吨之间，请确认`
    }
  }

  // 购置价格
  const price = parseNumber(form.price)
  if (String(form.price ?? '').trim() === '') errors.price = '请填写购置价格'
  else if (Number.isNaN(price)) errors.price = '购置价格必须是数字'
  else if (price <= 0) errors.price = '购置价格必须大于 0'
  else if (price > 10000000) errors.price = '购置价格超过 1000 万，请确认是否填错'

  // 购置日期
  const rawDate = String(form.buyDate ?? '').trim()
  const buyDate = parseDate(form.buyDate)
  if (!rawDate) errors.buyDate = '请填写购置日期'
  else if (!buyDate) errors.buyDate = '日期格式不对，例如 2022-03-18'
  else if (buyDate.getTime() > today.getTime()) errors.buyDate = '购置日期不能晚于今天'
  else if (buyDate.getFullYear() < 1990) errors.buyDate = '购置日期太早，请确认是否填错'
  else {
    const age = monthsBetween(buyDate, today) / 12
    if (age > AGE_WARN_YEARS) {
      warnings.buyDate = `车龄已 ${age.toFixed(1)} 年，通常已提足折旧或接近报废年限`
    }
  }

  // 当前累计里程
  const odo = parseNumber(form.odo)
  if (String(form.odo ?? '').trim() === '') errors.odo = '请填写当前累计里程'
  else if (Number.isNaN(odo)) errors.odo = '累计里程必须是数字'
  else if (odo < 0) errors.odo = '累计里程不能为负'
  else if (odo > 3000000) errors.odo = '累计里程超过 300 万公里，请确认是否填错'

  return { errors, warnings, ok: Object.keys(errors).length === 0 }
}

/** 校验通过后，转成存入仓库的规范对象 */
export function toPayload(form) {
  return {
    plate: normalizePlate(form.plate),
    type: normalizeCarType(form.type),
    tonnage: parseNumber(form.tonnage),
    price: Math.round(parseNumber(form.price)),
    buyDate: toISODate(form.buyDate),
    odo: Math.round(parseNumber(form.odo)),
  }
}
