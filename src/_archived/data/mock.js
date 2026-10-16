/* ============================================================
   模拟数据层（纯前端，无后端）
   ------------------------------------------------------------
   设计要点：
   1. 固定种子的伪随机数 —— 任何设备、任何次刷新生成的数据完全一致，
      演示时数字不会乱跳。
   2. 数据结构刻意分层，保证“明细相加 = 报表合计”天然成立：
        · DAILY   车辆每日「变动成本」流水（油/路/司机提成/维保）+ 当日收入
        · FIXED   车辆「月度固定成本」（保险/折旧/车贷/停车/管理）
        · DRIVERS 司机「月度固定工资」（基本+社保+全勤）
      固定成本与司机底薪按「日历天数」计提，与车辆当天是否出车无关，
      这才是真实口径；变动成本才挂在出车日上。
   3. 收入按「里程 × 线路运价」计算，不与该车实际成本挂钩 ——
      于是油耗高、驾驶习惯差的车/司机毛利自然被吃掉，
      “单车成本排行 / 亏本车”才有真实意义。
      运价表已用 scripts/check-data.mjs 校准到全车队毛利率约 13%~15%。
   ============================================================ */

/* ---------- 确定性随机 ---------- */
function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length) % arr.length]
const between = (rng, min, max) => min + rng() * (max - min)
const round2 = (n) => Math.round(n * 100) / 100
const round1 = (n) => Math.round(n * 10) / 10

/* ---------- 成本科目（全局唯一来源：图表 / 图例 / 列表共用） ---------- */
export const CATS = [
  { key: 'fuel', name: '油耗', short: '油', color: '#f59e0b', icon: 'fuel', desc: '柴油 / 尿素' },
  { key: 'toll', name: '过路费', short: '路', color: '#06b6d4', icon: 'toll', desc: '高速通行费' },
  { key: 'driver', name: '司机成本', short: '司', color: '#6366f1', icon: 'driver', desc: '底薪 / 提成 / 社保' },
  { key: 'fixed', name: '固定成本', short: '固', color: '#8b5cf6', icon: 'fixed', desc: '保险 / 折旧 / 车贷' },
  { key: 'maint', name: '维保其他', short: '维', color: '#f43f5e', icon: 'maint', desc: '保养 / 轮胎 / 耗材' },
]
export const CAT_MAP = Object.fromEntries(CATS.map((c) => [c.key, c]))
export const catColor = (k) => (CAT_MAP[k] ? CAT_MAP[k].color : '#94a3b8')
export const catName = (k) => (CAT_MAP[k] ? CAT_MAP[k].name : k)

/* ---------- 车辆类型（录入表单的下拉选项） ---------- */
export const CAR_TYPES = ['牵引车', '厢式货车', '冷藏车', '平板车', '自卸车']
/** 各类型的常见载重区间（吨），仅用于表单软提示，不阻塞提交 */
export const CAR_TYPE_TONNAGE = {
  牵引车: [20, 40],
  厢式货车: [2, 20],
  冷藏车: [3, 20],
  平板车: [5, 30],
  自卸车: [10, 40],
}

export const STATUS = {
  run: { key: 'run', name: '在途', pill: 'pill--run', color: '#2fe3c4' },
  idle: { key: 'idle', name: '空闲', pill: 'pill--idle', color: '#94a3ac' },
  fix: { key: 'fix', name: '维保', pill: 'pill--fix', color: '#ffb020' },
  ready: { key: 'ready', name: '待发', pill: 'pill--info', color: '#6e9bff' },
}

/* ---------- 时间基准 ---------- */
const _now = new Date()
export const TODAY = new Date(_now.getFullYear(), _now.getMonth(), _now.getDate())
export const DAY_MS = 86400000
export const DAYS_BACK = 400

export const dayKey = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
export const ymKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
export const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
export const daysInMonth = (ym) => {
  const [y, m] = ym.split('-').map(Number)
  return new Date(y, m, 0).getDate()
}
/** 两个日期之间的天数（含首尾） */
export const spanDays = (a, b) => Math.round((b - a) / DAY_MS) + 1

