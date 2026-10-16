/* 纯逻辑测试（纯 Node，不需要 Vite）
   覆盖：表格解析器（读真实 .xlsx / .csv）、日期解析、折旧计提、字段归一化。
   用 scripts/fixtures 下由 openpyxl 生成的真实 Excel 文件，
   而不是手搓 XML —— 否则测的是「我以为 Excel 长什么样」。
   运行： node scripts/check-sheet.mjs                                        */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readSheet, parseCsv } from '../src/utils/sheet.js'
import { matchColumns, buildDrafts, summarizeDrafts, coerceRow, templateCsv } from '../src/utils/vehicleImport.js'
import { FIELDS, normalizePlate, validateVehicle, parseNumber, normalizeCarType, PLATE_RE } from '../src/utils/vehicleRules.js'
import { parseDate, toISODate, excelSerialToDate, monthsBetween } from '../src/utils/date.js'
import { monthlyDepreciationAt, monthEnd } from '../src/utils/depreciation.js'
import { validateCost, toCostPayload } from '../src/utils/costRules.js'
import { costSummary, costBreakdown, availableMonths, monthOf, inMonth } from '../src/utils/costModel.js'
import { isDateInput, openDatePicker } from '../src/utils/datePicker.js'
import {
  depreciation, monthlyDepreciation, netBookValue, ageYears, isFullyDepreciated,
  DEP_YEARS, RESIDUAL_RATE,
} from '../src/utils/depreciation.js'
import {
  UPLOAD_FIELDS as D_UPLOAD, STAT_FIELDS as D_STATS, INCIDENT_FIELDS as D_INCIDENT,
  validateDriver, validateIncident, normalizePhone, normalizeLicenseNo, formatPhone, parseSalary, toDriverPayload, PHONE_RE,
} from '../src/utils/driverRules.js'
import {
  matchColumns as matchDriverCols, buildDrafts as buildDriverDrafts,
  summarizeDrafts as summarizeDriverDrafts, coerceRow as coerceDriverRow,
  templateCsv as driverTemplateCsv,
} from '../src/utils/driverImport.js'
import { aggregateOps, monthKey, formatEnergy } from '../src/utils/driverStats.js'
import { TEST_VEHICLES, TEST_DRIVERS } from './seed.mjs'
import {
  VEHICLE_TYPES, CAR_TYPES, CAR_TYPE_NORM_FUEL, VEHICLE_TYPE_MAP,
  profileOf, isKnownType, isEstimatedType, typeDefaults,
} from '../src/data/vehicles.js'
import {
  fuelRate, idleFuelRate, normFuelRate, isSuspicious,
  fuelPerTon100km, fuelPer100km, tonHundredKm, aggregateTrips,
} from '../src/utils/fuelModel.js'
import {
  routeKey, routeOf, routeName, routeTollTotal, tollPrice, tollRange,
  validateRoute, validateToll, toRoutePayload, normPlace,
} from '../src/utils/routeRules.js'
import { validateTrip, toTripPayload, tripKeyFields, tripCost, TRIP_FIELDS } from '../src/utils/tripRules.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FIX = path.join(HERE, 'fixtures')

let pass = 0
let fail = 0

function eq(label, actual, expected) {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  if (a === b) {
    pass++
    console.log(`  ✓ ${label}`)
  } else {
    fail++
    console.log(`  ✗ ${label}\n      实际: ${a}\n      期望: ${b}`)
  }
}
function ok(label, cond, extra) {
  if (cond) {
    pass++
    console.log(`  ✓ ${label}`)
  } else {
    fail++
    console.log(`  ✗ ${label}${extra === undefined ? '' : '  → ' + extra}`)
  }
}
async function throws(label, fn, includes) {
  try {
    await fn()
    fail++
    console.log(`  ✗ ${label}（没有抛错）`)
  } catch (e) {
    if (!includes || String(e.message).includes(includes)) {
      pass++
      console.log(`  ✓ ${label}`)
    } else {
      fail++
      console.log(`  ✗ ${label}\n      错误信息: ${e.message}`)
    }
  }
}

async function asFile(name) {
  const buf = await fs.readFile(path.join(FIX, name))
  return {
    name,
    size: buf.byteLength,
    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    text: async () => buf.toString('utf8'),
  }
}

const PLATES = new Set(TEST_VEHICLES.map((v) => v.plate))
const opts = { existingPlates: PLATES }

/* 固定一个「今天」，让折旧断言与运行日期无关 */
const TODAY = new Date(2026, 9, 15) // 2026-10-15

console.log('\n=== 字段定义 ===')
eq('前台字段共 6 个', FIELDS.map((f) => f.key), ['plate', 'type', 'tonnage', 'price', 'buyDate', 'odo'])
ok('不再有车编号字段', !FIELDS.some((f) => f.key === 'code'))
ok('购置日期是必填', FIELDS.find((f) => f.key === 'buyDate').required === true)
ok('模板表头含购置日期', templateCsv().split('\r\n')[0].includes('购置日期'))
ok('模板表头不含车编号', !templateCsv().split('\r\n')[0].includes('车编号'))

console.log('\n=== 纯函数 ===')
eq('车牌只去空格转大写，不插分隔符', normalizePlate(' 苏e8k215 '), '苏E8K215')
eq('车牌里原有的分隔符保留', normalizePlate(' 苏e.8k215 '), '苏E.8K215')
eq('数值清洗 带单位千分位', parseNumber('¥418,000 元'), 418000)
eq('数值清洗 自身是数字', parseNumber(32.5), 32.5)
eq('数值清洗 空串', Number.isNaN(parseNumber('')), true)
eq('车型简写 半挂', normalizeCarType('半挂'), '牵引车')
eq('车型简写 厢式', normalizeCarType('厢式'), '厢式货车')
eq('车型简写 冷链', normalizeCarType('冷链'), '冷藏车')
eq('车型不认识就原样返回', normalizeCarType('飞船'), '飞船')

console.log('\n=== 日期解析 ===')
eq('2022-03-18', toISODate('2022-03-18'), '2022-03-18')
eq('2022/3/18', toISODate('2022/3/18'), '2022-03-18')
eq('2022.3.18', toISODate('2022.3.18'), '2022-03-18')
eq('2022年3月18日', toISODate('2022年3月18日'), '2022-03-18')
eq('20220318', toISODate('20220318'), '2022-03-18')
eq('只给年月 → 当月 1 号', toISODate('2022-03'), '2022-03-01')
eq('Date 对象', toISODate(new Date(2022, 2, 18)), '2022-03-18')
eq('非法日期 2023-02-30 不被自动进位', toISODate('2023-02-30'), '')
eq('乱写的文本 → 空', toISODate('不是日期'), '')
eq('空值 → 空', toISODate(''), '')
{
  // Excel 日期序列号：2022-03-18 在 Excel 里存的是 44638 这样的数字
  const serial = Math.round((Date.UTC(2022, 2, 18) - Date.UTC(1899, 11, 30)) / 86400000)
  eq('Excel 序列号还原成日期', toISODate(serial), '2022-03-18')
  eq('序列号还原（直接调 excelSerialToDate）', toISODate(excelSerialToDate(serial)), '2022-03-18')
  eq('明显不是日期的数字被拒', toISODate(12), '')
}
eq('整月数计算（2022-03-18 → 2026-10-15）', monthsBetween(new Date(2022, 2, 18), TODAY), 54)

console.log('\n=== 折旧计提（5 年 / 残值 10%）===')
eq('折旧年限是 5 年', DEP_YEARS, 5)
eq('残值率 10%', RESIDUAL_RATE, 0.1)
eq('月折旧 = 418000×90%÷5÷12', monthlyDepreciation(418000), 6270)
eq('年折旧 = 月折旧×12', monthlyDepreciation(418000) * 12, 75240)
eq('价格为 0 时月折旧为 0', monthlyDepreciation(0), 0)
{
  const d = depreciation(418000, '2022-03-18', TODAY)
  eq('已使用月数', d.monthsUsed, 54)
  eq('车龄（年）', d.ageYears, 4.5)
  eq('月折旧', d.monthly, 6270)
  eq('当前净值', d.netBookValue, 418000 - 6270 * 54)
  eq('累计折旧', d.accumulated, 6270 * 54)
  eq('未提足', d.fully, false)

  // 提满 5 年：净值停在残值上，不再继续计提
  const full = depreciation(418000, '2019-01-01', TODAY)
  eq('满 5 年标记为已提足', full.fully, true)
  eq('提足后净值 = 残值', full.netBookValue, Math.round(418000 * 0.1))
  const older = depreciation(418000, '2015-01-01', TODAY)
  eq('提足更久净值仍是残值', older.netBookValue, Math.round(418000 * 0.1))
  ok('提足更久累计折旧不再增长', older.accumulated === full.accumulated)

  const a = netBookValue(400000, '2024-01-01', TODAY)
  const b = netBookValue(400000, '2020-01-01', TODAY)
  ok('越老的车净值越低', b < a, `${b} < ${a}`)

  eq('车龄换算', ageYears('2021-10-15', TODAY), 5)
  eq('已提足判断', isFullyDepreciated('2021-01-01', TODAY), true)
  eq('未提足判断', isFullyDepreciated('2024-01-01', TODAY), false)
}

