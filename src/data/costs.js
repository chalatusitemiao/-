/* ============================================================
   成本模块 · 用途枚举与配色
   ------------------------------------------------------------
   手工成本分三种用途：
     车辆配件 / 车辆证件 —— 必须挂到具体车辆上（这样才能算进「每辆车花了多少」）
     其他             —— 只需要金额和备注，不挂车
   ============================================================ */

export const COST_PURPOSES = [
  {
    key: 'part', name: '车辆配件', needVehicle: true,
    hint: '轮胎、刹车片、滤芯这类消耗件',
  },
  {
    key: 'doc', name: '车辆证件', needVehicle: true,
    hint: '年检、营运证、保险这类证件相关费用',
  },
  {
    key: 'other', name: '其他', needVehicle: false,
    hint: '不挂车的支出，填个备注说明是什么',
  },
]

export const COST_PURPOSE_MAP = Object.fromEntries(COST_PURPOSES.map((p) => [p.key, p]))
export const needVehicle = (purpose) => COST_PURPOSE_MAP[purpose]?.needVehicle === true
export const purposeName = (purpose) => COST_PURPOSE_MAP[purpose]?.name || '未知'

/** 成本构成里每一类的配色（自绘图表直接吃这些色值） */
export const COST_COLORS = {
  depreciation: '#4f46e5', // 靛蓝 —— 折旧，最大头
  staff: '#0d9488', // 青绿 —— 人工
  fuel: '#f59e0b', // 琥珀 —— 油耗
  toll: '#0ea5e9', // 天蓝 —— 过路费
  part: '#8b5cf6', // 紫 —— 配件
  doc: '#14b8a6', // 蓝绿 —— 证件
  other: '#94a3b8', // 灰 —— 其他
}
