<script setup>
/**
 * 路线录入 / 编辑
 * ------------------------------------------------------------
 * 起点、终点、公里数，加上途经收费站。
 * 每个收费站的价格是**一行行「车型 + 金额」** —— 同一个站，
 * 皮卡和自卸车不是一个价，所以按车型分别记。
 *
 * 车型下拉来自**车辆管理里实际有的车型**（车辆一辆都没录时退回基准表），
 * 所以只给自己有的车填价，不用在一堆用不上的车型里划过去。
 *
 * 填的价格跟主表单一起保存（只有一个「保存」），取消不影响原数据。
 */
import { computed, reactive, ref, watch } from 'vue'
import SheetModal from './SheetModal.vue'
import Icon from './Icon.vue'
import { ROUTE_FIELDS, ROUTE_FIELD_MAP, validateRoute, toRoutePayload, normPlace } from '../utils/routeRules.js'
import { isRouteTaken } from '../store/routes.js'
import { typeOptions, usingFallbackTypes } from '../store/vehicles.js'
import { num } from '../utils/format.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  /** null = 新增；路线对象 = 编辑 */
  route: { type: Object, default: null },
})
const emit = defineEmits(['close', 'saved'])

const isEdit = computed(() => !!props.route)
const F = ROUTE_FIELD_MAP

const form = reactive({ from: '', to: '', distance: '', tolls: [] })
const errors = reactive({})
const warnings = reactive({})
const saving = ref(false)

/** 车型下拉的选项：车队里实际有的车型。
    还要并上这条路线里已经写过的车型 —— 否则删了某台车之后，
    老路线里那个车型在下拉里没有对应项，会显示成空白。 */
const typeOpts = computed(() => {
  const base = typeOptions()
  const extra = new Set()
  for (const t of form.tolls) {
    for (const r of t.rows) if (r.type && !base.includes(r.type)) extra.add(r.type)
  }
  return extra.size ? base.concat([...extra].sort((a, b) => a.localeCompare(b, 'zh'))) : base
})
const fallbackTypes = computed(() => usingFallbackTypes())

let seq = 0
const nextId = (p) => p + ++seq

/** 表单里一行价格：车型 + 金额（存库时再压成 {车型: 金额}） */
const blankRow = () => ({ id: nextId('row_'), type: '', amount: '' })
const blankToll = () => ({ id: nextId('tol_'), station: '', rows: [blankRow()] })

/** {车型: 金额} → 行数组（编辑时回填） */
const pricesToRows = (prices) =>
  Object.entries(prices || {}).map(([type, amount]) => ({ id: nextId('row_'), type, amount: String(amount) }))

/** 行数组 → {车型: 金额}（空行与 0 都不写） */
function rowsToPrices(rows) {
  const out = {}
  for (const r of rows) {
    const raw = String(r.amount ?? '').trim()
    const n = Number(raw)
    if (r.type && raw !== '' && Number.isFinite(n) && n > 0) out[r.type] = n
  }
  return out
}

/** 校验与提交都吃「prices」形态，所以这里把行先压成 prices */
const withPrices = () => ({
  ...form,
  tolls: form.tolls.map((t) => ({ id: t.id, station: t.station, prices: rowsToPrices(t.rows) })),
})

function reset() {
  const r = props.route
  form.from = r ? r.from : ''
  form.to = r ? r.to : ''
  form.distance = r ? String(r.distance ?? '') : ''
  form.tolls = r
    ? r.tolls.map((t) => ({ id: t.id, station: t.station, rows: pricesToRows(t.prices) }))
    : []
  Object.keys(errors).forEach((k) => delete errors[k])
  Object.keys(warnings).forEach((k) => delete warnings[k])
  saving.value = false
}
watch(() => [props.open, props.route], () => props.open && reset(), { immediate: true })

/* ---------------- 校验 ---------------- */
function run() {
  const { errors: e, warnings: w } = validateRoute(withPrices(), {
    selfKey: props.route ? `${normPlace(props.route.from)}→${normPlace(props.route.to)}` : '',
  })
  // 起终点重复：用 store 的索引判断，编辑时排除自己
  if (!e.from && !e.to && isRouteTaken(form.from, form.to, props.route?.id)) {
    e.to = '这条路线（起点+终点）已经录入过了'
  }
  Object.keys(errors).forEach((k) => delete errors[k])
  Object.keys(warnings).forEach((k) => delete warnings[k])
  Object.assign(errors, e)
  Object.assign(warnings, w)
  return Object.keys(e).length === 0
}
const onBlur = () => run()
function onInput(k) {
  if (errors[k] || warnings[k]) run()
}