console.log('\n=== CSV 解析 ===')
eq('引号里的逗号不当分隔符', parseCsv('a,b\n"x,1",2')[1], ['x,1', '2'])
eq('双引号转义', parseCsv('a\n"he said ""hi"""')[1], ['he said "hi"'])
eq('CRLF 换行', parseCsv('a,b\r\n1,2\r\n').length, 2)
eq('制表符分隔', parseCsv('a\tb\n1\t2')[1], ['1', '2'])
eq('分号分隔', parseCsv('a;b\n1;2')[1], ['1', '2'])
eq('BOM 被去掉', parseCsv('\ufeffa,b\n1,2')[0], ['a', 'b'])

console.log('\n=== 标准模板 std.xlsx ===')
{
  const { rows, source } = await readSheet(await asFile('std.xlsx'))
  eq('识别为 xlsx', source, 'xlsx')
  eq('总行数（含表头）', rows.length, 5)
  eq('表头读对了', rows[0], ['车牌号', '车类型', '载重(吨)', '购置价格(元)', '购置日期', '当前累计里程(km)'])
  eq('数字被读成 number 而不是字符串', typeof rows[1][2], 'number')

  const { mapping, missing } = matchColumns(rows[0])
  eq('6 个字段全部匹配上', Object.keys(mapping).length, 6)
  eq('没有缺失的必填字段', missing, [])

  // Excel 的日期单元格读出来是序列号数字，必须被还原成日期
  eq('日期列原始值是数字（Excel 序列号）', typeof rows[1][4], 'number')
  eq('coerceRow 把序列号还原成日期', coerceRow(rows[1], mapping).buyDate, '2022-03-18')

  const s = summarizeDrafts(buildDrafts(rows, mapping, opts))
  eq('4 行全部可新增', s, { add: 4, update: 0, error: 0, total: 4 })
}

console.log('\n=== 脏数据 messy.xlsx ===')
{
  const { rows } = await readSheet(await asFile('messy.xlsx'))
  const { mapping, missing } = matchColumns(rows[0])
  eq('别名表头全部识别（含「购买日期」）', missing, [])
  eq(
    '列映射位置',
    [mapping.type, mapping.plate, mapping.tonnage, mapping.price, mapping.buyDate, mapping.odo],
    [0, 1, 2, 3, 4, 5]
  )

  const drafts = buildDrafts(rows, mapping, opts)
  const s = summarizeDrafts(drafts)
  eq('空行被跳过，得到 7 条草稿', s.total, 7)
  // 第 2 行的「沪D·N78520」正好是演示车 V07 的车牌 → 车牌是主键，所以判为「替换」
  eq('统计：新增 2 / 替换 1 / 报错 4', [s.add, s.update, s.error], [2, 1, 4])

  const d1 = drafts[0]
  eq('第 1 行：车牌原样保留（只去空格转大写）', d1.draft.plate, '苏E8K215')
  eq('第 1 行：半挂 → 牵引车', d1.draft.type, '牵引车')
  eq('第 1 行：带单位载重 → 32', d1.draft.tonnage, 32)
  eq('第 1 行：带符号价格 → 418000', d1.draft.price, 418000)
  eq('第 1 行：文本日期 → 2022-03-18', d1.draft.buyDate, '2022-03-18')
  eq('第 1 行：带单位里程 → 386000', d1.draft.odo, 386000)
  eq('第 1 行：可新增', d1.action, 'add')

  eq('第 2 行：Excel 真日期被还原', drafts[1].draft.buyDate, '2020-11-03')
  eq('第 2 行：车牌已存在 → 替换（没有跳过这种中间状态）', drafts[1].action, 'update')

  eq('第 3 行：车牌位数不足 → 报错', drafts[2].action, 'error')
  ok('第 3 行：错误定位到车牌字段', !!drafts[2].errors.plate)
  eq('第 4 行：文件内车牌重复 → 报错', drafts[3].action, 'error')
  ok('第 4 行：提示「前面的行已经用过」', String(drafts[3].errors.plate).includes('前面'))
  eq('第 5 行：车型不在基准表里 → 仍然可以导入（车型是自由输入）', drafts[4].action, 'add')
  ok('第 5 行：但会带一条油耗基准的软提示', !!drafts[4].warnings.type)
  eq('第 6 行：日期解析不了 → 报错', drafts[5].action, 'error')
  ok('第 6 行：错误定位到购置日期', !!drafts[5].errors.buyDate)
  eq('第 7 行：日期在未来 → 报错', drafts[6].action, 'error')
  ok('第 7 行：提示不能晚于今天', String(drafts[6].errors.buyDate).includes('不能晚于'))
}

console.log('\n=== 其他形态 ===')
{
  const { rows } = await readSheet(await asFile('plain.xlsx'))
  eq('普通 xlsx 一行数据', rows.length, 2)

  const empty = await readSheet(await asFile('empty.xlsx'))
  eq('只有表头的文件读出来 1 行', empty.rows.length, 1)

  const multi = await readSheet(await asFile('multi.xlsx'))
  const mm = matchColumns(multi.rows[0])
  eq('多工作表：读的是第一张表（说明页），因此必填字段全部缺失', mm.missing.length, 6)

  const csv = await readSheet(await asFile('std.csv'))
  eq('CSV 识别', csv.source, 'csv')
  eq('CSV 三行数据', csv.rows.length, 4)
  const cm = matchColumns(csv.rows[0]).mapping
  eq('CSV 引号内千分位 → 数字', coerceRow(csv.rows[3], cm).price, 418000)
  eq('CSV 里的 2022/3/18 也能解析', coerceRow(csv.rows[3], cm).buyDate, '2022-03-18')

  await throws(
    '旧版 .xls 给出可读的提示',
    () => {
      const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0])
      return readSheet({ name: 'old.xls', arrayBuffer: async () => ole.buffer, text: async () => '' })
    },
    '另存为'
  )

  await throws(
    '伪装成 xlsx 的 HTML 给出可读的提示',
    () => {
      const html = new TextEncoder().encode('<html><body>表格</body></html>')
      return readSheet({ name: 'fake.xlsx', arrayBuffer: async () => html.buffer, text: async () => '<html></html>' })
    },
    'HTML'
  )
}

