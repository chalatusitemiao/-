<script setup>
/**
 * 车辆信息录入 / 编辑
 * ------------------------------------------------------------
 * 前台可填 6 项：车牌号、车类型、载重、购置价格、购置日期、当前累计里程。
 * 车编号由系统自动分配，前台既不显示也不校验。
 * 其余字段（油耗基准、油箱、保养间隔…）按车型推导默认值。
 *
 * 校验规则和 Excel 导入共用 utils/vehicleRules.js，不会出现
 * 「表单拦住了、导入却放进去了」的不一致。
 */
import { computed, reactive, ref, watch } from 'vue'
import SheetModal from './SheetModal.vue'
import Icon from './Icon.vue'
import { profileOf } from '../data/vehicles.js'
import { FIELD_MAP, validateVehicle, toPayload } from '../utils/vehicleRules.js'
import { isPlateTaken } from '../store/vehicles.js'
import { toISO, parseDate } from '../utils/date.js'
import { openDatePicker } from '../utils/datePicker.js'
import { depreciation, DEP_YEARS, RESIDUAL_RATE } from '../utils/depreciation.js'
import { num, yuan } from '../utils/format.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  /** null = 新增；车辆对象 = 编辑 */
  vehicle: { type: Object, default: null },
})
const emit = defineEmits(['close', 'saved'])

const isEdit = computed(() => !!props.vehicle)
const F = FIELD_MAP
const today = new Date()

// 车类型不预填 —— 它是自由输入的，预填任何一个都会让「没注意改」的人
// 悄悄录成那个车型（原来预填 CAR_TYPES[0]，参数表一调顺序就变成皮卡了）
const form = reactive({ plate: '', type: '', tonnage: '', price: '', buyDate: '', odo: '' })
const errors = reactive({})
const warnings = reactive({})
const submitting = ref(false)

/* ---------------- 初始化 ---------------- */
function reset() {
  const v = props.vehicle
  form.plate = v ? v.plate : ''
  form.type = v ? v.type : ''
  form.tonnage = v ? String(v.tonnage ?? '') : ''
  form.price = v ? String(v.price ?? '') : ''
  // 新增时不预填今天 —— 车不一定是今天买的，预填反而容易被顺手存错
  form.buyDate = v ? v.buyDate || '' : ''
  form.odo = v ? String(v.odo ?? '') : ''
  Object.keys(errors).forEach((k) => delete errors[k])
  Object.keys(warnings).forEach((k) => delete warnings[k])
  submitting.value = false
}
watch(() => [props.open, props.vehicle], () => props.open && reset(), { immediate: true })

/* ---------------- 校验 ---------------- */
function run() {
  const { errors: e, warnings: w } = validateVehicle(form, {
    plateTaken: (p) => isPlateTaken(p, props.vehicle?.id),
    today,
  })
  Object.keys(errors).forEach((k) => delete errors[k])
  Object.keys(warnings).forEach((k) => delete warnings[k])
  Object.assign(errors, e)
  Object.assign(warnings, w)
  return Object.keys(e).length === 0
}

function onBlur() {
  run()
}
function onInput(k) {
  // 这块已经报过错，就实时重算，让用户看到错误消失
  if (errors[k] || warnings[k]) run()
}

/* ---------------- 折旧预览 ---------------- */
const dep = computed(() => {
  const price = Number(form.price)
  const d = parseDate(form.buyDate)
  if (!(price > 0) || !d || d > today) return null
  return depreciation(price, form.buyDate, today)
})
const priceText = computed(() => {
  const n = Number(form.price)
  return n >= 10000 ? `≈ ${(n / 10000).toFixed(1)} 万元` : n > 0 ? `≈ ${num(n)} 元` : ''
})

/** 车型提示：告诉用户这个写法落在了哪条油耗基准上（认不出来时走 warnings.type） */
const typeHint = computed(() => {
  const t = String(form.type || '').trim()
  if (!t) return ''
  const p = profileOf(t)
  if (p.matched === 'exact') return `油耗基准：空载 ${p.baseFuel} + 每吨 ${p.fuelPerTon} L/100km`
  if (p.matched === 'keyword') return `识别为「${p.matchedType}」档：空载 ${p.baseFuel} + 每吨 ${p.fuelPerTon} L/100km`
  return ''
})