/* ---------------- 收费站 ---------------- */
function addToll() {
  form.tolls.push(blankToll())
}
function removeToll(id) {
  const i = form.tolls.findIndex((t) => t.id === id)
  if (i >= 0) form.tolls.splice(i, 1)
  run()
}
function addRow(t) {
  t.rows.push(blankRow())
}
function removeRow(t, ri) {
  t.rows.splice(ri, 1)
  run()
}

/** 同一个收费站里选了同一个车型两次 —— 压成 map 会悄悄合并，所以直接拦下 */
function dupErr(t) {
  const seen = new Set()
  for (const r of t.rows) {
    if (!r.type) continue
    if (seen.has(r.type)) return `这个收费站里「${r.type}」填了两次，请合并成一行`
    seen.add(r.type)
  }
  return ''
}

/** 取某个收费站里某一行对应的校验错误 */
function incErr(t, row) {
  if (!row.type) return ''
  return errors.tolls?.[t.id]?.['price_' + row.type] || ''
}

/** 按车型汇总本路线的总过路费 */
const totalsByType = computed(() => {
  const totals = new Map()
  for (const t of form.tolls) {
    for (const r of t.rows) {
      const n = Number(r.amount)
      if (r.type && Number.isFinite(n) && n > 0) totals.set(r.type, (totals.get(r.type) || 0) + n)
    }
  }
  return [...totals.entries()].map(([type, total]) => ({ type, total })).sort((a, b) => b.total - a.total)
})

/* ---------------- 提交 ---------------- */
function submit() {
  saving.value = true
  if (!run()) {
    saving.value = false
    return
  }
  emit('saved', toRoutePayload(withPrices()))
}
</script>

<template>
  <SheetModal
    :open="open"
    :title="isEdit ? `编辑路线 · ${route?.from} → ${route?.to}` : '录入路线'"
    @close="emit('close')"
  >
    <div v-if="!isEdit" class="note note--primary mb10">
      <Icon name="info" :size="15" />
      <div>
        站点价格<b>一行一个「车型 + 金额」</b>：柴油皮卡和 30 吨自卸车过同一个收费站，价差能有好几倍。
        车型下拉取自<b>车辆管理里已录入的车型</b>，所以只给自己有的车填价。
        没填的车型视作不走这个站。
        <template v-if="fallbackTypes"><br /><b>车辆管理里还没有车辆</b>，先按常用车型列出。</template>
      </div>
    </div>

    <div class="field-grid">
      <div class="field" :class="{ 'is-error': errors.from }">
        <label class="field__lb" for="rf-from">{{ F.from.label }}<i>*</i></label>
        <input id="rf-from" v-model="form.from" class="input" :placeholder="F.from.placeholder" @blur="onBlur" @input="onInput('from')" />
        <div v-if="errors.from" class="field__err"><Icon name="alert" :size="12" :sw="2.2" />{{ errors.from }}</div>
      </div>
      <div class="field" :class="{ 'is-error': errors.to }">
        <label class="field__lb" for="rf-to">{{ F.to.label }}<i>*</i></label>
        <input id="rf-to" v-model="form.to" class="input" :placeholder="F.to.placeholder" @blur="onBlur" @input="onInput('to')" />
        <div v-if="errors.to" class="field__err"><Icon name="alert" :size="12" :sw="2.2" />{{ errors.to }}</div>
      </div>
    </div>

    <div class="field" :class="{ 'is-error': errors.distance }">
      <label class="field__lb" for="rf-km">{{ F.distance.label }}<i>*</i></label>
      <span class="input-affix">
        <input id="rf-km" v-model="form.distance" class="input input--num" type="number" inputmode="decimal" :placeholder="F.distance.placeholder" @blur="onBlur" @input="onInput('distance')" />
        <span class="input-affix__u">{{ F.distance.unit }}</span>
      </span>
      <div v-if="errors.distance" class="field__err"><Icon name="alert" :size="12" :sw="2.2" />{{ errors.distance }}</div>
      <div v-else class="hint">单程公里数，录入趟次时会带出来</div>
    </div>

    <!-- ============ 收费站 ============ -->
    <div class="inc">
      <div class="inc__hd">
        <Icon name="toll" :size="15" />
        <span>途经收费站</span>
        <span v-if="form.tolls.length" class="inc__sum">{{ form.tolls.length }} 个</span>
      </div>

      <div v-if="!form.tolls.length" class="inc__empty">还没有收费站，点下面的按钮添加</div>

      <!-- 车型价格：一行「车型 + 金额」。车型下拉来自车辆管理里实际有的车型，
           所以只给你自己有的车填价，不用在 9 个用不上的车型里划过去。 -->
      <div v-for="(t, i) in form.tolls" :key="t.id" class="toll">
        <div class="toll__hd">
          <span class="toll__no">{{ i + 1 }}</span>
          <input v-model="t.station" class="input toll__name" placeholder="收费站名称，如 苏州新区" />
          <button class="toll__del" @click="removeToll(t.id)"><Icon name="close" :size="12" :sw="2.2" />删除</button>
        </div>

        <div v-if="t.rows.length" class="plist">
          <div v-for="(row, ri) in t.rows" :key="row.id" class="prow" :class="{ 'is-error': incErr(t, row) }">
            <select v-model="row.type" class="input select prow__type">
              <option value="">选择车型</option>
              <option v-for="o in typeOpts" :key="o" :value="o">{{ o }}</option>
            </select>
            <span class="input-affix prow__amt">
              <input v-model="row.amount" class="input input--num" type="number" inputmode="decimal" placeholder="0" />
              <span class="input-affix__u">元</span>
            </span>
            <button class="prow__del" aria-label="删除这一行" @click="removeRow(t, ri)">
              <Icon name="close" :size="12" :sw="2.2" />
            </button>
          </div>
        </div>
        <div v-else class="toll__empty">还没填价格，点下面「添加车型价格」</div>

        <div v-if="dupErr(t)" class="field__err" style="margin-top: 8px">
          <Icon name="alert" :size="12" :sw="2.2" />{{ dupErr(t) }}
        </div>

        <button class="btn btn--ghost btn--sm mt10" @click="addRow(t)">
          <Icon name="plus" :size="13" :sw="2.3" />添加车型价格
        </button>
      </div>

      <button class="btn btn--ghost btn--block mt10" @click="addToll">
        <Icon name="plus" :size="14" :sw="2.3" />添加收费站
      </button>

      <div v-if="totalsByType.length" class="totals">
        <div class="totals__t">本路线总过路费（按车型）</div>
        <div class="totals__g">
          <span v-for="x in totalsByType" :key="x.type" class="totals__i">
            {{ x.type }} <b>¥{{ num(x.total) }}</b>
          </span>
        </div>
      </div>
    </div>

    <template #footer>
      <button class="btn btn--ghost" style="flex: 0 0 auto" @click="emit('close')">取消</button>
      <button class="btn btn--primary flex1" :disabled="saving" @click="submit">
        <Icon name="check" :size="15" :sw="2.4" />{{ isEdit ? '保存修改' : '保存路线' }}
      </button>
    </template>
  </SheetModal>