console.log('\n=== 样式回归 ===')
{
  const css = await fs.readFile(path.resolve(HERE, '..', 'src', 'styles', 'app.css'), 'utf8')
  // 回归：`.input` 上的 appearance: none 会把 Chrome 的日历图标一起抹掉，
  // 于是 input[type=date] 看起来就是个普通文本框、点不出日期选择器
  const at = css.indexOf(".input[type='date']")
  const block = at < 0 ? '' : css.slice(at, at + 420)
  ok('日期类型显式恢复了原生外观', block.includes('appearance: auto'))
  ok('日历图标被显式调成可点', css.includes('::-webkit-calendar-picker-indicator'))
  ok('基础 .input 仍然关闭原生外观（两者不冲突）', /\.input,\s*\n?\.select \{[\s\S]{0,400}?appearance: none/.test(css))
}

console.log('\n=== 表单与导入共用同一套校验 ===')
{
  const base = { plate: '苏E·11111', type: '牵引车', tonnage: '32', price: '400000', buyDate: '2022-03-18', odo: '1000' }
  ok('完整数据通过', validateVehicle(base, { today: TODAY }).ok)
  ok('缺购置日期被拦下', !validateVehicle({ ...base, buyDate: '' }, { today: TODAY }).ok)
  ok('乱写的日期被拦下', !validateVehicle({ ...base, buyDate: '昨天' }, { today: TODAY }).ok)
  ok('未来日期被拦下', !validateVehicle({ ...base, buyDate: '2099-01-01' }, { today: TODAY }).ok)
  ok('车牌不再做格式限制（ABC 也放行）', validateVehicle({ ...base, plate: 'ABC' }, { today: TODAY }).ok)
  ok('国外车牌照样放行', validateVehicle({ ...base, plate: 'B-MW 1234' }, { today: TODAY }).ok)
  ok('车牌仍然必填', !validateVehicle({ ...base, plate: '' }, { today: TODAY }).ok)
  ok(
    '车牌重复被拦下',
    !validateVehicle(base, { today: TODAY, plateTaken: (p) => PLATES.has(p) || p === '苏E·11111' }).ok
  )
  const warn = validateVehicle({ ...base, tonnage: '3' }, { today: TODAY })
  ok('载重不合理只给软提示', warn.ok && !!warn.warnings.tonnage)
  const old = validateVehicle({ ...base, buyDate: '2005-01-01' }, { today: TODAY })
  ok('车龄过大只给软提示', old.ok && !!old.warnings.buyDate)
}

console.log('\n=== 司机字段定义 ===')
eq('可上传字段 = 5（含工资）', D_UPLOAD.map((f) => f.key), ['name', 'phone', 'hireDate', 'licenseNo', 'salary'])
eq('自动统计字段 = 3', D_STATS.map((f) => f.key), ['monthlyRevenue', 'totalMileage', 'totalEnergy'])
eq('事故/违章字段 = 3', D_INCIDENT.map((f) => f.key), ['date', 'desc', 'loss'])
ok('统计字段都标了 auto', D_STATS.every((f) => f.auto === true))
ok('统计字段没有别名（不参与表头匹配）', D_STATS.every((f) => !f.aliases))
ok('驾驶证号是选填', D_UPLOAD.find((f) => f.key === 'licenseNo').required === false)
{
  const head = driverTemplateCsv().split('\r\n')[0]
  ok('导入模板含四个可上传字段', ['姓名', '手机号', '入职日期', '驾驶证号'].every((h) => head.includes(h)))
  ok('导入模板不含自动统计字段', !head.includes('创收') && !head.includes('里程') && !head.includes('油耗'))
  ok('导入模板不含事故记录字段', !head.includes('事件描述') && !head.includes('经济损失'))
}

console.log('\n=== 司机校验 ===')
{
  const base = { name: '陈志强', phone: '13801234567', hireDate: '2019-03-11', licenseNo: '' }
  ok('完整数据通过', validateDriver(base, { today: TODAY }).ok)
  ok('缺姓名被拦下', !validateDriver({ ...base, name: '' }, { today: TODAY }).ok)
  ok('姓名不再限制（带数字也行）', validateDriver({ ...base, name: '陈志强2' }, { today: TODAY }).ok)
  ok('单字姓名也放行', validateDriver({ ...base, name: '李' }, { today: TODAY }).ok)
  ok('姓名仍然必填', !validateDriver({ ...base, name: '' }, { today: TODAY }).ok)
  ok('国外号码放行（不限制格式）', validateDriver({ ...base, phone: '+49 30 1234567' }, { today: TODAY }).ok)
  ok('短号码也放行', validateDriver({ ...base, phone: '12345' }, { today: TODAY }).ok)
  ok('手机号仍然必填', !validateDriver({ ...base, phone: '' }, { today: TODAY }).ok)
  ok('手机号重复被拦下', !validateDriver(base, { today: TODAY, phoneTaken: () => true }).ok)
  ok('缺入职日期被拦下', !validateDriver({ ...base, hireDate: '' }, { today: TODAY }).ok)
  ok('入职日期在未来被拦下', !validateDriver({ ...base, hireDate: '2099-01-01' }, { today: TODAY }).ok)
  ok('驾驶证号留空可以通过', validateDriver({ ...base, licenseNo: '' }, { today: TODAY }).ok)
  ok('驾驶证号带横线空格也能通过', validateDriver({ ...base, licenseNo: '3205 0119 8503 1245 17' }, { today: TODAY }).ok)
  ok(
    '驾驶证号重复被拦下',
    !validateDriver({ ...base, licenseNo: '320501198503124517' }, { today: TODAY, licenseTaken: () => true }).ok
  )
  ok('驾驶证号不做格式/长度限制', validateDriver({ ...base, licenseNo: 'AB-1' }, { today: TODAY }).ok)
  ok('驾驶证号可以是任意写法', validateDriver({ ...base, licenseNo: 'DE 1234/5678' }, { today: TODAY }).ok)
  ok('工龄过长只给软提示', validateDriver({ ...base, hireDate: '2000-01-01' }, { today: TODAY }).warnings.hireDate !== undefined)

  eq('号码里的横线保留', normalizePhone('139-1111-2222'), '139-1111-2222')
  eq('多余空格压缩、括号保留', normalizePhone('(139)   1111 2222'), '(139) 1111 2222')
  eq('大陆号码才分组展示', formatPhone('13911112222'), '139 1111 2222')
  eq('国外号码原样展示', formatPhone('+49 30 1234567'), '+49 30 1234567')
  eq('驾驶证号只去空格转大写，保留横线', normalizeLicenseNo(' ab-123 '), 'AB-123')
}

console.log('\n=== 司机工资 ===')
{
  const base = { name: '陈志强', phone: '13801234567', hireDate: '2019-03-11', licenseNo: '' }
  ok('工资是选填（不填也通过）', validateDriver(base, { today: TODAY }).ok)
  ok('填了正常数字通过', validateDriver({ ...base, salary: '8800' }, { today: TODAY }).ok)
  eq('空工资清成 0', toDriverPayload({ ...base, salary: '' }).salary, 0)
  eq('带千分位的工资能清出来', parseSalary('8,800 元'), 8800)
  eq('带 ¥ 也能清出来', parseSalary('¥12000'), 12000)
  eq('非法写法清成 0', parseSalary('八千'), 0)
  eq('工资被带进 payload', toDriverPayload({ ...base, salary: '8800' }).salary, 8800)
  ok('工资非数字被拦', !!validateDriver({ ...base, salary: '八千' }, { today: TODAY }).errors.salary)
  ok('工资为负被拦', !!validateDriver({ ...base, salary: '-1' }, { today: TODAY }).errors.salary)
  ok('工资超上限被拦', !!validateDriver({ ...base, salary: '99999999' }, { today: TODAY }).errors.salary)
  ok('工资填 0 只给软提示', (() => { const r = validateDriver({ ...base, salary: '0' }, { today: TODAY }); return r.ok && !!r.warnings.salary })())
  ok('工资在可上传字段里', D_UPLOAD.some((f) => f.key === 'salary'))
  eq('字段总数（可上传 5 + 统计 3）', D_UPLOAD.length + D_STATS.length, 8)
  ok('导入模板含工资列', driverTemplateCsv().split('\r\n')[0].includes('工资'))
}
console.log('\n=== 事故 / 违章校验 ===')
{
  const good = { date: '2025-08-12', desc: 'G2 无锡段追尾，本车全责', loss: '8600' }
  ok('完整记录通过', validateIncident(good, { today: TODAY }).ok)
  ok('经济损失可以为 0（无损失的违章）', validateIncident({ ...good, loss: '0' }, { today: TODAY }).ok)
  ok('缺发生时间被拦下', !validateIncident({ ...good, date: '' }, { today: TODAY }).ok)
  ok('发生时间在未来被拦下', !validateIncident({ ...good, date: '2099-01-01' }, { today: TODAY }).ok)
  ok('缺事件描述被拦下', !validateIncident({ ...good, desc: '' }, { today: TODAY }).ok)
  ok('经济损失为负被拦下', !validateIncident({ ...good, loss: '-1' }, { today: TODAY }).ok)
  ok('经济损失空着被拦下', !validateIncident({ ...good, loss: '' }, { today: TODAY }).ok)
}

console.log('\n=== 运营统计汇总（纯函数）===')
{
  eq('没有记录返回 null（界面据此显示「—」）', aggregateOps([]), null)
  eq('undefined 也返回 null', aggregateOps(undefined), null)
  const a = aggregateOps([
    { revenue: 1000, mileage: 100, energy: 30, energyType: 'fuel' },
    { revenue: 2000, mileage: 200, energy: 60, energyType: 'fuel' },
  ])
  eq('创收合计', a.revenue, 3000)
  eq('里程合计', a.mileage, 300)
  eq('油耗合计', a.energy, [{ type: 'fuel', value: 90 }])
  eq('记录条数', a.days, 2)
  eq('单公里创收', a.perKm, 10)
  const mixed = aggregateOps([
    { revenue: 1000, mileage: 100, energy: 30, energyType: 'fuel' },
    { revenue: 800, mileage: 150, energy: 45, energyType: 'electric' },
  ])
  eq('油电混合分开汇总', mixed.energy, [
    { type: 'fuel', value: 30 },
    { type: 'electric', value: 45 },
  ])
  eq('油耗展示', formatEnergy([{ type: 'fuel', value: 1200 }]), '1,200 L')
  eq('电耗展示', formatEnergy([{ type: 'electric', value: 890 }]), '890 kWh')
  eq('油电混合展示', formatEnergy([{ type: 'fuel', value: 1200 }, { type: 'electric', value: 90 }]), '1,200 L + 90 kWh')
  eq('没有能耗时展示「—」', formatEnergy([]), '—')
  ok('月份 key 形如 YYYY-MM', /^\d{4}-\d{2}$/.test(monthKey()))
}

console.log('\n=== 演示司机数据 ===')
eq('12 名演示司机', TEST_DRIVERS.length, 12)
ok('手机号都合法', TEST_DRIVERS.every((d) => /^1[3-9]\d{9}$/.test(d.phone)))
ok('手机号唯一', new Set(TEST_DRIVERS.map((d) => d.phone)).size === 12)
ok('驾驶证号唯一', new Set(TEST_DRIVERS.map((d) => d.licenseNo)).size === 12)
ok('入职日期都合法', TEST_DRIVERS.every((d) => !!parseDate(d.hireDate)))
{
  const incs = TEST_DRIVERS.flatMap((d) => d.incidents)
  eq('演示事故记录 6 条', incs.length, 6)
  ok('事故记录字段都完整', incs.every((i) => !!parseDate(i.date) && i.desc.length > 2 && i.loss >= 0))
  ok('有事故记录的司机 4 位', TEST_DRIVERS.filter((d) => d.incidents.length).length === 4)
}

console.log('\n=== 司机导入：标准模板 ===')
{
  const { rows } = await readSheet(await asFile('drivers-std.xlsx'))
  eq('总行数（含表头）', rows.length, 5)
  eq('表头读对了', rows[0], ['姓名', '手机号', '入职日期', '驾驶证号'])
  eq('入职日期原始值是数字（Excel 序列号）', typeof rows[1][2], 'number')
  const { mapping, missing } = matchDriverCols(rows[0])
  eq('4 个字段全部匹配', Object.keys(mapping).length, 4)
  eq('没有缺失的必填字段', missing, [])
  eq('Excel 日期序列号被还原', coerceDriverRow(rows[1], mapping).hireDate, '2019-03-11')
  eq('驾驶证号为空也能读', coerceDriverRow(rows[2], mapping).licenseNo, '')

  const empty = { existingPhones: new Set(), existingLicenses: new Set() }
  eq(
    '空库时 4 行全部可新增',
    summarizeDriverDrafts(buildDriverDrafts(rows, mapping, empty)),
    { add: 4, update: 0, error: 0, total: 4 }
  )
  const withExisting = {
    existingPhones: new Set(['13801234567', '15901234568', '13701234569', '18601234570']),
    existingLicenses: new Set(),
  }
  eq(
    '手机号已存在时全部判为替换',
    summarizeDriverDrafts(buildDriverDrafts(rows, mapping, withExisting)),
    { add: 0, update: 4, error: 0, total: 4 }
  )
}

console.log('\n=== 司机导入：脏数据 ===')
{
  const { rows } = await readSheet(await asFile('drivers-messy.xlsx'))
  const { mapping, missing } = matchDriverCols(rows[0])
  eq('别名表头全部识别（司机姓名/联系电话/入职时间/驾照号）', missing, [])

  const empty = { existingPhones: new Set(), existingLicenses: new Set() }
  const drafts = buildDriverDrafts(rows, mapping, empty)
  const s = summarizeDriverDrafts(drafts)
  eq('空行被跳过，得到 8 条草稿', s.total, 8)
  eq('统计：新增 3 / 替换 0 / 报错 5', [s.add, s.update, s.error], [3, 0, 5])
  eq('第 1 行：号码里的横线原样保留', drafts[0].draft.phone, '139-1111-2222')
  eq('第 1 行：可新增', drafts[0].action, 'add')
  eq('第 2 行：号码里的空格保留（压缩多余空格）', drafts[1].draft.phone, '158 1111 3333')
  eq('第 2 行：真日期单元格被还原', drafts[1].draft.hireDate, '2022-04-18')
  ok('第 2 行：驾驶证号留空也是合法行', drafts[1].action === 'add')
  eq('第 4 行：国外号码照样导入（不做格式限制）', drafts[3].action, 'add')
  eq('第 4 行：国外号码原样保留', drafts[3].draft.phone, '+49 30 1234567')
  eq('第 4 行：带横线的证号也保留', drafts[3].draft.licenseNo, 'DE-1234-5678')
  ok('第 3 行：错误定位到手机号', !!drafts[2].errors.phone)
  eq('第 3 行：文件内同号 → 报错', drafts[2].action, 'error')
  ok('第 3 行：提示「前面的行已经用过」', String(drafts[2].errors.phone).includes('前面'))
  eq('第 5 行：缺姓名 → 报错', drafts[4].action, 'error')
  ok('第 5 行：错误定位到姓名', !!drafts[4].errors.name)
  eq('第 6 行：入职日期解析不了 → 报错', drafts[5].action, 'error')
  ok('第 6 行：错误定位到入职日期', !!drafts[5].errors.hireDate)
  eq('第 7 行：入职日期在未来 → 报错', drafts[6].action, 'error')
  ok('第 7 行：提示不能晚于今天', String(drafts[6].errors.hireDate).includes('不能晚于'))
  eq('第 8 行：文件内驾驶证号重复 → 报错', drafts[7].action, 'error')
  ok('第 8 行：错误定位到驾驶证号', !!drafts[7].errors.licenseNo)
}

console.log('\n=== 司机导入：CSV ===')
{
  const csv = await readSheet(await asFile('drivers-std.csv'))
  eq('CSV 识别', csv.source, 'csv')
  eq('两行数据', csv.rows.length, 3)
  const m = matchDriverCols(csv.rows[0]).mapping
  eq('引号里的号码原样保留', coerceDriverRow(csv.rows[2], m).phone, '159 0123 4568')
  eq('2021/7/5 这种日期也能解析', coerceDriverRow(csv.rows[2], m).hireDate, '2021-07-05')
}

console.log('\n=== 日期输入框：点整块能弹出选择器 ===')
{
  const mk = (type) => ({
    tagName: 'INPUT',
    type,
    opened: 0,
    showPicker() {
      this.opened++
    },
  })
  const d = mk('date')
  ok('isDateInput 认得 date', isDateInput(d))
  ok('isDateInput 认得 datetime-local', isDateInput(mk('datetime-local')))
  // 回归：原先用 startsWith('date') 判断，month / week / time / datetime-local 全被漏掉，
  // 表现就是月份选择器「点了没反应」
  ok('isDateInput 认得 month', isDateInput(mk('month')))
  ok('isDateInput 认得 week', isDateInput(mk('week')))
  ok('isDateInput 认得 time', isDateInput(mk('time')))
  ok('isDateInput 大小写不敏感', isDateInput(mk('MONTH')))
  ok('isDateInput 不认 text', !isDateInput(mk('text')))
  ok('isDateInput 不认 null', !isDateInput(null))
  eq('月份框也能点开选择器', (() => { const m = mk('month'); openDatePicker({ currentTarget: m }); return m.opened })(), 1)

  openDatePicker({ currentTarget: d })
  eq('点一下就调用 showPicker', d.opened, 1)
  const txt = mk('text')
  openDatePicker({ currentTarget: txt })
  eq('文本框不受影响', txt.opened, 0)

  // 浏览器不支持、已打开、或不是用户手势，都不该抛出去
  openDatePicker({ currentTarget: { tagName: 'INPUT', type: 'date' } })
  ok('不支持 showPicker 时不报错', true)
  const boom = mk('date')
  boom.showPicker = () => {
    throw new Error('InvalidStateError: picker already showing')
  }
  openDatePicker({ currentTarget: boom })
  ok('showPicker 抛错被吞掉', true)
  openDatePicker(null)
  ok('传空也不炸', true)
  openDatePicker({ target: mk('date') })
  ok('退回用 target 也能工作', true)
}

console.log('\n=== 每个日期输入框都挂了弹出处理（回归）===')
{
  // 漏挂 @click 就会「点了没反应」—— 司机弹窗的入职日期就是这么漏的，
  // 所以这里静态扫一遍组件模板，新增日期框忘了挂会直接失败
  const dir = path.resolve(HERE, '..', 'src', 'components')
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.vue'))
  ok('扫到了组件文件', files.length >= 10, `${files.length} 个`)
  const missing = []
  let count = 0
  for (const f of files) {
    const txt = await fs.readFile(path.join(dir, f), 'utf8')
    const tags = txt.match(/<input[^>]*type="(?:date|month|week|time|datetime-local)"[^>]*>/g) || []
    for (const tag of tags) {
      count++
      if (!tag.includes('@click="openDatePicker"')) missing.push(`${f} ← ${tag.replace(/\s+/g, ' ').slice(0, 70)}`)
    }
  }
  ok('项目里确实有日期输入框', count >= 4, `${count} 个`)
  eq('每个日期输入框都挂了 @click="openDatePicker"', missing, [])
}
console.log('\n=== 校验规则清单（防止某条规则被静默删掉）===')
{
  // 这类丢失的症状很隐蔽：功能看着还在，就是不拦了。
  // 所以把每条规则的「代表性非法输入」都跑一遍，少一条就点名报出来。
  const T = TODAY
  const V = (o) => validateVehicle({ plate: '苏E·11111', type: '牵引车', tonnage: '32', price: '400000', buyDate: '2022-03-18', odo: '1000', ...o }, { today: T }).errors
  const D = (o) => validateDriver({ name: '陈志强', phone: '13801234567', hireDate: '2019-03-11', licenseNo: '', ...o }, { today: T }).errors
  const I = (o) => validateIncident({ date: '2025-01-01', desc: '测试事故', loss: '100', ...o }, { today: T }).errors
  const P = (o) => validateTrip({ date: '2026-10-01', routeId: 'R01', vehicleId: 'V01', type: '自卸车', driverId: 'D01', tonnage: '30', actualFuel: '48', distance: '132', ...o }, { today: T }).errors
  const K = (o) => validateCost({ date: '2026-10-10', purpose: 'part', vehicleId: 'V1', amount: '1200', note: '', ...o }, { today: T }).errors
  const R = (o) => validateRoute({ from: '南京', to: '合肥', distance: '165', ...o }, {}).errors

  const inventory = {
    车辆: [
      ['车牌必填', V({ plate: '' }).plate],
      ['车型必填', V({ type: '' }).type],
      ['车型过长', V({ type: '超长车型名'.repeat(5) }).type],
      ['载重必填', V({ tonnage: '' }).tonnage],
      ['载重非数字', V({ tonnage: 'x' }).tonnage],
      ['载重须为正', V({ tonnage: '0' }).tonnage],
      ['价格必填', V({ price: '' }).price],
      ['价格非数字', V({ price: 'x' }).price],
      ['价格须为正', V({ price: '-1' }).price],
      ['价格超上限', V({ price: '99999999' }).price],
      ['购置日期必填', V({ buyDate: '' }).buyDate],
      ['购置日期格式', V({ buyDate: '昨天' }).buyDate],
      ['购置日期不能未来', V({ buyDate: '2099-01-01' }).buyDate],
      ['购置日期过早', V({ buyDate: '1900-01-01' }).buyDate],
      ['里程必填', V({ odo: '' }).odo],
      ['里程非数字', V({ odo: 'x' }).odo],
      ['里程不能为负', V({ odo: '-1' }).odo],
    ],
    司机: [
      ['姓名必填', D({ name: '' }).name],
      ['手机号必填', D({ phone: '' }).phone],
      ['入职日期必填', D({ hireDate: '' }).hireDate],
      ['入职日期格式', D({ hireDate: '昨天' }).hireDate],
      ['入职日期不能未来', D({ hireDate: '2099-01-01' }).hireDate],
      ['入职日期过早', D({ hireDate: '1900-01-01' }).hireDate],
    ],
    事故: [
      ['发生时间必填', I({ date: '' }).date],
      ['发生时间格式', I({ date: '不是日期' }).date],
      ['发生时间不能未来', I({ date: '2099-01-01' }).date],
      ['描述必填', I({ desc: '' }).desc],
      ['描述太短', I({ desc: '短' }).desc],
      ['描述过长', I({ desc: '事'.repeat(201) }).desc],
      ['经济损失必填', I({ loss: '' }).loss],
      ['经济损失不能为负', I({ loss: '-1' }).loss],
      ['经济损失超上限', I({ loss: '99999999' }).loss],
    ],
    趟次: [
      ['日期必填', P({ date: '' }).date],
      ['日期格式', P({ date: '不是日期' }).date],
      ['日期不能未来', P({ date: '2099-01-01' }).date],
      ['路线必填', P({ routeId: '' }).routeId],
      ['车辆必填', P({ vehicleId: '' }).vehicleId],
      ['司机必填', P({ driverId: '' }).driverId],
      ['公里数必填', P({ distance: '' }).distance],
      ['公里数须为正', P({ distance: '0' }).distance],
      ['公里数超限', P({ distance: '99999' }).distance],
      ['载重必填', P({ tonnage: '' }).tonnage],
      ['载重不能为负', P({ tonnage: '-1' }).tonnage],
      ['载重超 100 吨', P({ tonnage: '120' }).tonnage],
      ['油耗必填', P({ actualFuel: '' }).actualFuel],
      ['油耗须为正', P({ actualFuel: '0' }).actualFuel],
      ['油耗超限', P({ actualFuel: '9999' }).actualFuel],
      ['过路费非数字', P({ toll: 'x' }).toll],
      ['油费单价非数字', P({ fuelPrice: 'x' }).fuelPrice],
      ['油费单价为负', P({ fuelPrice: '-1' }).fuelPrice],
      ['油费单价超上限', P({ fuelPrice: '999' }).fuelPrice],
      ['运费不能为负', P({ revenue: '-1' }).revenue],
    ],
    路线: [
      ['起点必填', R({ from: '' }).from],
      ['终点必填', R({ to: '' }).to],
      ['起终点不能相同', R({ to: '南京' }).to],
      ['公里数必填', R({ distance: '' }).distance],
      ['公里数非数字', R({ distance: '约一百' }).distance],
      ['公里数须为正', R({ distance: '0' }).distance],
      ['公里数超限', R({ distance: '99999' }).distance],
    ],
    成本: [
      ['日期必填', K({ date: '' }).date],
      ['日期格式', K({ date: '不是日期' }).date],
      ['日期不能未来', K({ date: '2099-01-01' }).date],
      ['用途必填', K({ purpose: '' }).purpose],
      ['用途须在枚举内', K({ purpose: '瞎写的用途' }).purpose],
      ['配件必须挂车', K({ purpose: 'part', vehicleId: '' }).vehicleId],
      ['证件必须挂车', K({ purpose: 'doc', vehicleId: '' }).vehicleId],
      ['金额必填', K({ amount: '' }).amount],
      ['金额非数字', K({ amount: 'x' }).amount],
      ['金额须为正', K({ amount: '0' }).amount],
      ['金额超上限', K({ amount: '99999999' }).amount],
    ],
  }
  const total = Object.values(inventory).reduce((a, r) => a + r.length, 0)
  ok('清单覆盖了 6 个表单的规则', Object.keys(inventory).length === 6 && total >= 60, `${total} 条`)
  for (const [group, rows] of Object.entries(inventory)) {
    const lost = rows.filter(([, msg]) => !msg).map(([label]) => label)
    eq(`${group}校验：${rows.length} 条规则全在`, lost, [])
  }
}

console.log('\n=== 油费单价与结算状态 ===')
{
  const base = {
    date: '2026-10-01', routeId: 'R01', vehicleId: 'V01', driverId: 'D01',
    tonnage: '30', actualFuel: '35', distance: '132',
  }
  // 油费单价：选填，但填了要是合理数字
  ok('油费单价选填（不填也通过）', validateTrip(base, { today: TODAY }).ok)
  ok('油费单价非数字被拦', !!validateTrip({ ...base, fuelPrice: 'x' }, { today: TODAY }).errors.fuelPrice)
  ok('油费单价为负被拦', !!validateTrip({ ...base, fuelPrice: '-1' }, { today: TODAY }).errors.fuelPrice)
  ok('油费单价超 200 元/L 被拦', !!validateTrip({ ...base, fuelPrice: '999' }, { today: TODAY }).errors.fuelPrice)
  ok('正常油价通过', validateTrip({ ...base, fuelPrice: '7.62' }, { today: TODAY }).ok)

  // 单趟算账
  eq('油费 = 油耗 × 单价', tripCost({ actualFuel: 35, fuelPrice: 7.5 }).fuelCost, 262.5)
  eq('没填单价时油费算 0（不拿默认油价硬凑）', tripCost({ actualFuel: 35 }).fuelCost, 0)
  eq(
    'hasPrice 区分「没填」和「填了 0」',
    [tripCost({ fuelPrice: 7.5 }).hasPrice, tripCost({}).hasPrice, tripCost({ fuelPrice: 0 }).hasPrice],
    [true, false, false]
  )
  eq('成本 = 油费 + 过路费', tripCost({ actualFuel: 35, fuelPrice: 7.5, toll: 85 }).cost, 347.5)
  eq('毛利 = 运费 − 成本', tripCost({ actualFuel: 35, fuelPrice: 7.5, toll: 85, revenue: 3000 }).profit, 2652.5)
  eq('跑亏了毛利为负', tripCost({ actualFuel: 35, fuelPrice: 7.5, toll: 85, revenue: 100 }).profit, -247.5)
  eq('什么都没填时全为 0', tripCost({}), { fuelCost: 0, toll: 0, cost: 0, revenue: 0, profit: 0, hasPrice: false })

  // 结算状态
  eq('不勾选就是待结算', toTripPayload(base).settled, false)
  eq('勾选后是已结算', toTripPayload({ ...base, settled: true }).settled, true)
  eq('只有 true 才算已结算（其它值都当待结算）', toTripPayload({ ...base, settled: 1 }).settled, false)
  eq('payload 带出油费单价', toTripPayload({ ...base, fuelPrice: '7.5' }).fuelPrice, 7.5)
  ok('油费单价在字段定义里', TRIP_FIELDS.some((f) => f.key === 'fuelPrice'))
  ok('结算状态是勾选类型', TRIP_FIELDS.some((f) => f.key === 'settled' && f.type === 'checkbox'))
}
console.log('\n=== 成本：折旧的时点计提 ===')
{
  // 成本要按月看，所以「这个月该提多少」不能简单等于月折旧额
  eq('买于当月之前 → 正常计提', monthlyDepreciationAt(418000, '2022-03-18', monthEnd('2026-10')), 6270)
  eq('提满 5 年后不再计提', monthlyDepreciationAt(388000, '2018-04-22', monthEnd('2026-10')), 0)
  eq('当月还没买 → 不计提', monthlyDepreciationAt(158000, '2026-11-10', monthEnd('2026-10')), 0)
  eq('刚好买到第 60 个月仍在提', monthlyDepreciationAt(360000, '2021-10-05', monthEnd('2026-09')) > 0, true)
  eq('第 61 个月起停提', monthlyDepreciationAt(360000, '2021-10-05', monthEnd('2026-10')), 0)
  eq('没填购置日期 → 0（不猜）', monthlyDepreciationAt(400000, '', monthEnd('2026-10')), 0)
  eq('月折旧额本身与时间无关', monthlyDepreciation(360000), 5400)
  // 月末边界：闰年 2 月
  eq('月末 2026-02 = 28 号', monthEnd('2026-02').getDate(), 28)
  eq('月末 2024-02 = 29 号（闰年）', monthEnd('2024-02').getDate(), 29)
  eq('月末 2026-12 = 31 号', monthEnd('2026-12').getDate(), 31)
}

console.log('\n=== 成本：手工录入 ===')
{
  const T = TODAY
  const base = { date: '2026-10-10', purpose: 'part', vehicleId: 'V1', amount: '1200', note: '' }
  ok('配件挂车后通过', validateCost(base, { today: T }).ok)
  ok('证件挂车后通过', validateCost({ ...base, purpose: 'doc' }, { today: T }).ok)
  ok('「其他」不挂车也通过', validateCost({ ...base, purpose: 'other', vehicleId: '' }, { today: T }).ok)
  ok('配件不挂车被拦', !!validateCost({ ...base, vehicleId: '' }, { today: T }).errors.vehicleId)
  ok('证件不挂车被拦', !!validateCost({ ...base, purpose: 'doc', vehicleId: '' }, { today: T }).errors.vehicleId)
  eq('配件不挂车的提示点名了用途', validateCost({ ...base, vehicleId: '' }, { today: T }).errors.vehicleId, '车辆配件必须选一台车')
  ok('「其他」不挂车时不报车辆错', !validateCost({ ...base, purpose: 'other', vehicleId: '' }, { today: T }).errors.vehicleId)
  ok('「其他」没备注只给软提示', (() => {
    const r = validateCost({ ...base, purpose: 'other', note: '' }, { today: T })
    return r.ok && !!r.warnings.note
  })())
  ok('「其他」写了备注就没有提示', !validateCost({ ...base, purpose: 'other', note: '仓库月租' }, { today: T }).warnings.note)

  // 「其他」不能带着车辆 id 入库 —— 否则会被算进那台车
  eq('「其他」的车辆 id 被清掉', toCostPayload({ ...base, purpose: 'other', note: 'x' }).vehicleId, '')
  eq('配件的车辆 id 保留', toCostPayload(base).vehicleId, 'V1')
  eq('金额保留两位', toCostPayload({ ...base, amount: '1234.567' }).amount, 1234.57)
}

console.log('\n=== 成本：按月汇总 ===')
{
  const vehicles = [
    { id: 'V1', plate: '挂车A', type: '牵引车', price: 418000, buyDate: '2022-03-18' },
    { id: 'V2', plate: '挂车B', type: '自卸车', price: 388000, buyDate: '2018-04-22' }, // 提满了
    { id: 'V3', plate: '挂车C', type: '皮卡', price: 158000, buyDate: '2026-11-10' }, // 还没买
  ]
  const drivers = [
    { id: 'D1', name: '甲', salary: 8800 },
    { id: 'D2', name: '乙', salary: 7200 },
    { id: 'D3', name: '丙', salary: 0 }, // 没填工资
  ]
  const trips = [
    { id: 'T1', date: '2026-10-05', vehicleId: 'V1', actualFuel: 100, fuelPrice: 7.5, toll: 120, revenue: 3000 },
    { id: 'T2', date: '2026-10-18', vehicleId: 'V1', actualFuel: 90, fuelPrice: 7.5, toll: 110, revenue: 2600 },
    { id: 'T3', date: '2026-09-20', vehicleId: 'V2', actualFuel: 80, fuelPrice: 7.2, toll: 90, revenue: 2000 },
  ]
  const costs = [
    { id: 'C1', date: '2026-10-08', purpose: 'part', vehicleId: 'V1', amount: 4200, note: '四条轮胎' },
    { id: 'C2', date: '2026-10-11', purpose: 'doc', vehicleId: 'V1', amount: 1800, note: '年检' },
    // 脏数据：其他用途却带着车辆 id，模型必须无视它
    { id: 'C3', date: '2026-10-20', purpose: 'other', vehicleId: 'V1', amount: 3000, note: '仓库月租' },
    { id: 'C4', date: '2026-09-30', purpose: 'part', vehicleId: 'V2', amount: 999, note: '上个月的' },
  ]

  const s = costSummary({ vehicles, drivers, trips, costs }, '2026-10')
  eq('折旧只算当月该提的（V1）', s.depreciation, 6270)
  eq('人工 = 工资合计', s.staff, 16000)
  eq('油耗 = 当月趟次', s.fuel, 1425)
  eq('过路费 = 当月趟次', s.toll, 230)
  eq('手工 = 当月三类合计', s.manual, 9000)
  eq('总成本 = 五项相加', s.total, 32925)
  eq('按用途拆分', s.byPurpose, { part: 4200, doc: 1800, other: 3000 })
  eq('只统计当月的趟次', s.tripCount, 2)
  eq('只统计当月的手工记录', s.manualCount, 3)
  eq('有数据时 empty 为 false', s.empty, false)

  // 逐车归集
  const v1 = s.vehicleRows.find((v) => v.id === 'V1')
  const v2 = s.vehicleRows.find((v) => v.id === 'V2')
  const v3 = s.vehicleRows.find((v) => v.id === 'V3')
  eq('V1 折旧', v1.depreciation, 6270)
  eq('V1 油耗', v1.fuel, 1425)
  eq('V1 过路费', v1.toll, 230)
  eq('V1 配件', v1.part, 4200)
  eq('V1 证件', v1.doc, 1800)
  eq('V1 手工合计只含配件+证件', v1.manual, 6000)
  eq(
    '「其他」没有被算进 V1（哪怕它带着 V1 的 id）',
    v1.manual,
    6000 // 若把 3000 也算进去会是 9000
  )
  eq('V1 合计', v1.total, 6270 + 1425 + 230 + 6000)
  eq('提满 5 年的 V2 折旧为 0', v2.depreciation, 0)
  eq('上个月的成本不计入 V2', v2.manual, 0)
  eq('还没买的 V3 全为 0', v3.total, 0)
  eq('按总额倒序', s.vehicleRows[0].id, 'V1')

  // 空月份：没有趟次也没有手工记录，但折旧与人工照提（它们是按月计提的）
  const empty = costSummary({ vehicles, drivers, trips, costs }, '2026-01')
  eq('空月份仍然有折旧（V1 那时还在 5 年内）', empty.depreciation, 6270)
  eq('空月份只有折旧 + 人工', empty.staff + empty.depreciation, 22270)
  eq('空月份没有趟次', empty.tripCount, 0)
  eq('空月份没有手工成本', empty.manualCount, 0)
  eq('空月份总成本 = 折旧 + 人工', empty.total, 22270)
  // 2027-04：V1（2022-03 买）与 V2 都已提满，只剩 2026-11 买的 V3 在提
  const later = costSummary({ vehicles, drivers, trips, costs }, '2027-04')
  eq('提满的车不再计提，只剩 V3', later.depreciation, monthlyDepreciation(158000))
  eq('V3 的月折旧', later.depreciation, 2370)
  eq('V1 与 V2 都不再计提', later.vehicleRows.filter((v) => v.depreciation > 0).map((v) => v.id), ['V3'])
  // 完全空的车队
  const none = costSummary({ vehicles: [], drivers: [], trips: [], costs: [] }, '2026-10')
  eq('什么都没有时 total 为 0', none.total, 0)
  eq('什么都没有时 empty 为 true', none.empty, true)
  eq('容错：不传数据也不炸', costSummary({}, '2026-10').total, 0)

  // 饼图数据
  const bd = costBreakdown(s)
  eq('饼图不含 0 值项', bd.every((x) => x.value > 0), true)
  eq('饼图项数 = 有金额的来源数（折旧/人工/油耗/过路/配件/证件/其他）', bd.length, 7)
  eq('饼图按金额倒序', bd[0].key, 'staff')
  ok('占比之和为 1', Math.abs(bd.reduce((a, x) => a + x.pct, 0) - 1) < 1e-9)
  eq('空数据时饼图为空数组', costBreakdown(costSummary({}, '2026-10')), [])

  // 月份
  eq('monthOf 取年月', monthOf('2026-10-05'), '2026-10')
  eq('inMonth 判断', [inMonth('2026-10-05', '2026-10'), inMonth('2026-10-05', '2026-11')], [true, false])
  const ms = availableMonths({ trips, costs }, new Date(2026, 9, 16))
  ok('可选月份含当前月', ms.includes('2026-10'))
  ok('可选月份含数据里的月份', ms.includes('2026-09'))
  ok('可选月份倒序', ms.join('|') === [...ms].sort().reverse().join('|'))
  ok('可选月份不重复', new Set(ms).size === ms.length)
}

console.log('\n=== 车辆必选（车型由车辆带出）===')
{
  // 车型不再单独填：它绑在车辆上。所以「车辆」变成了必选。
  // 自由度体现在车辆档案那边 —— 车辆车型可以写「依维柯」这种自定义值。
  const T = TODAY
  const T2 = { date: '2026-10-01', routeId: 'R01', vehicleId: 'V01', driverId: 'D01', tonnage: '3', actualFuel: '12', distance: '132' }
  eq('有车辆时通过', validateTrip(T2, { today: T }).errors.vehicleId, undefined)
  eq('缺车辆被拦', validateTrip({ ...T2, vehicleId: '' }, { today: T }).errors.vehicleId, '请选择车辆')
  eq('车型不再要求填（由车辆带出）', validateTrip({ ...T2, type: '' }, { today: T }).errors.type, undefined)
  eq('自定义车型的车辆照样能录趟次', validateTrip({ ...T2, type: '依维柯' }, { today: T }).errors.type, undefined)
}
console.log('\n=== 身份类字段不做格式限制（回归）===')
{
  // 用户在国外：车牌、手机号、姓名、驾驶证号的写法都不该被假定成中国大陆格式。
  // 这四条以前是硬拦，现在只保留「必填」和「唯一性」。
  const T = TODAY
  const V = (o, ctx) => validateVehicle({ plate: '苏E·11111', type: '牵引车', tonnage: '32', price: '400000', buyDate: '2022-03-18', odo: '1', ...o }, { today: T, ...ctx })
  const D = (o, ctx) => validateDriver({ name: '陈志强', phone: '13801234567', hireDate: '2019-03-11', licenseNo: '', ...o }, { today: T, ...ctx })

  eq(
    '各种车牌写法都放行',
    ['B-MW 1234', 'ABC', 'CA 12345', '京A·12345', '1-AB-234', 'ÜN-XY 99'].filter((p) => !V({ plate: p }).ok),
    []
  )
  eq(
    '各种手机号写法都放行',
    ['+49 30 1234567', '13801234567', '12345', '(020) 7946 0958', '+1-202-555-0143'].filter((p) => !D({ phone: p }).ok),
    []
  )
  eq(
    '各种姓名写法都放行',
    ['李', '陈志强2', "O'Brien", 'Jean-Luc Picard'].filter((n) => !D({ name: n }).ok),
    []
  )
  eq(
    '各种驾驶证号写法都放行',
    ['AB-1', 'DE 1234/5678', 'X', '123456789012345678', 'my-license'].filter((l) => !D({ licenseNo: l }).ok),
    []
  )
  eq('很长的姓名也不拦', D({ name: '张'.repeat(80) }).ok, true)

  // 但结构性的规则要留着：必填 + 唯一性（这两个跟国别无关）
  ok('车牌仍然必填', !V({ plate: '' }).ok)
  ok('姓名仍然必填', !D({ name: '' }).ok)
  ok('手机号仍然必填', !D({ phone: '' }).ok)
  ok('车牌仍然查重（导入靠它当主键）', !V({ plate: '苏E·11111' }, { plateTaken: () => true }).ok)
  ok('手机号仍然查重（导入靠它当主键）', !D({ phone: '13801234567' }, { phoneTaken: () => true }).ok)
  ok('驾驶证号填了仍查重', !D({ licenseNo: 'AB-1' }, { licenseTaken: () => true }).ok)

  // 归一化只做「不改含义」的事，绝不能把数据改写掉
  eq('国外车牌不会被插入分隔符', normalizePlate('B-MW 1234'), 'B-MW 1234')
  eq('带点的车牌不会被改写', normalizePlate('AB.123'), 'AB.123')
  eq('车牌只去首尾空格并转大写', normalizePlate(' ab 123 '), 'AB 123')
  eq('证号里的横线保留', normalizeLicenseNo('ab-123'), 'AB-123')
  eq('号码里的括号保留', normalizePhone('(020) 7946 0958'), '(020) 7946 0958')
  eq('多余空格压缩成一个', normalizePhone('+49   30  123'), '+49 30 123')
  eq('国外号码展示时不套大陆分组', formatPhone('+49 30 1234567'), '+49 30 1234567')
  ok('这两个正则留着但没启用', PLATE_RE instanceof RegExp && PHONE_RE instanceof RegExp)
}
console.log('\n=== 应用不内置任何数据 ===')
{
  // 回归：应用里不该再有「载入演示数据」这类东西，也别让内置数据集再长回来
  const files = []
  async function walk(dir) {
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      // _archived 是不参与构建的历史代码，不在扫描范围内
      if (e.isDirectory()) {
        if (e.name !== '_archived') await walk(p)
      } else if (/\.(js|mjs|vue|css)$/.test(e.name)) files.push(p)
    }
  }
  await walk(path.resolve(HERE, '..', 'src'))
  ok('src 下有源文件可扫', files.length >= 20, `${files.length} 个`)
  const offenders = []
  for (const p of files) {
    const txt = await fs.readFile(p, 'utf8')
    const hit = txt.match(/loadDemo|DEMO_VEHICLES|DEMO_DRIVERS|演示数据|演示司机|演示车/)
    if (hit) offenders.push(`${path.basename(p)} ← ${hit[0]}`)
  }
  eq('src 里没有任何「演示数据」相关代码残留', offenders, [])

  // 数据文件只剩枚举与默认值
  const vd = await import('../src/data/vehicles.js')
  const dd = await import('../src/data/drivers.js')
  ok('车辆数据文件不再导出演示车', !('DEMO_VEHICLES' in vd))
  eq(
    '车辆数据文件导出的都是规则',
    Object.keys(vd).sort(),
    [
      'CAR_TYPES', 'CAR_TYPE_NORM_FUEL', 'CAR_TYPE_TANK', 'CAR_TYPE_TONNAGE', 'GENERIC_PROFILE',
      'STATUS', 'STATUS_LIST', 'TODAY', 'VEHICLE_TYPES', 'VEHICLE_TYPE_MAP',
      'isEstimatedType', 'isKnownType', 'profileOf', 'typeDefaults',
    ].sort()
  )
  eq('司机数据文件只剩能耗枚举', Object.keys(dd), ['ENERGY_TYPES'])

  ok('测试夹具改用 TEST_ 前缀，只存在于 scripts 下', TEST_VEHICLES.length === 20 && TEST_DRIVERS.length === 12)
}