/* ---------- 线路 ---------- */
export const ROUTES = [
  { id: 'R01', from: '苏州', to: '上海', km: 108, cargo: '普货', seg: '沪宁高速 G2' },
  { id: 'R02', from: '苏州', to: '杭州', km: 172, cargo: '电商件', seg: '苏嘉杭高速 G15W' },
  { id: 'R03', from: '上海', to: '南京', km: 303, cargo: '冷链', seg: '沪宁高速 G42' },
  { id: 'R04', from: '无锡', to: '合肥', km: 342, cargo: '普货', seg: '沪陕高速 G40' },
  { id: 'R05', from: '宁波', to: '温州', km: 288, cargo: '建材', seg: '甬台温高速 G15' },
  { id: 'R06', from: '苏州', to: '武汉', km: 735, cargo: '电商件', seg: '沪渝高速 G50' },
  { id: 'R07', from: '上海', to: '北京', km: 1213, cargo: '冷链', seg: '京沪高速 G2' },
  { id: 'R08', from: '南京', to: '郑州', km: 648, cargo: '普货', seg: '宁洛高速 G36' },
  { id: 'R09', from: '杭州', to: '福州', km: 602, cargo: '危化品', seg: '沈海高速 G15' },
  { id: 'R10', from: '苏州', to: '成都', km: 1786, cargo: '大件', seg: '沪蓉高速 G42' },
  { id: 'R11', from: '常州', to: '青岛', km: 588, cargo: '普货', seg: '沈海高速 G15' },
  { id: 'R12', from: '上海', to: '广州', km: 1442, cargo: '电商件', seg: '沪昆高速 G60' },
]
export const ROUTE_MAP = Object.fromEntries(ROUTES.map((r) => [r.id, r]))

/* ---------- 司机 ---------- */
const DRIVER_NAMES = [
  '张国强', '李建军', '王志远', '刘洪涛', '陈立新', '赵德海',
  '孙振华', '周建国', '吴永利', '郑海峰', '冯玉良', '韩明辉',
  '曹俊峰', '彭德文', '许志刚', '何春生', '邓伟民', '钱进宝',
  '马鸿飞', '唐少华', '秦立冬', '蒋卫东', '谢文斌', '罗广志',
]

function buildDrivers() {
  const rng = mulberry32(90210)
  return DRIVER_NAMES.map((name, i) => {
    const base = Math.round(between(rng, 4600, 7400) / 50) * 50
    return {
      id: 'D' + String(i + 1).padStart(2, '0'),
      name,
      phone: '1' + pick(rng, ['3', '5', '7', '8', '9']) + String(Math.floor(between(rng, 100000000, 999999999))),
      license: pick(rng, ['A2', 'A2', 'A2', 'B2']),
      licenseNo: '3205' + String(Math.floor(between(rng, 10000000, 99999999))),
      hireYm: `${2016 + Math.floor(rng() * 9)}-${String(1 + Math.floor(rng() * 12)).padStart(2, '0')}`,
      baseSalary: base,
      social: Math.round(base * between(rng, 0.24, 0.31)),
      bonus: Math.round(between(rng, 200, 600) / 50) * 50,
      /** 里程提成 元/公里 */
      commission: round2(between(rng, 0.36, 0.48)),
      /** 驾驶行为系数：>1 更费油，用于「油耗异常」预警 */
      fuelFactor: round2(between(rng, 0.93, 1.12)),
      safety: Math.round(between(rng, 72, 99)),
      years: Math.round(between(rng, 3, 16) * 10) / 10,
    }
  })
}
export const DRIVERS = buildDrivers()
export const DRIVER_MAP = Object.fromEntries(DRIVERS.map((d) => [d.id, d]))

