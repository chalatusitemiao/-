/* ============================================================
   数字输入框的滚轮防护
   ------------------------------------------------------------
   type="number" 的输入框一旦获得焦点，鼠标滚轮经过就会直接改数值，
   而且没有任何提示 —— 用户往下滚页面时极容易把「载重 32」改成「31」。
   做法：在捕获阶段把焦点交出去，浏览器随后处理滚轮默认行为时
   输入框已经失焦，数值不会被改，页面照常滚动。

   抽成独立模块是为了能测：不用真的浏览器也能验证判断逻辑。
   ============================================================ */

/** 是否是「正在被滚轮误改」的数字输入框 */
export function isWheelEditable(el, activeElement) {
  return !!el && el.tagName === 'INPUT' && el.type === 'number' && el === activeElement
}

/**
 * 在 target 上安装全局防护（默认 document）。
 * 用全局监听而不是逐个加 @wheel，这样以后新增的输入框也自动生效。
 * @returns 卸载函数
 */
export function installWheelGuard(target) {
  if (!target || !target.addEventListener) return () => {}
  const handler = (e) => {
    if (isWheelEditable(e.target, target.activeElement)) e.target.blur()
  }
  target.addEventListener('wheel', handler, { capture: true, passive: true })
  return () => target.removeEventListener('wheel', handler, { capture: true })
}