console.log('\n=== 车型基准表 ===')
eq('车型 9 种', CAR_TYPES.length, 9)
ok('含皮卡', CAR_TYPES.includes('皮卡'))
ok('每种车型都有一条油耗直线', VEHICLE_TYPES.every((t) => t.baseFuel > 0 && t.fuelPerTon > 0))
ok('每种车型都有额定载重与油箱', VEHICLE_TYPES.every((t) => t.normTonnage > 0 && t.tank > 0))
ok(
  '常见载重区间合法且覆盖额定载重',
  VEHICLE_TYPES.every((t) => t.tonnage[0] < t.tonnage[1] && t.tonnage[0] <= t.normTonnage && t.normTonnage <= t.tonnage[1])
)
eq(
  '满载基准 = 空载 + 每吨增量 × 额定载重',
  VEHICLE_TYPES.map((t) => CAR_TYPE_NORM_FUEL[t.type]),
  VEHICLE_TYPES.map((t) => Math.round((t.baseFuel + t.fuelPerTon * t.normTonnage) * 10) / 10)
)
ok(
  '皮卡的每吨增量是牵引车的 3 倍以上（自重占比不同）',
  VEHICLE_TYPE_MAP['皮卡'].fuelPerTon > VEHICLE_TYPE_MAP['牵引车'].fuelPerTon * 3
)

