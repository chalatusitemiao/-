/* ============================================================
   日期输入框：点整块就能弹出日期选择器
   ------------------------------------------------------------
   原生的 input[type=date] 只在**右侧那个小日历图标**上响应点击，
   点文本框区域只会聚焦到「年 / 月 / 日」里的某一段，
   用户的感觉就是「点了没反应」—— 所以统一挂上这个处理函数。

   用法：<input type="date" @click="openDatePicker" />
   scripts/check-sheet.mjs 里有一条静态扫描，保证新增的日期框不会漏挂。
   ============================================================ */

/** 是不是日期类的输入框 */
export function isDateInput(el) {
  return !!el && el.tagName === 'INPUT' && typeof el.type === 'string' && el.type.startsWith('date')
}

/**
 * 点一下就打开日期选择器。
 * showPicker() 在「已经打开」或「不是用户手势」时会抛错，所以吞掉即可 ——
 * 真出了异常就退回原生行为，至少右侧图标还能点。
 */
export function openDatePicker(e) {
  const el = e?.currentTarget || e?.target
  if (!isDateInput(el)) return
  if (typeof el.showPicker !== 'function') return
  try {
    el.showPicker()
  } catch {
    /* 已打开 / 非用户手势：交给原生兜底 */
  }
}