/* ---------- 车辆 ---------- */
const PLATE_PREFIX = ['苏E', '苏E', '苏B', '苏A', '浙B', '皖A', '沪D']
const PLATE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
const MODELS = [
  { model: '解放 J6P 领航版', type: '牵引车', norm: 33.5, price: 445000 },
  { model: '东风天龙 KL', type: '牵引车', norm: 32.8, price: 428000 },
  { model: '重汽豪沃 T7H', type: '牵引车', norm: 34.6, price: 462000 },
  { model: '陕汽德龙 X3000', type: '牵引车', norm: 33.2, price: 415000 },
  { model: '福田欧曼 EST', type: '厢式货车', norm: 22.4, price: 286000 },
  { model: '江淮格尔发 K7', type: '厢式货车', norm: 23.6, price: 268000 },
  { model: '解放 J6L 冷藏', type: '冷藏车', norm: 28.5, price: 392000 },
  { model: '东风天锦 KR', type: '平板车', norm: 25.1, price: 235000 },
]
const GPS_POOL = ['G2 无锡东', 'G60 嘉兴服务区', 'G15 宁波北', 'G42 南京东', '苏州相城站', 'G50 湖州', '上海青浦站']

function buildVehicles() {
  const rng = mulberry32(77123)
  const list = []
  for (let i = 0; i < 20; i++) {
    const m = MODELS[i % MODELS.length]
    const plate = PLATE_PREFIX[i % PLATE_PREFIX.length] + '·' + pick(rng, PLATE_CHARS) + String(Math.floor(between(rng, 10000, 99999)))
    const buyYear = 2018 + Math.floor(rng() * 7)
    const age = round1(Math.max(0.5, TODAY.getFullYear() - buyYear + (TODAY.getMonth() + 1) / 12))
    list.push({
      id: 'V' + String(i + 1).padStart(2, '0'),
      plate,
      model: m.model,
      type: m.type,
      price: Math.round((m.price * between(rng, 0.88, 1.08)) / 1000) * 1000,
      // 老车发动机效率衰减：每多一年车龄，百公里油耗高约 0.9%。
      // 这条链路让「车龄 → 油耗 → 毛利」在演示里真的成立，
      // 报表里也就自然出现毛利被吃掉的车，而不是所有车一个样。
      normFuel: round1(m.norm * between(rng, 0.97, 1.03) * (1 + 0.009 * age)),
      tank: m.type === '厢式货车' ? 300 : 600,
      buyYear,
      age,
      odo: Math.round(between(rng, 120000, 620000)),
      tonnage: m.type === '厢式货车' ? 10 : m.type === '冷藏车' ? 15 : 32,
      fuelType: '0# 柴油',
      driverId: 'D' + String((i % 24) + 1).padStart(2, '0'),
      // 长途干线（沪京 / 沪穗 / 苏蓉）配双驾，第 21~24 位司机做副驾。
      // 这样 24 位司机的工资全部能归属到具体车辆，报表之间不会对不上账。
      coDriverId: i < 4 ? 'D' + String(21 + i).padStart(2, '0') : null,
      status: 'idle',
      gps: pick(rng, GPS_POOL),
      nextServiceOdo: 0,
      monthKm: 0,
      monthCost: 0,
    })
  }
  // 车队状态分布（确定性洗牌）
  const srng = mulberry32(4242)
  const pool = ['run', 'run', 'run', 'run', 'run', 'run', 'run', 'run', 'idle', 'idle', 'idle', 'idle', 'idle', 'idle', 'idle', 'idle', 'fix', 'fix', 'ready', 'ready']
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(srng() * (i + 1))
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }
  list.forEach((v, i) => (v.status = pool[i]))
  return list
}
export const VEHICLES = buildVehicles()
export const VEHICLE_MAP = Object.fromEntries(VEHICLES.map((v) => [v.id, v]))