</template>

<style scoped>
.inc {
  margin-top: 6px;
  padding: 13px 14px;
  border-radius: var(--r-md);
  background: var(--surface-3);
  border: 1px solid var(--line);
}
.inc__hd {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12.5px;
  font-weight: 650;
  color: var(--ink-2);
}
.inc__hd svg {
  color: var(--primary);
}
.inc__sum {
  margin-left: auto;
  font-size: 11.5px;
  font-weight: 550;
  color: var(--ink-3);
}
.inc__empty {
  margin-top: 10px;
  font-size: 12px;
  color: var(--ink-3);
}

.toll {
  margin-top: 11px;
  padding: 11px 12px;
  border-radius: var(--r-sm);
  background: var(--surface);
  border: 1px solid var(--line-2);
  min-width: 0;
}
.toll__hd {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
}
.toll__no {
  flex: 0 0 auto;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-size: 10.5px;
  font-weight: 650;
  background: var(--surface-3);
  color: var(--ink-2);
}
.toll__name {
  min-width: 0;
  padding: 7px 9px;
  font-size: 13.5px;
}
.toll__del {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--red);
  opacity: 0.85;
}
.toll__del:hover {
  opacity: 1;
  text-decoration: underline;
}
.toll__empty {
  margin-top: 10px;
  font-size: 11.5px;
  color: var(--ink-4);
}

/* —— 车型 + 金额 的行 —— */
.plist {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.prow {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr) 26px;
  align-items: center;
  gap: 7px;
  min-width: 0;
}
.prow__type {
  min-width: 0;
  padding: 7px 9px;
  font-size: 13px;
  padding-right: 26px;
}
.prow__amt {
  min-width: 0;
}
.prow__amt .input {
  padding: 7px 34px 7px 9px;
  font-size: 13px;
  text-align: right;
}
.prow__del {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  color: var(--ink-3);
  background: var(--surface-3);
  flex: 0 0 auto;
}
.prow__del:hover {
  color: var(--red);
  background: var(--red-soft, var(--surface-3));
}
.prow.is-error .prow__type,
.prow.is-error .input {
  border-color: var(--red);
}

.totals {
  margin-top: 12px;
  padding-top: 11px;
  border-top: 1px dashed var(--line-2);
}
.totals__t {
  font-size: 11.5px;
  color: var(--ink-3);
}
.totals__g {
  margin-top: 7px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.totals__i {
  padding: 3px 8px;
  border-radius: var(--r-pill);
  font-size: 11.5px;
  background: var(--primary-soft);
  color: var(--primary-ink, var(--primary));
}
.totals__i b {
  font-variant-numeric: tabular-nums;
}
</style>
