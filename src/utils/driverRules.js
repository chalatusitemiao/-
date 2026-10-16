/* ============================================================
   司机字段定义与校验规则（唯一来源）
   ------------------------------------------------------------
   字段分三类，这个分类本身就是需求：
     · 可上传   —— 姓名 / 手机号 / 入职日期 / 驾驶证号，表单能填、Excel 能导
     · 自动统计 —— 当月创收 / 当月总里程 / 当月总油耗电耗，
                   表单不能填、Excel 不能导，由运营流水汇总（见 store/driverOps.js）
     · 手动子记录 —— 事故 / 违章（发生时间 / 事件描述 / 经济损失），
                   只能一条条手工添加，不从表格导入
   表单录入、Excel 导入、模板下载、列头渲染都读这一份定义。
   ============================================================ */
import { parseDate, toISODate, monthsBetween } from './date.js'

/* ---------- 可上传字段 ---------- */
export const UPLOAD_FIELDS = [
  {
    key: 'name', label: '姓名', required: true, type: 'text', placeholder: 'Kokas',
    unit: '', hint: '与身份证一致',
    aliases: ['姓名', '司机姓名', '驾驶员姓名', '名字', 'name'],
  },
  {
    key: 'phone', label: '手机号', required: true, type: 'text', placeholder: '110',
    unit: '', hint: '作为司机的唯一标识，重复即视为同一人',
    aliases: ['手机号', '手机', '手机号码', '电话', '联系电话', '联系方式', 'phone', 'mobile', 'tel'],
  },
  {
    key: 'hireDate', label: '入职日期', required: true, type: 'date', placeholder: '2019-03-11',
    unit: '', hint: '用于计算工龄',
    aliases: ['入职日期', '入职时间', '到岗日期', '入职日', 'hiredate', 'joindate'],
  },
  {
    key: 'licenseNo', label: '驾驶证号', required: false, type: 'text', placeholder: '选填',
    unit: '', hint: '选填；中国大陆驾驶证号与身份证号一致（18 位）',
    aliases: ['驾驶证号', '驾驶证号码', '驾照号', '驾照号码', '证号', 'licenseno', 'license'],
  },
  {
    // 选填：批量导入历史司机名单时往往没有工资这一列，
    // 设成必填会让那些文件整份报错。要强制的话把 required 改成 true 即可。
    key: 'salary', label: '工资', required: false, type: 'number', unit: '元/月', placeholder: '选填',
    hint: '选填；月工资，用于统计人工成本',
    aliases: ['工资', '月工资', '薪资', '月薪', '基本工资', 'salary', 'wage'],
  },
]

/* ---------- 自动统计字段（不可填、不可导） ---------- */
export const STAT_FIELDS = [
  {
    key: 'monthlyRevenue', label: '当月创收', unit: '元', auto: true,
    desc: '由运营流水按司机汇总',
  },
  {
    key: 'totalMileage', label: '当月总里程', unit: 'km', auto: true,
    desc: '由运营流水按司机汇总',
  },
  {
    key: 'totalEnergy', label: '当月总油耗/电耗', unit: '', auto: true,
    desc: '燃油车按升、电动车按千瓦时',
  },
]

/** 列表与详情里展示的全部字段（含只读的统计列） */
export const DRIVER_FIELDS = [...UPLOAD_FIELDS, ...STAT_FIELDS]
export const FIELD_MAP = Object.fromEntries(DRIVER_FIELDS.map((f) => [f.key, f]))

/* ---------- 事故 / 违章（手动子记录） ---------- */
export const INCIDENT_FIELDS = [
  { key: 'date', label: '发生时间', required: true, type: 'date', placeholder: '2025-08-12' },
  { key: 'desc', label: '事件描述', required: true, type: 'text', placeholder: '填写事件描述' },
  { key: 'loss', label: '经济损失', required: true, type: 'number', unit: '元', placeholder: '0' },
]

/* ---------- 归一化 ---------- */
/**
 * 中国大陆手机号正则。
 * **默认不启用** —— 号码不一定是大陆格式（用户在国外），
 * 留着它是为了以后想开启「格式提醒」时随手能用。
 */
export const PHONE_RE = /^1[3-9]\d{9}$/

/**
 * 归一化只做**不会改变含义**的事：去首尾空格、内部连续空格压成一个。
 * 刻意不剥掉 `-` `()` 这类分隔符 —— 各国号码写法不同，剥了就是把数据改坏。
 */
const tidy = (v) => String(v ?? '').trim().replace(/\s+/g, ' ')

export const normalizePhone = (v) => tidy(v)
/** 驾驶证号：只去多余空格并统一大写，保留 `-` `.` 等原本的分隔符 */
export const normalizeLicenseNo = (v) => tidy(v).toUpperCase()
/**
 * 手机号显示：**只有确认是大陆号码**（11 位、1 开头）才分组念读，
 * 其他一律原样显示 —— 不能拿大陆格式去套国外号码。
 */
export function formatPhone(p) {
  const s = normalizePhone(p)
  const digits = s.replace(/\D/g, '')
  if (digits.length === 11 && digits === s && s[0] === '1') {
    return `${s.slice(0, 3)} ${s.slice(3, 7)} ${s.slice(7)}`
  }
  return s
}