/* ---------- 宏观季节 / 价格指数 ---------- */
const SEASON = [0.88, 0.76, 0.97, 1.03, 1.02, 1.07, 1.0, 0.98, 1.05, 1.12, 1.15, 1.03]
const PRICE_IDX = [1.03, 0.92, 0.98, 1.01, 1.0, 1.03, 0.99, 0.97, 1.04, 1.1, 1.13, 1.06]
const DIESEL = [7.28, 7.46, 7.62, 7.71, 7.58, 7.44, 7.36, 7.41, 7.55, 7.68, 7.72, 7.6]
/** 线路运价 元/公里（已用 scripts/check-data.mjs 校准到全车队毛利率 ~14%） */
const RATE = { 普货: 6.3, 电商件: 7.1, 冷链: 8.7, 建材: 5.8, 危化品: 9.8, 大件: 8.35 }
/** 运价的距离折扣：短途单价高、长途单价低 */
const distFactor = (km) =>
  km > 1200 ? 0.86 : km > 700 ? 0.93 : km > 350 ? 1.0 : km > 180 ? 1.06 : 1.14
/** 长途按“日均里程”折算：视距一趟需要几天 */
const tripDays = (km) => (km <= 420 ? 1 : Math.ceil(km / 620))
/** 不同货物的高速占比与装卸等待 */
const CARGO_TRAIT = {
  普货: { tollShare: 0.82 },
  电商件: { tollShare: 0.88 },
  冷链: { tollShare: 0.9 },
  建材: { tollShare: 0.66 },
  危化品: { tollShare: 0.86 },
  大件: { tollShare: 0.72 },
}

/* ---------- 月度固定成本（按车） ---------- */
function buildFixed(months) {
  const rng = mulberry32(556677)
  const map = {}
  const perVehicle = {}
  VEHICLES.forEach((v) => {
    perVehicle[v.id] = {
      insurance: Math.round(between(rng, 1650, 2560)),
      // 折旧：车价 90% 分 8 年摊
      depreciation: Math.round(((v.price * 0.9) / 8 / 12) * between(rng, 0.94, 1.06)),
      loan: rng() < 0.45 ? Math.round(between(rng, 1150, 2050)) : 0,
      parking: Math.round(between(rng, 260, 520)),
      manage: Math.round(between(rng, 200, 340)),
    }
  })
  months.forEach((ym) => {
    VEHICLES.forEach((v) => {
      const b = perVehicle[v.id]
      const row = { ym, v: v.id, ...b }
      row.total = b.insurance + b.depreciation + b.loan + b.parking + b.manage
      map[ym + '|' + v.id] = row
    })
  })
  return { map, perVehicle }
}

const FIXED_MONTHS = (() => {
  const out = []
  for (let i = 0; i <= 13; i++) out.push(ymKey(new Date(TODAY.getFullYear(), TODAY.getMonth() - i, 1)))
  return out.sort()
})()
const _fixed = buildFixed(FIXED_MONTHS)
export const FIXED_MAP = _fixed.map
export const FIXED_PER_VEHICLE = _fixed.perVehicle

/** 某车某月的固定成本合计 */
export const fixedMonthlyTotal = (ym, v) => (FIXED_MAP[ym + '|' + v] ? FIXED_MAP[ym + '|' + v].total : 0)
/** 某司机某月的底薪 + 社保 + 奖金 */
export const driverMonthlyTotal = (d) => (d ? d.baseSalary + d.social + d.bonus : 0)

