/* ============================================================
   自检用的固定数据（**只给测试用，不属于应用**）
   ------------------------------------------------------------
   应用本身不内置任何数据：车辆和司机都从空列表开始，
   由录入 / Excel 导入产生。这里这份数据是给测试当夹具用的，
   让渲染断言与导入断言有稳定的输入，不受界面变化影响。
   ============================================================ */

/** 20 台车：覆盖 5 种车型、2018~2024 的购置年份（含已提足折旧的老车） */
export const TEST_VEHICLES = [
  { plate: '苏E·Q33953', model: '解放 J6P 领航版', type: '牵引车', tonnage: 32, price: 418000, buyDate: '2022-03-18', odo: 603425, normFuel: 34.8, tank: 600, status: 'idle' },
  { plate: '苏E·J24383', model: '东风天龙 KL', type: '牵引车', tonnage: 32, price: 442000, buyDate: '2022-06-02', odo: 447468, normFuel: 33.8, tank: 600, status: 'run' },
  { plate: '苏B·Q55612', model: '重汽豪沃 T7H', type: '牵引车', tonnage: 32, price: 422000, buyDate: '2022-09-25', odo: 199496, normFuel: 35.7, tank: 600, status: 'run' },
  { plate: '苏A·R72038', model: '陕汽德龙 X3000', type: '牵引车', tonnage: 32, price: 408000, buyDate: '2021-04-12', odo: 417681, normFuel: 35.7, tank: 600, status: 'idle' },
  { plate: '浙B·P64159', model: '福田欧曼 EST', type: '厢式货车', tonnage: 10, price: 253000, buyDate: '2019-07-08', odo: 653176, normFuel: 24.3, tank: 300, status: 'idle' },
  { plate: '皖A·B67825', model: '江淮格尔发 K7', type: '厢式货车', tonnage: 10, price: 255000, buyDate: '2020-05-21', odo: 244822, normFuel: 24.7, tank: 300, status: 'run' },
  { plate: '沪D·N78520', model: '解放 J6L 冷藏', type: '冷藏车', tonnage: 15, price: 416000, buyDate: '2020-11-03', odo: 111699, normFuel: 29.8, tank: 600, status: 'fix' },
  { plate: '苏E·E78934', model: '东风天锦 KR', type: '平板车', tonnage: 32, price: 240000, buyDate: '2020-08-17', odo: 264992, normFuel: 26.4, tank: 600, status: 'idle' },
  { plate: '苏E·L37862', model: '解放 J6P 领航版', type: '牵引车', tonnage: 32, price: 424000, buyDate: '2022-01-09', odo: 532920, normFuel: 34.9, tank: 600, status: 'idle' },
  { plate: '苏B·H50626', model: '东风天龙 KL', type: '牵引车', tonnage: 32, price: 422000, buyDate: '2019-10-26', odo: 317967, normFuel: 34.6, tank: 600, status: 'run' },
  { plate: '苏A·E52102', model: '重汽豪沃 T7H', type: '牵引车', tonnage: 32, price: 460000, buyDate: '2018-06-14', odo: 534435, normFuel: 36.7, tank: 600, status: 'run' },
  { plate: '浙B·U19593', model: '陕汽德龙 X3000', type: '牵引车', tonnage: 32, price: 416000, buyDate: '2023-05-06', odo: 246582, normFuel: 34.0, tank: 600, status: 'idle' },
  { plate: '皖A·Y30937', model: '福田欧曼 EST', type: '厢式货车', tonnage: 10, price: 263000, buyDate: '2018-09-30', odo: 409916, normFuel: 23.6, tank: 300, status: 'ready' },
  { plate: '沪D·S23899', model: '江淮格尔发 K7', type: '厢式货车', tonnage: 10, price: 279000, buyDate: '2024-03-11', odo: 287241, normFuel: 23.8, tank: 300, status: 'run' },
  { plate: '苏E·D40581', model: '解放 J6L 冷藏', type: '冷藏车', tonnage: 15, price: 408000, buyDate: '2018-04-22', odo: 464805, normFuel: 30.0, tank: 600, status: 'run' },
  { plate: '苏E·W53136', model: '东风天锦 KR', type: '平板车', tonnage: 32, price: 240000, buyDate: '2023-11-19', odo: 447431, normFuel: 26.4, tank: 600, status: 'ready' },
  { plate: '苏B·C69159', model: '解放 J6P 领航版', type: '牵引车', tonnage: 32, price: 429000, buyDate: '2019-02-27', odo: 274572, normFuel: 36.5, tank: 600, status: 'idle' },
  { plate: '苏A·G56528', model: '东风天龙 KL', type: '牵引车', tonnage: 32, price: 385000, buyDate: '2018-12-05', odo: 560317, normFuel: 35.5, tank: 600, status: 'fix' },
  { plate: '浙B·T22017', model: '重汽豪沃 T7H', type: '牵引车', tonnage: 32, price: 430000, buyDate: '2021-08-13', odo: 363719, normFuel: 36.2, tank: 600, status: 'run' },
  { plate: '皖A·E95448', model: '陕汽德龙 X3000', type: '牵引车', tonnage: 32, price: 399000, buyDate: '2024-07-24', odo: 208333, normFuel: 33.4, tank: 600, status: 'idle' },
]

/** 12 名司机：4 位带事故/违章记录，共 6 条 */
export const TEST_DRIVERS = [
  {
    name: '陈志强', phone: '13801234567', hireDate: '2019-03-11', licenseNo: '320501198503124517',
    incidents: [
      { date: '2025-08-12', desc: 'G2 无锡段追尾，本车全责', loss: 8600 },
      { date: '2026-03-05', desc: '闯红灯（路口抓拍）', loss: 200 },
    ],
  },
  { name: '刘海涛', phone: '15901234568', hireDate: '2021-07-05', licenseNo: '320502199007221234', incidents: [] },
  {
    name: '王建国', phone: '13701234569', hireDate: '2017-05-22', licenseNo: '320503198211095678',
    incidents: [{ date: '2025-11-20', desc: '倒车刮蹭货台护栏', loss: 1200 }],
  },
  { name: '李永利', phone: '18601234570', hireDate: '2020-09-14', licenseNo: '320504199201183456', incidents: [] },
  { name: '赵德海', phone: '13901234571', hireDate: '2018-11-30', licenseNo: '320505198709267890', incidents: [] },
  { name: '孙振华', phone: '15801234572', hireDate: '2022-04-18', licenseNo: '320506199505142345', incidents: [] },
  {
    name: '周广志', phone: '13501234573', hireDate: '2016-08-09', licenseNo: '320507198001038765',
    incidents: [{ date: '2024-10-09', desc: '雨天侧滑撞护栏，车厢受损', loss: 24000 }],
  },
  { name: '吴春生', phone: '18701234574', hireDate: '2023-02-27', licenseNo: '320508199611205432', incidents: [] },
  {
    name: '郑海峰', phone: '13601234575', hireDate: '2019-12-03', licenseNo: '320509198812119876',
    incidents: [
      { date: '2026-06-18', desc: '疲劳驾驶被查，罚款并扣分', loss: 500 },
      { date: '2026-09-02', desc: '高速超速 20% 以下', loss: 200 },
    ],
  },
  { name: '冯玉良', phone: '15001234576', hireDate: '2021-10-21', licenseNo: '320510199309076543', incidents: [] },
  { name: '韩明辉', phone: '18801234577', hireDate: '2020-06-16', licenseNo: '320511199104282109', incidents: [] },
  { name: '曹俊峰', phone: '13301234578', hireDate: '2024-01-08', licenseNo: '320512199802163456', incidents: [] },
]
