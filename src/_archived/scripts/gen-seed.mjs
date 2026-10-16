/* 一次性脚本：把 20 台种子车导出成可读的字面量，
   用于替换掉庞大的成本流水模拟器（车辆模块只用得上车辆档案本身）。
   运行： node scripts/gen-seed.mjs */
import { VEHICLES } from '../src/data/mock.js'

const FIELDS = ['id', 'code', 'plate', 'model', 'type', 'tonnage', 'price', 'odo', 'buyYear', 'age', 'normFuel', 'tank', 'fuelType', 'status', 'nextServiceOdo']

const q = (v) => (typeof v === 'string' ? `'${v}'` : String(v))
const lines = VEHICLES.map((v) => {
  const o = { ...v, code: v.code || v.id }
  const body = FIELDS.map((f) => `${f}: ${q(o[f])}`).join(', ')
  return `  { ${body} },`
})

console.log(lines.join('\n'))