/* ---------- 每日运营流水（仅变动成本） ---------- */
function buildDaily() {
  const rng = mulberry32(20240617)
  const rows = []
  const monthsSet = new Set()
  const odoTrack = {}
  // 400 天前 ≈ 今天里程 - 约 11 万公里，保证「保养里程阈值」在时间轴上会被跨过
  VEHICLES.forEach((v) => {
    odoTrack[v.id] = Math.max(3000, v.odo - Math.round(between(rng, 90000, 130000)))
    v.nextServiceOdo = odoTrack[v.id] + Math.round(between(rng, 2000, 16000))
  })

  for (let i = DAYS_BACK; i >= 0; i--) {
    const date = addDays(TODAY, -i)
    const ym = ymKey(date)
    monthsSet.add(ym)
    const mIdx = date.getMonth()
    const dowF = [0.74, 1.0, 1.03, 1.01, 1.0, 1.05, 0.86][date.getDay()]
    const dayFactor = SEASON[mIdx] * dowF
    const diesel = DIESEL[mIdx]
    const priceIdx = PRICE_IDX[mIdx]
    const tempF = 1 + 0.055 * Math.cos(((mIdx - 0.5) / 12) * Math.PI * 2) // 冬季油耗偏高

    for (const v of VEHICLES) {
      let p = 0.82 * dayFactor
      if (v.status === 'fix') p *= 0.55
      if (rng() > p) continue

      const dr = DRIVER_MAP[v.driverId]
      const r = pick(rng, ROUTES)
      const trait = CARGO_TRAIT[r.cargo]

      // —— 当日行驶里程 ——
      // 短途一天多趟；中途 1~2 趟；长途（>420km）按“这一趟要跑几天”折算日均里程，
      // 否则会出现“苏州—成都 1786 公里当天跑完”，车队日均里程会虚高到 700+。
      const days = tripDays(r.km)
      const trips = days > 1 ? 1 : r.km <= 180 ? 2 + Math.floor(rng() * 3) : r.km <= 420 ? 1 + Math.floor(rng() * 2) : 1
      const legKm = r.km / days
      const emptyRate = r.km > 700 ? between(rng, 0.06, 0.28) : between(rng, 0.02, 0.16)
      const km = Math.round(legKm * trips * between(rng, 0.94, 1.04) * (1 + emptyRate))

      // 油耗
      const reefer = v.type === '冷藏车' ? 2.6 : 0 // 冷机额外油耗
      const liters = round1((km * (v.normFuel + reefer)) / 100 * dr.fuelFactor * tempF * between(rng, 0.97, 1.03))
      const fuel = Math.round(liters * diesel * between(rng, 0.975, 1.025))

      // 过路费（6 轴货车高速费率约 2.0~2.25 元/公里）
      const toll = Math.round(km * trait.tollShare * between(rng, 2.02, 2.24) * between(rng, 0.97, 1.03))

      // 司机当日：里程提成 + 出车补贴（双驾按 6:4 分给主副驾，合计不变）
      const commission = Math.round(km * dr.commission)
      const allowance = Math.round(between(rng, 60, 120) + (r.km > 700 ? between(rng, 80, 160) : 0))
      const gross = commission + allowance
      let driver = gross
      let driver2 = 0
      if (v.coDriverId) {
        const c2 = Math.round(commission * 0.4)
        const a2 = Math.round(allowance * 0.5)
        driver2 = c2 + a2
        driver = gross - driver2
      }

      // 维保：耗材按里程摊销；到保养里程触发工单。
      // 老车故障率与单次工单金额都更高（车龄系数）。
      const aging = 1 + v.age / 10
      const cons = Math.round(km * between(rng, 0.04, 0.07) * aging)
      let svc = 0
      odoTrack[v.id] += km
      if (odoTrack[v.id] >= v.nextServiceOdo) {
        svc = Math.round((between(rng, 1250, 3200) * aging) / 10) * 10
        v.nextServiceOdo += 15000
      } else if (rng() < 0.012 * aging) {
        svc = Math.round((between(rng, 380, 2600) * aging) / 10) * 10
      }
      const maint = cons + svc

      // 收入 = 里程 × 线路运价 × 距离折扣（运价由市场决定，与本公司成本无关，
      // 所以油耗高 / 驾驶习惯差的车毛利会被自然吃掉）
      let rev = km * RATE[r.cargo] * distFactor(r.km) * priceIdx * between(rng, 0.94, 1.06)
      if (rng() < 0.07) rev *= between(rng, 0.62, 0.82) // 低价抢单 / 空放，真实亏损
      const revenue = Math.round(rev)

      const varc = fuel + toll + driver + maint
      rows.push({
        d: dayKey(date), ts: date.getTime(), ym, v: v.id, dr: v.driverId, r: r.id,
        dr2: v.coDriverId || null,
        km, trips, liters,
        rev: revenue,
        fuel, toll, driver, driver2, maint, svc, cons,
        var: varc,
      })
    }
  }

  // 回写累计里程，保证「里程 / 保养提醒」与流水一致
  VEHICLES.forEach((v) => {
    v.odo = odoTrack[v.id]
    v.nextServiceOdo = Math.max(v.nextServiceOdo, v.odo + 500)
  })

  rows.sort((a, b) => a.ts - b.ts)
  return { rows, months: [...monthsSet].sort() }
}

