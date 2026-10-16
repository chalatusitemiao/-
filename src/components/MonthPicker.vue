<script setup>
/**
 * 月份选择器
 * ------------------------------------------------------------
 * 「自由选择月份」的需求：中间是原生 month 输入框，任何年月都能直接选，
 * 两边是前后翻月，另有「本月」快捷按钮。
 *
 * allowAll 打开时多一个「全部」选项 —— 收入页需要它（想看总共还有多少没收），
 * 成本页不需要（折旧与人工本来就是按月计提的，没有「全部」这个口径）。
 *
 * monthsWithData 用来在翻月时提示「这个月没有数据」，避免用户以为页面坏了。
 */
import { computed, watch } from 'vue'
import Icon from './Icon.vue'
import { openDatePicker } from '../utils/datePicker.js'
import { currentMonth, clampMonth, isFutureMonth } from '../utils/date.js'

const props = defineProps({
  /** 'YYYY-MM'，或 allowAll 时的 'all' */
  modelValue: { type: String, default: '' },
  allowAll: { type: Boolean, default: false },
  /** 有数据的月份列表，用于「本月有数据吗」的提示 */
  monthsWithData: { type: Array, default: () => [] },
  /** 成本页用「成本」，收入页用「运费」 */
  noun: { type: String, default: '数据' },
})
const emit = defineEmits(['update:modelValue'])

const isAll = computed(() => props.modelValue === 'all')
const thisMonth = currentMonth()

/**
 * 封顶到当月。
 * 未来的月份不该能选到 —— 折旧不会提前计提、趟次和成本也不许填未来日期，
 * 所以那些月份永远是空的；能选过去只会让人以为「数据丢了」。
 */
const atMax = computed(() => !isAll.value && String(props.modelValue) >= thisMonth)

// 不管这个值从哪来（hash、旧状态），只要落在未来就拉回当月
watch(
  () => props.modelValue,
  (v) => {
    if (isFutureMonth(v)) emit('update:modelValue', thisMonth)
  },
  { immediate: true }
)

const label = computed(() => {
  if (isAll.value) return '全部月份'
  const [y, m] = String(props.modelValue).split('-')
  if (!y || !m) return '选择月份'
  return `${y} 年 ${Number(m)} 月`
})

/** 有数据的月份集合 —— 翻月时给个小圆点提示 */
const hasData = computed(() => new Set(props.monthsWithData))
const currentHasData = computed(() => !isAll.value && hasData.value.has(props.modelValue))

function shift(delta) {
  // next 到当月为止，不许再往后
  if (delta > 0 && atMax.value) return
  const [y, m] = String(props.modelValue || thisMonth).split('-').map(Number)
  if (!y || !m) return
  const d = new Date(y, m - 1 + delta, 1)
  emit('update:modelValue', clampMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`))
}
function setMonth(v) {
  if (!v) return
  emit('update:modelValue', clampMonth(String(v).slice(0, 7)))
}
function goThisMonth() {
  emit('update:modelValue', thisMonth)
}
function pickAll() {
  emit('update:modelValue', 'all')
}
</script>

<template>
  <div class="mp">
    <button v-if="!isAll" class="mp__nav" aria-label="上一个月" @click="shift(-1)">
      <Icon name="chevL" :size="15" :sw="2.2" />
    </button>

    <label class="mp__field" :class="{ 'has-data': currentHasData }">
      <Icon name="calendar" :size="14" />
      <span class="mp__label">{{ label }}</span>
      <input
        class="mp__input"
        type="month"
        :value="isAll ? '' : modelValue"
        :max="thisMonth"
        aria-label="选择月份"
        @click="openDatePicker"
        @change="setMonth($event.target.value)"
      />
    </label>

    <button
      v-if="!isAll"
      class="mp__nav"
      :disabled="atMax"
      :aria-disabled="atMax || undefined"
      :title="atMax ? '已经是最新的月份了' : '下一个月'"
      :aria-label="atMax ? '已到当月，不能再看未来' : '下一个月'"
      @click="shift(1)"
    >
      <Icon name="chevR" :size="15" :sw="2.2" />
    </button>

    <button class="mp__quick" :class="{ 'is-on': modelValue === thisMonth }" @click="goThisMonth">本月</button>
    <button v-if="allowAll" class="mp__quick" :class="{ 'is-on': isAll }" @click="pickAll">全部</button>

    <span v-if="!isAll && !currentHasData" class="mp__empty">这个月没有{{ noun }}</span>
  </div>
</template>

<style scoped>
.mp {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  min-width: 0;
}
.mp__nav {
  flex: 0 0 auto;
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border-radius: var(--r-sm);
  border: 1px solid var(--line-2);
  background: var(--surface);
  color: var(--ink-2);
  transition: border-color var(--dur-1) var(--ease), background var(--dur-1) var(--ease);
}
.mp__nav:hover {
  border-color: var(--line-strong);
  background: var(--surface-hover);
}
/* 到当月就不能再往后：变灰 + 禁用指针，鼠标悬停不再是按钮那种反馈 */
.mp__nav:disabled {
  opacity: 0.38;
  cursor: not-allowed;
}
.mp__nav:disabled:hover {
  border-color: var(--line-2);
  background: var(--surface);
}
/* 输入框铺满整块：点哪儿都能弹出原生月份选择器 */
.mp__field {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 34px;
  padding: 0 12px;
  border-radius: var(--r-sm);
  border: 1px solid var(--line-2);
  background: var(--surface);
  color: var(--ink);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  min-width: 0;
  font-variant-numeric: tabular-nums;
}
.mp__field:hover {
  border-color: var(--line-strong);
}
.mp__field.has-data {
  border-color: var(--primary);
  background: var(--primary-soft);
  color: var(--primary);
}
.mp__label {
  white-space: nowrap;
}
/* 真正的 input 盖在上面但完全透明 —— 借用它的原生弹层 */
.mp__input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
  border: 0;
  padding: 0;
  background: transparent;
}
.mp__quick {
  flex: 0 0 auto;
  height: 34px;
  padding: 0 12px;
  border-radius: var(--r-sm);
  border: 1px solid var(--line-2);
  background: var(--surface);
  color: var(--ink-2);
  font-size: 12.5px;
  font-weight: 600;
  transition: border-color var(--dur-1) var(--ease), background var(--dur-1) var(--ease),
    color var(--dur-1) var(--ease);
}
.mp__quick:hover {
  border-color: var(--line-strong);
}
.mp__quick.is-on {
  border-color: var(--primary);
  background: var(--primary-soft);
  color: var(--primary);
}
.mp__empty {
  font-size: 11.5px;
  color: var(--ink-3);
  margin-left: 2px;
}
</style>