console.log('\n=== 每吨每百公里耗油量（核心指标）===')
{
  // L /（吨·百公里）= 实际油耗 ÷ (载重 × 公里数 ÷ 100)
  eq('吨·百公里 = 30 × 108 ÷ 100', tonHundredKm(30, 108), 32.4)
  eq('载重 0 时分母为 0', tonHundredKm(0, 108), 0)
  eq('公里数 0 时分母为 0', tonHundredKm(30, 0), 0)
  eq('30 吨跑 108 km 烧 35 L', fuelPerTon100km(30, 108, 35), 1.08)
  eq('空载算不出每吨耗油（返回 null，不是 0）', fuelPerTon100km(0, 108, 35), null)
  eq('没填油耗也算不出', fuelPerTon100km(30, 108, 0), null)
  eq('指标无量纲换算：翻倍载重 → 指标减半', fuelPerTon100km(60, 108, 35), 0.54)
  eq('折合百公里（不带载重归一）', fuelPer100km(108, 35), 32.41)
}

console.log('\n=== 核心：载重被归一化掉，司机才能横向比 ===')
{
  // 甲拉重货、油耗绝对值高；乙拉轻货、油耗绝对值低。
  // 但按「每吨每百公里」算，乙反而更费 —— 这正是要这个指标的原因。
  const A = fuelPerTon100km(30, 108, 35)
  const B = fuelPerTon100km(18, 108, 33)
  ok('甲（30 吨）每吨耗油更省', A < B, `${A} < ${B}`)
  ok('但甲的绝对油耗更高', 35 > 33)
  ok('乙的百公里油耗更低', fuelPer100km(108, 33) < fuelPer100km(108, 35))
  eq('只看百公里油耗会得出相反结论 —— 所以要按吨归一化', B > A, true)
}