const _daily = buildDaily()
/** 车辆每日运营流水（升序、仅变动成本） */
export const DAILY = _daily.rows
/** 有数据的月份（升序） */
export const MONTHS = _daily.months
/** 全量日期的 ts 数组，供二分查找定位区间 */
export const DAILY_TS = DAILY.map((r) => r.ts)

/* ---------- 明细派生素材 ---------- */
export const STATIONS = [
  '中石化 苏州相城加油站', '中石油 无锡东服务区', '壳牌 上海青浦站', '中石化 南京江宁站',
  '中石油 杭州萧山站', '中石化 宁波北仑站', '中海油 合肥包河站', '中石化 常州武进站',
]
export const TOLL_GATES = ['苏州新区', '花桥主线', '无锡东', '南京东', '嘉兴枢纽', '宁波北', '湖州南', '郑州南']
export const MAINT_ITEMS = [
  { n: '机油三滤保养', min: 1180, max: 1680 },
  { n: '更换前桥轮胎 ×2', min: 2400, max: 3200 },
  { n: '刹车片更换', min: 860, max: 1450 },
  { n: '尿素 / 防冻液补充', min: 180, max: 460 },
  { n: '变速箱油更换', min: 1500, max: 2400 },
  { n: '空调系统检修', min: 380, max: 900 },
  { n: '年检 / 二级维护', min: 620, max: 1100 },
]

/** 派生：加油明细
 *  真实的 600L 大油箱大约每 1800km 加一次油，所以按「车 + 4 天」聚合成一次加油，
 *  而不是每天一条。聚合只做加法，明细合计与报表合计仍然严格一致。 */
export function fuelEntries(rows) {
  const buckets = new Map()
  const order = []
  rows.forEach((r) => {
    if (!(r.liters > 0) || !(r.fuel > 0)) return
    const key = r.v + '|' + Math.floor(Math.floor(r.ts / DAY_MS) / 4)
    let b = buckets.get(key)
    if (!b) {
      b = { v: r.v, dr: r.dr, r: r.r, liters: 0, amount: 0, km: 0, ts: 0, date: r.d, fills: 0, seed: r.ts }
      buckets.set(key, b)
      order.push(b)
    }
    b.liters += r.liters
    b.amount += r.fuel
    b.km += r.km
    b.fills++
    if (r.ts >= b.ts) {
      b.ts = r.ts
      b.date = r.d
    }
  })
  return order
    .map((b, i) => {
      const rng = mulberry32(b.seed + i * 7717)
      return {
        id: 'F' + b.v + b.ts,
        date: b.date, ts: b.ts, vehicleId: b.v, driverId: b.dr, route: b.r,
        liters: round1(b.liters),
        price: round2(b.amount / b.liters),
        amount: Math.round(b.amount),
        station: pick(rng, STATIONS),
        km: b.km,
        per100: b.km > 0 ? round1((b.liters / b.km) * 100) : 0,
        fills: b.fills,
      }
    })
    .sort((a, b) => b.ts - a.ts)
}