/* ---------------- 提交 ---------------- */
function submit() {
  submitting.value = true
  if (!run()) {
    submitting.value = false
    return
  }
  emit('saved', toPayload(form))
}
</script>

<template>
  <SheetModal
    :open="open"
    :title="isEdit ? `编辑车辆 · ${vehicle?.plate || ''}` : '录入车辆信息'"
    @close="emit('close')"
  >
    <div v-if="!isEdit" class="note note--primary mb10">
      <Icon name="info" :size="15" />
      <div>
        填写这 <b>6 项</b>即可。油耗基准、油箱容量、保养间隔等参数会按车类型自动带上默认值。
      </div>
    </div>

    <!-- 车牌号 -->
    <div class="field" :class="{ 'is-error': errors.plate }">
      <label class="field__lb" for="vf-plate">{{ F.plate.label }}<i>*</i></label>
      <input
        id="vf-plate"
        v-model="form.plate"
        class="input"
        :placeholder="F.plate.placeholder"
        autocapitalize="characters"
        autocomplete="off"
        spellcheck="false"
        @blur="onBlur"
        @input="onInput('plate')"
      />
      <div v-if="errors.plate" class="field__err">
        <Icon name="alert" :size="12" :sw="2.2" />{{ errors.plate }}
      </div>
      <div v-else class="hint">{{ F.plate.hint }}</div>
    </div>

    <div class="field-grid">
      <!-- 车类型：纯输入框。
           原来是下拉，但车队里的车型列不全；后来挂了个 datalist 当建议，
           Chrome 下右侧仍会出现下拉箭头、看着还是像个下拉，所以干脆去掉，
           就是一个干净的输入框 —— 想写什么写什么。
           油耗基准靠下面的提示告诉用户，不需要建议列表。 -->
      <div class="field" :class="{ 'is-error': errors.type }">
        <label class="field__lb" for="vf-type">{{ F.type.label }}<i>*</i></label>
        <input
          id="vf-type"
          v-model="form.type"
          class="input"
          :placeholder="F.type.placeholder"
          autocomplete="off"
          @blur="onBlur"
          @input="onInput('type')"
        />
        <div v-if="errors.type" class="field__err">
          <Icon name="alert" :size="12" :sw="2.2" />{{ errors.type }}
        </div>
        <div v-else-if="warnings.type" class="hint hint--warn">{{ warnings.type }}</div>
        <div v-else-if="typeHint" class="hint">{{ typeHint }}</div>
        <div v-else class="hint">{{ F.type.hint }}</div>
      </div>

      <!-- 载重 -->
      <div class="field" :class="{ 'is-error': errors.tonnage }">
        <label class="field__lb" for="vf-ton">{{ F.tonnage.label }}<i>*</i></label>
        <span class="input-affix">
          <input
            id="vf-ton"
            v-model="form.tonnage"
            class="input input--num"
            type="number"
            inputmode="decimal"
            :step="F.tonnage.step"
            placeholder="0"
            @blur="onBlur"
            @input="onInput('tonnage')"
          />
          <span class="input-affix__u">{{ F.tonnage.unit }}</span>
        </span>
        <div v-if="errors.tonnage" class="field__err">
          <Icon name="alert" :size="12" :sw="2.2" />{{ errors.tonnage }}
        </div>
        <div v-else-if="warnings.tonnage" class="hint hint--warn">{{ warnings.tonnage }}</div>
      </div>

      <!-- 购置价格 -->
      <div class="field" :class="{ 'is-error': errors.price }">
        <label class="field__lb" for="vf-price">{{ F.price.label }}<i>*</i></label>
        <span class="input-affix">
          <input
            id="vf-price"
            v-model="form.price"
            class="input input--num"
            type="number"
            inputmode="decimal"
            :step="F.price.step"
            placeholder="0"
            @blur="onBlur"
            @input="onInput('price')"
          />
          <span class="input-affix__u">{{ F.price.unit }}</span>
        </span>
        <div v-if="errors.price" class="field__err">
          <Icon name="alert" :size="12" :sw="2.2" />{{ errors.price }}
        </div>
        <div v-else-if="priceText" class="hint">{{ priceText }}</div>
      </div>

      <!-- 购置日期：原生日期选择器 -->
      <div class="field" :class="{ 'is-error': errors.buyDate }">
        <label class="field__lb" for="vf-buydate">{{ F.buyDate.label }}<i>*</i></label>
        <input
          id="vf-buydate"
          v-model="form.buyDate"
          class="input"
          type="date"
          min="1990-01-01"
          :max="toISO(today)"
          @click="openDatePicker"
          @input="onInput('buyDate')"
          @change="onBlur"
          @blur="onBlur"
        />
        <div v-if="errors.buyDate" class="field__err">
          <Icon name="alert" :size="12" :sw="2.2" />{{ errors.buyDate }}
        </div>
        <div v-else-if="warnings.buyDate" class="hint hint--warn">{{ warnings.buyDate }}</div>
        <div v-else class="hint">按 {{ DEP_YEARS }} 年直线法计提折旧，不能晚于今天</div>
      </div>
    </div>

    <!-- 当前累计里程 -->
    <div class="field" :class="{ 'is-error': errors.odo }">
      <label class="field__lb" for="vf-odo">{{ F.odo.label }}<i>*</i></label>
      <span class="input-affix">
        <input
          id="vf-odo"
          v-model="form.odo"
          class="input input--num"
          type="number"
          inputmode="numeric"
          :step="F.odo.step"
          placeholder="0"
          @blur="onBlur"
          @input="onInput('odo')"
        />
        <span class="input-affix__u">{{ F.odo.unit }}</span>
      </span>
      <div v-if="errors.odo" class="field__err">
        <Icon name="alert" :size="12" :sw="2.2" />{{ errors.odo }}
      </div>
      <div v-else class="hint">{{ F.odo.hint }}</div>
    </div>

    <!-- 折旧预览 -->
    <div v-if="dep" class="depbox">
      <div class="depbox__h">
        <Icon name="cost" :size="15" />
        <span>按 {{ DEP_YEARS }} 年直线法折旧（残值 {{ Math.round(RESIDUAL_RATE * 100) }}%）</span>
        <span v-if="dep.fully" class="pill pill--fix">已提足</span>
      </div>
      <div class="depbox__g">
        <div>
          <div class="depbox__l">月折旧</div>
          <div class="depbox__v">{{ yuan(dep.monthly) }}</div>
        </div>
        <div>
          <div class="depbox__l">已使用</div>
          <div class="depbox__v">{{ dep.ageYears }} 年</div>
        </div>
        <div>
          <div class="depbox__l">当前净值</div>
          <div class="depbox__v">{{ yuan(dep.netBookValue) }}</div>
        </div>
      </div>
    </div>

    <div v-if="isEdit" class="note">
      <Icon name="info" :size="15" />
      <div>车辆状态与定位由调度和车载设备同步，不在这里维护。</div>
    </div>

    <template #footer>
      <button class="btn btn--ghost" style="flex: 0 0 auto" @click="emit('close')">取消</button>
      <button class="btn btn--primary flex1" :disabled="submitting" @click="submit">
        <Icon name="check" :size="15" :sw="2.4" />{{ isEdit ? '保存修改' : '保存车辆' }}
      </button>
    </template>
  </SheetModal>
</template>

<style scoped>
/* —— 折旧预览 —— */
.depbox {
  margin-top: 4px;
  padding: 13px 14px;
  border-radius: var(--r-md);
  background: var(--surface-3);
  border: 1px solid var(--line);
}
.depbox__h {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--ink-2);
}
.depbox__h svg {
  color: var(--ink-3);
}
.depbox__h .pill {
  margin-left: auto;
}
.depbox__g {
  margin-top: 11px;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}
.depbox__g > div {
  min-width: 0;
}
.depbox__l {
  font-size: 11.5px;
  color: var(--ink-3);
}
.depbox__v {
  margin-top: 3px;
  font-size: 15px;
  font-weight: 680;
  color: var(--ink);
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}
</style>