console.log('\n=== 趟次汇总（加权口径 + 波动范围）===')
{
  eq('没有趟次返回 0', aggregateTrips([]).trips, 0)
  eq('没有数据时指标为 null', aggregateTrips([]).perTon100, null)
  eq('undefined 也不炸', aggregateTrips(undefined).trips, 0)

  const list = [
    { tonnage: 30, distance: 108, actualFuel: 35, revenue: 3000, toll: 85 },
    { tonnage: 20, distance: 108, actualFuel: 30, revenue: 2500, toll: 85 },
  ]
  const a = aggregateTrips(list)
  eq('趟次', a.trips, 2)
  eq('里程合计', a.distance, 216)
  eq('油耗合计', a.actual, 65)
  eq('吨·百公里合计 = 32.4 + 21.6', a.tonHundred, 54)
  eq('加权指标 = 65 ÷ 54', a.perTon100, 1.204)
  eq('波动下限（更省的那趟）', a.perTon100Min, 1.08)
  eq('波动上限（更费的那趟）', a.perTon100Max, 1.389)
  eq('运费合计', a.revenue, 5500)
  eq('过路费合计', a.toll, 170)
  eq('平均载重', a.avgTonnage, 25)
  eq('跳过 0 趟', a.skipped, 0)

  // 加权而不是算术平均：短途那趟不该和长途等权
  const weighted = aggregateTrips([
    { tonnage: 30, distance: 100, actualFuel: 30 },
    { tonnage: 30, distance: 1, actualFuel: 30 },
  ])
  eq('加权口径按吨·公里算 = 60 ÷ 30.3', weighted.perTon100, 1.98)
  const mean = Math.round(((1.0 + 100) / 2) * 1000) / 1000
  ok('和算术平均明显不同', weighted.perTon100 !== mean, `加权 ${weighted.perTon100} vs 算术 ${mean}`)
}