/** 派生：过路费明细（1~2 段拆分，合计与原值严格一致） */
export function tollEntries(rows) {
  const out = []
  rows.forEach((r, i) => {
    const rng = mulberry32(r.ts + i * 3391)
    const two = r.toll > 300 && rng() < 0.55
    const base = { date: r.d, ts: r.ts, vehicleId: r.v, route: r.r, km: r.km }
    if (!two) {
      out.push({ id: 'T' + r.ts + r.v, ...base, amount: r.toll, gate: pick(rng, TOLL_GATES), etc: rng() < 0.86, invoiced: rng() < 0.72 })
    } else {
      const a = Math.round(r.toll * between(rng, 0.35, 0.62))
      out.push({ id: 'T' + r.ts + r.v + 'a', ...base, amount: a, gate: pick(rng, TOLL_GATES), etc: rng() < 0.9, invoiced: rng() < 0.75 })
      out.push({ id: 'T' + r.ts + r.v + 'b', ...base, amount: r.toll - a, gate: pick(rng, TOLL_GATES), etc: rng() < 0.9, invoiced: rng() < 0.7 })
    }
  })
  return out
}

/** 派生：维保明细（合计与原值严格一致） */
export function maintEntries(rows) {
  const out = []
  rows.forEach((r, i) => {
    if (r.cons > 0) {
      out.push({ id: 'M' + r.ts + r.v, date: r.d, ts: r.ts, vehicleId: r.v, item: '轮胎 / 尿素 / 耗材摊销', amount: r.cons, kind: 'consumable' })
    }
    if (r.svc > 0) {
      const rng = mulberry32(r.ts + i * 991)
      out.push({ id: 'M' + r.ts + r.v + 'x', date: r.d, ts: r.ts, vehicleId: r.v, item: pick(rng, MAINT_ITEMS).n, amount: r.svc, kind: 'service' })
    }
  })
  return out
}

/** 固定成本明细（月度 × 车 × 科目） */
const FIXED_LABEL = { insurance: '车辆保险', depreciation: '车辆折旧', loan: '车贷月供', parking: '停车 / 场地', manage: '管理费 / 年检' }
export function fixedEntries(months, vehicleId) {
  const out = []
  months.forEach((ym) => {
    VEHICLES.forEach((v) => {
      if (vehicleId && v.id !== vehicleId) return
      const row = FIXED_MAP[ym + '|' + v.id]
      if (!row) return
      Object.keys(FIXED_LABEL).forEach((k) => {
        out.push({ id: 'X' + ym + v.id + k, ym, date: ym + '-01', vehicleId: v.id, item: FIXED_LABEL[k], amount: row[k], kind: k })
      })
    })
  })
  return out
}

/** 司机月度工资明细 */
export function driverSalaryEntries(months, driverId) {
  const out = []
  months.forEach((ym) => {
    DRIVERS.forEach((d) => {
      if (driverId && d.id !== driverId) return
      out.push({ id: 'W' + ym + d.id, ym, date: ym + '-01', driverId: d.id, item: '基本工资', amount: d.baseSalary, kind: 'base' })
      out.push({ id: 'W' + ym + d.id + 's', ym, date: ym + '-01', driverId: d.id, item: '社保公积金（单位）', amount: d.social, kind: 'social' })
      out.push({ id: 'W' + ym + d.id + 'b', ym, date: ym + '-01', driverId: d.id, item: '全勤 / 安全奖', amount: d.bonus, kind: 'bonus' })
    })
  })
  return out
}

/** 司机每日提成明细（双驾拆成两条，合计与流水一致） */
export function driverCommissionEntries(rows) {
  const out = []
  rows.forEach((r) => {
    out.push({
      id: 'C' + r.ts + r.v,
      date: r.d, ts: r.ts, driverId: r.dr, vehicleId: r.v, route: r.r,
      km: r.km,
      item: r.dr2 ? '里程提成 + 出车补贴（主驾）' : '里程提成 + 出车补贴',
      amount: r.driver,
    })
    if (r.dr2 && r.driver2) {
      out.push({
        id: 'C' + r.ts + r.v + 'b',
        date: r.d, ts: r.ts, driverId: r.dr2, vehicleId: r.v, route: r.r,
        km: r.km,
        item: '里程提成 + 出车补贴（副驾）',
        amount: r.driver2,
      })
    }
  })
  return out
}

export { round1, round2, between, pick, mulberry32 }