/* ---------- 校验 ---------- */
/** 工龄超过这个年限就提醒（该核查续聘还是退休了） */
const TENURE_WARN_YEARS = 15

/**
 * @param form { name, phone, hireDate, licenseNo }
 * @param ctx  { phoneTaken?(phone), licenseTaken?(no), today? }
 */
export function validateDriver(form, ctx = {}) {
  const errors = {}
  const warnings = {}
  const today = ctx.today || new Date()

  // 姓名：只要求填了。
  // 不做字数、字符集限制 —— 单字名、带连字符或数字的名字在国外都可能是真的。
  const name = String(form.name ?? '').trim()
  if (!name) errors.name = '请填写姓名'

  // 手机号（主键）：只要求填了、且不与已有重复。
  // 不做格式校验 —— 号码不一定是 11 位大陆手机号。
  const phoneRaw = String(form.phone ?? '').trim()
  const phone = normalizePhone(phoneRaw)
  if (!phoneRaw) errors.phone = '请填写手机号'
  else if (ctx.phoneTaken && ctx.phoneTaken(phone)) errors.phone = '这个手机号已经录入过了'

  // 入职日期
  const hireRaw = String(form.hireDate ?? '').trim()
  const hireDate = parseDate(form.hireDate)
  if (!hireRaw) errors.hireDate = '请填写入职日期'
  else if (!hireDate) errors.hireDate = '日期格式不对，例如 2019-03-11'
  else if (hireDate.getTime() > today.getTime()) errors.hireDate = '入职日期不能晚于今天'
  else if (hireDate.getFullYear() < 1990) errors.hireDate = '入职日期太早，请确认是否填错'
  else {
    const years = monthsBetween(hireDate, today) / 12
    if (years > TENURE_WARN_YEARS) warnings.hireDate = `工龄已 ${years.toFixed(1)} 年，请确认是否需要更新`
  }

  // 驾驶证号：选填。不做长度/字符集限制（各国证号写法差得远），
  // 填了只查「有没有和别人重复」—— 一个证号不该挂在两个人名下。
  const licRaw = String(form.licenseNo ?? '').trim()
  const licenseNo = normalizeLicenseNo(licRaw)
  if (licRaw && ctx.licenseTaken && ctx.licenseTaken(licenseNo)) {
    errors.licenseNo = '这个驾驶证号已经录入过了'
  }

  // 工资（选填；填了要是合理数字）
  const rawSalary = String(form.salary ?? '').trim()
  if (rawSalary !== '') {
    const n = Number(rawSalary.replace(/[,\s¥￥元]/g, ''))
    if (!Number.isFinite(n)) errors.salary = '工资必须是数字'
    else if (n < 0) errors.salary = '工资不能为负'
    else if (n > 1000000) errors.salary = '工资超过 100 万/月，请确认是否填错'
    else if (n === 0) warnings.salary = '工资填了 0，请确认是不是漏填'
  }

  return { errors, warnings, ok: Object.keys(errors).length === 0 }
}

/** 校验通过后，转成存入仓库的规范对象 */
/** 工资：把「8,000 元」这类写法清成数字；留空返回 0 表示没填 */
export function parseSalary(v) {
  const raw = String(v ?? '').trim()
  if (raw === '') return 0
  const n = Number(raw.replace(/[,\s¥￥元]/g, ''))
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0
}

export function toDriverPayload(form) {
  return {
    name: String(form.name ?? '').trim(),
    phone: normalizePhone(form.phone),
    hireDate: toISODate(form.hireDate),
    licenseNo: normalizeLicenseNo(form.licenseNo),
    salary: parseSalary(form.salary),
  }
}

/* ---------- 事故 / 违章 ---------- */
/**
 * @param inc { date, desc, loss }
 * @param ctx { today? }
 */
export function validateIncident(inc, ctx = {}) {
  const errors = {}
  const today = ctx.today || new Date()

  const date = parseDate(inc.date)
  if (!inc.date) errors.date = '请选择发生时间'
  else if (!date) errors.date = '日期格式不对，例如 2025-08-12'
  else if (date.getTime() > today.getTime()) errors.date = '发生时间不能晚于今天'

  const desc = String(inc.desc ?? '').trim()
  if (!desc) errors.desc = '请填写事件描述'
  else if (desc.length < 2) errors.desc = '事件描述太短'
  else if (desc.length > 200) errors.desc = '事件描述不超过 200 字'

  const loss = inc.loss === '' || inc.loss === null || inc.loss === undefined ? NaN : Number(inc.loss)
  if (Number.isNaN(loss)) errors.loss = '请填写经济损失（没有损失填 0）'
  else if (loss < 0) errors.loss = '经济损失不能为负'
  else if (loss > 10000000) errors.loss = '经济损失超过 1000 万，请确认是否填错'

  return { errors, ok: Object.keys(errors).length === 0 }
}

export function toIncidentPayload(inc) {
  return {
    date: toISODate(inc.date),
    desc: String(inc.desc ?? '').trim(),
    loss: Math.round(Number(inc.loss) || 0),
  }
}