console.log('\n=== 空载与缺数据的趟次不计入 ===')
{
  const list = [
    { tonnage: 30, distance: 108, actualFuel: 35 },
    { tonnage: 0, distance: 108, actualFuel: 30 },   // 空载返程：算不出每吨耗油
    { tonnage: 20, distance: 0, actualFuel: 30 },    // 没里程
    { tonnage: 20, distance: 50, actualFuel: 0 },    // 没油耗
  ]
  const a = aggregateTrips(list)
  eq('只有 1 趟参与对比', a.trips, 1)
  eq('跳过 3 趟', a.skipped, 3)
  eq('指标只按参与的那趟算', a.perTon100, 1.08)
  ok('空载趟次没把指标拉成 0', a.perTon100 > 0)
  ok('汇总里报出跳过了几趟', a.skipped === 3)
  eq('单趟时上下限相同', [a.perTon100Min, a.perTon100Max], [1.08, 1.08])
}

console.log('\n=== 车型自由输入（不再限定在枚举里）===')
eq('车型名原样命中基准表', profileOf('皮卡').matched, 'exact')
eq('「皮卡车」按关键词落到皮卡档', profileOf('皮卡车').matchedType, '皮卡')
eq('「9米6冷藏」落到冷藏车档', profileOf('9米6冷藏').matchedType, '冷藏车')
eq('「半挂牵引」落到牵引车档', profileOf('半挂牵引').matchedType, '牵引车')
eq('「重型自卸」落到自卸车档', profileOf('重型自卸').matchedType, '自卸车')
eq('认不出来的用通用档', profileOf('依维柯').matched, 'generic')
eq('空车型也是通用档', profileOf('').matched, 'generic')
ok('isKnownType 只认原样存在的', isKnownType('皮卡') && !isKnownType('皮卡车'))
ok('isEstimatedType 只认通用档', isEstimatedType('依维柯') && !isEstimatedType('皮卡车'))
eq('通用档满载基准 = 18 + 0.7 × 10', typeDefaults('依维柯').normFuel, 25)
eq('已知车型的满载基准与基准表一致', typeDefaults('自卸车').normFuel, CAR_TYPE_NORM_FUEL['自卸车'])
eq('typeDefaults 会报出 known', [typeDefaults('皮卡').known, typeDefaults('依维柯').known], [true, false])
eq('关键词档能拿到对应的油耗直线', fuelRate('9米6冷藏', 12), fuelRate('冷藏车', 12))
{
  const base = { plate: '苏E·11111', tonnage: '5', price: '100000', buyDate: '2022-03-18', odo: '1' }
  ok('未知车型可以通过校验', validateVehicle({ ...base, type: '依维柯' }, { today: TODAY }).ok)
  ok('但带一条油耗基准软提示', !!validateVehicle({ ...base, type: '依维柯' }, { today: TODAY }).warnings.type)
  ok('已知车型没有这条提示', !validateVehicle({ ...base, type: '皮卡', tonnage: '1' }, { today: TODAY }).warnings.type)
  ok('车型仍然必填', !validateVehicle({ ...base, type: '' }, { today: TODAY }).ok)
  ok('车型名过长被拦', !validateVehicle({ ...base, type: '超长车型名'.repeat(5) }, { today: TODAY }).ok)
  ok('未知车型按通用载重区间给提示', !!validateVehicle({ ...base, type: '依维柯', tonnage: '80' }, { today: TODAY }).warnings.tonnage)
}
console.log('\n=== 路线规则 ===')
eq('路线标识去空格', routeKey(' 苏州 ', '上海'), '苏州→上海')
eq('由记录取标识', routeOf({ from: '苏州', to: '上海' }), '苏州→上海')
eq('路线显示名', routeName({ from: '苏州', to: '上海' }), '苏州 → 上海')
eq('地名归一化', normPlace(' 苏 州 '), '苏州')
eq(
  '总过路费按车型汇总',
  routeTollTotal({ tolls: [{ prices: { 牵引车: 85 } }, { prices: { 牵引车: 60 } }] }, '牵引车'),
  145
)
eq('该车型没价格算 0', routeTollTotal({ tolls: [{ prices: { 牵引车: 85 } }] }, '皮卡'), 0)
eq('空路线算 0', routeTollTotal(null, '皮卡'), 0)
eq('单站取价', tollPrice({ prices: { 牵引车: 85 } }, '牵引车'), 85)
// 回归：车型是自由输入的，收费站价格不能拿基准表去过滤，否则自定义车型会被悄悄丢掉
eq('自定义车型的过路费不会被丢掉', routeTollTotal({ tolls: [{ prices: { 依维柯: 20, 牵引车: 85 } }] }, '依维柯'), 20)
{
  const p = toRoutePayload({ from: 'A', to: 'B', distance: '10', tolls: [{ station: 'S', prices: { 依维柯: '20', 牵引车: '85' } }] })
  eq('payload 保留自定义车型', Object.keys(p.tolls[0].prices).sort(), ['依维柯', '牵引车'].sort())
}
ok('自定义车型的价格同样做校验', !!validateToll({ station: 'S', prices: { 依维柯: '-1' } }).errors['price_依维柯'])
ok('自定义车型价格非数字也被拦', !!validateToll({ station: 'S', prices: { 依维柯: 'abc' } }).errors['price_依维柯'])
eq('价格区间', tollRange({ tolls: [{ prices: { 牵引车: 85, 皮卡: 25 } }] }), { min: 25, max: 85 })
eq('没有任何价格时返回 null', tollRange({ tolls: [] }), null)
ok('起终点相同被拦', !!validateRoute({ from: '南京', to: '南京', distance: '10' }).errors.to)
ok('公里数为 0 被拦', !!validateRoute({ from: 'A', to: 'B', distance: '0' }).errors.distance)
ok('公里数非数字被拦', !!validateRoute({ from: 'A', to: 'B', distance: '约一百' }).errors.distance)
ok('公里数超大被拦', !!validateRoute({ from: 'A', to: 'B', distance: '99999' }).errors.distance)
ok('缺起点被拦', !!validateRoute({ from: '', to: 'B', distance: '10' }).errors.from)
ok(
  '重复路线被拦',
  !!validateRoute({ from: '苏州', to: '上海', distance: '108' }, { takenRouteKeys: new Set(['苏州→上海']) }).errors.to
)
ok(
  '编辑自己时不算重复',
  validateRoute(
    { from: '苏州', to: '上海', distance: '108' },
    { takenRouteKeys: new Set(['苏州→上海']), selfKey: '苏州→上海' }
  ).ok
)
ok('收费站没名字被拦', !!validateToll({ station: '', prices: {} }).errors.station)
ok('同路线重名收费站被拦', !!validateToll({ station: '江宁', prices: {} }, { seen: new Set(['江宁']) }).errors.station)
ok('价格为负被拦', !!validateToll({ station: '江宁', prices: { 牵引车: '-5' } }).errors['price_牵引车'])
ok('价格非数字被拦', !!validateToll({ station: '江宁', prices: { 牵引车: 'abc' } }).errors['price_牵引车'])
{
  const t = validateToll({ station: '江宁', prices: {} })
  ok('没填任何价格只给软提示', t.ok && t.warnings.length === 1)
}
{
  const p = toRoutePayload({
    from: ' 苏州 ',
    to: '上海',
    distance: '108.6',
    tolls: [{ station: '苏州新区', prices: { 牵引车: '85', 皮卡: '', 自卸车: '0' } }],
  })
  eq('payload：起点去空格', p.from, '苏州')
  eq('payload：公里数保留一位小数', p.distance, 108.6)
  eq('payload：空值与 0 都不写入价格', Object.keys(p.tolls[0].prices), ['牵引车'])
  eq(
    'payload：整条空的收费站被丢掉',
    toRoutePayload({ from: 'A', to: 'B', distance: '10', tolls: [{ station: '', prices: {} }] }).tolls,
    []
  )
}

