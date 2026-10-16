/* ============================================================
   折旧计提（直线法 / 年限平均法）
   ------------------------------------------------------------
   按「5 年、残值 10%」做直线折旧：
     月折旧 = 购置价格 × (1 - 残值率) ÷ 5 年 ÷ 12 个月
     当前净值 = max(残值, 购置价格 - 月折旧 × 已使用月数)
   提满 5 年后净值停在残值上，不再继续计提。
   ============================================================ */
import { monthsBetween, parseDate } from './date.js'

export const DEP_YEARS = 5
export const RESIDUAL_RATE = 0.1

/** 月折旧额（元，四舍五入到元） */
export function monthlyDepreciation(price) {
  const p = Number(price) || 0
  if (p <= 0) return 0
  return Math.round((p * (1 - RESIDUAL_RATE)) / DEP_YEARS / 12)
}

/** 年折旧额 */
export const annualDepreciation = (price) => monthlyDepreciation(price) * 12

/** 已使用月数（从购置日期算到现在） */
export const monthsUsed = (buyDate, today = new Date()) => monthsBetween(parseDate(buyDate), today)

/** 车龄（年，保留 1 位小数） */
export function ageYears(buyDate, today = new Date()) {
  return Math.round((monthsUsed(buyDate, today) / 12) * 10) / 10
}

/** 是否已提足折旧 */
export const isFullyDepreciated = (buyDate, today = new Date()) =>
  monthsUsed(buyDate, today) >= DEP_YEARS * 12

/** 当前账面净值 */
export function netBookValue(price, buyDate, today = new Date()) {
  const p = Number(price) || 0
  if (p <= 0) return 0
  const residual = p * RESIDUAL_RATE
  const used = Math.min(monthsUsed(buyDate, today), DEP_YEARS * 12)
  return Math.max(Math.round(residual), Math.round(p - monthlyDepreciation(p) * used))
}

/** 累计已提折旧额 */
export const accumulatedDepreciation = (price, buyDate, today = new Date()) =>
  Math.max(0, (Number(price) || 0) - netBookValue(price, buyDate, today))

/**
 * 一次性算齐某个车龄下所有折旧指标，界面直接用。
 * @returns { monthsUsed, ageYears, monthly, annual, netBookValue, accumulated, residual, fully }
 */
export function depreciation(price, buyDate, today = new Date()) {
  const p = Number(price) || 0
  const used = monthsUsed(buyDate, today)
  const monthly = monthlyDepreciation(p)
  const residual = Math.round(p * RESIDUAL_RATE)
  const capped = Math.min(used, DEP_YEARS * 12)
  const nbv = p <= 0 ? 0 : Math.max(residual, Math.round(p - monthly * capped))
  return {
    monthsUsed: used,
    ageYears: Math.round((used / 12) * 10) / 10,
    monthly,
    annual: monthly * 12,
    netBookValue: nbv,
    accumulated: Math.max(0, p - nbv),
    residual,
    fully: used >= DEP_YEARS * 12,
  }
}