console.log('\n=== 趟次规则 ===')
{
  const base = {
    date: '2026-10-01', routeId: 'R01', vehicleId: 'V01', type: '自卸车', driverId: 'D01',
    tonnage: '30', actualFuel: '48', distance: '132',
  }
  ok('完整趟次通过', validateTrip(base, { today: TODAY }).ok)
  ok('缺路线被拦', !!validateTrip({ ...base, routeId: '' }, { today: TODAY }).errors.routeId)
  ok('缺司机被拦', !!validateTrip({ ...base, driverId: '' }, { today: TODAY }).errors.driverId)
  ok('缺车辆被拦', !!validateTrip({ ...base, vehicleId: '' }, { today: TODAY }).errors.vehicleId)
  ok('车型不再单独要求（由车辆带出）', validateTrip({ ...base, type: '' }, { today: TODAY }).ok)
  ok('油耗为 0 被拦', !!validateTrip({ ...base, actualFuel: '0' }, { today: TODAY }).errors.actualFuel)
  ok('载重为负被拦', !!validateTrip({ ...base, tonnage: '-1' }, { today: TODAY }).errors.tonnage)
  ok('载重超 100 吨被拦', !!validateTrip({ ...base, tonnage: '120' }, { today: TODAY }).errors.tonnage)
  ok('缺公里数被拦', !!validateTrip({ ...base, distance: '' }, { today: TODAY }).errors.distance)
  ok('未来日期被拦', !!validateTrip({ ...base, date: '2099-01-01' }, { today: TODAY }).errors.date)
  ok('运费为负被拦', !!validateTrip({ ...base, revenue: '-1' }, { today: TODAY }).errors.revenue)
  ok(
    '不再拿标准值比对：高油耗只要不超上限就放行、不告警',
    (() => {
      const r = validateTrip({ ...base, actualFuel: '200' }, { today: TODAY })
      return r.ok && !r.warnings.actualFuel
    })()
  )
  ok(
    '油耗低于物理下限只给软提示',
    (() => {
      const r = validateTrip({ ...base, actualFuel: '5' }, { today: TODAY })
      return r.ok && !!r.warnings.actualFuel
    })()
  )
  eq(
    '同一「日期+路线+司机+车」视为同一趟',
    tripKeyFields({ date: '2026-10-01', routeId: 'R01', driverId: 'D01', vehicleId: 'V01' }),
    '2026-10-01|R01|D01|V01'
  )
  eq('不指定车辆也能算 key', tripKeyFields({ date: '2026-10-01', routeId: 'R01', driverId: 'D01' }), '2026-10-01|R01|D01|')
  {
    const p = toTripPayload({ date: '2026-10-01', routeId: 'R01', type: '自卸车', driverId: 'D01', tonnage: '30', actualFuel: '48', distance: '132', toll: '', revenue: '' })
    eq('payload：空过路费记 0', p.toll, 0)
    eq('payload：载重转成数字', p.tonnage, 30)
  }
}

console.log(`\n${fail === 0 ? `全部通过（${pass} 项）` : `${fail} 项失败 / ${pass} 项通过`}\n`)
if (fail) process.exit(1)
