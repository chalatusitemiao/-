<script setup>
/**
 * 录入 / 编辑一笔手工成本
 * ------------------------------------------------------------
 * 用途决定表单长什么样：
 *   车辆配件 / 车辆证件 → 出现「车辆」选择（必选）
 *   其他               → 不挂车，只剩金额 + 备注
 * 切换用途时会**清掉已选的车辆**，避免「其他」偷偷带着一个车辆 id 入库。
 */
import { computed, reactive, ref, watch } from 'vue'
import SheetModal from './SheetModal.vue'
import Icon from './Icon.vue'
import { COST_PURPOSES, needVehicle, purposeName } from '../data/costs.js'
import { vehicles } from '../store/vehicles.js'
import { validateCost, toCostPayload } from '../utils/costRules.js'
import { toISO } from '../utils/date.js'
import { openDatePicker } from '../utils/datePicker.js'
import { num } from '../utils/format.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  cost: { type: Object, default: null },
})
const emit = defineEmits(['close', 'saved'])

const isEdit = computed(() => !!props.cost)
const today = new Date()

const form = reactive({ date: '', purpose: '', vehicleId: '', amount: '', note: '' })
const errors = reactive({})
const warnings = reactive({})
const saving = ref(false)

function reset() {
  const c = props.cost
  form.date = c ? c.date : toISO(today)
  form.purpose = c ? c.purpose : ''
  form.vehicleId = c ? c.vehicleId || '' : ''
  form.amount = c ? String(c.amount ?? '') : ''
  form.note = c ? c.note || '' : ''
  Object.keys(errors).forEach((k) => delete errors[k])
  Object.keys(warnings).forEach((k) => delete warnings[k])
}
watch(() => [props.open, props.cost], reset, { immediate: true })

const picked = computed(() => vehicles.find((v) => v.id === form.vehicleId) || null)
const wantsVehicle = computed(() => needVehicle(form.purpose))

/** 换用途：不挂车的用途要把车辆清掉，否则会带着脏 id 入库 */
function pickPurpose(key) {
  if (form.purpose === key) return
  form.purpose = key
  if (!needVehicle(key)) form.vehicleId = ''
  run()
}

function run() {
  const r = validateCost(form, { today })
  Object.keys(errors).forEach((k) => delete errors[k])
  Object.keys(warnings).forEach((k) => delete warnings[k])
  Object.assign(errors, r.errors)
  Object.assign(warnings, r.warnings)
  return r
}
function onBlur() {
  run()
}
function onInput(k) {
  if (errors[k]) delete errors[k]
}

function submit() {
  const r = run()
  if (!r.ok) return
  saving.value = true
  emit('saved', { payload: toCostPayload(form), id: props.cost ? props.cost.id : null })
  saving.value = false
}

const purposeHint = computed(() => (form.purpose ? COST_PURPOSES.find((p) => p.key === form.purpose)?.hint || '' : ''))
</script>

<template>
  <SheetModal
    :open="open"
    :title="isEdit ? '编辑成本' : '添加成本'"
    @close="emit('close')"
  >
    <div v-if="!vehicles.length && wantsVehicle" class="note note--warn mb10">
      <Icon name="alert" :size="15" />
      <div>还没有车辆，请先到「车辆管理」录入车辆，才能把配件 / 证件费用挂到车上。</div>
    </div>

    <!-- 用途：先选它，它决定下面要填什么 -->
    <div class="field" :class="{ 'is-error': errors.purpose }">
      <label class="field__lb">用途<i>*</i></label>
      <div class="purposes">
        <button
          v-for="p in COST_PURPOSES"
          :key="p.key"
          type="button"
          class="purpose"
          :class="{ 'is-on': form.purpose === p.key }"
          @click="pickPurpose(p.key)"
        >
          <Icon :name="p.key === 'part' ? 'wrench' : p.key === 'doc' ? 'shield' : 'box'" :size="15" />
          <span class="purpose__t">{{ p.name }}</span>
          <span v-if="p.needVehicle" class="purpose__tag">挂车</span>
        </button>
      </div>
      <div v-if="errors.purpose" class="field__err"><Icon name="alert" :size="12" :sw="2.2" />{{ errors.purpose }}</div>
      <div v-else-if="purposeHint" class="hint">{{ purposeHint }}</div>
    </div>

    <div class="field-grid mt10">
      <div class="field" :class="{ 'is-error': errors.date }">
        <label class="field__lb">发生日期<i>*</i></label>
        <input v-model="form.date" class="input" type="date" :max="toISO(today)" @click="openDatePicker" @change="onBlur" @blur="onBlur" />
        <div v-if="errors.date" class="field__err"><Icon name="alert" :size="12" :sw="2.2" />{{ errors.date }}</div>
      </div>
      <div class="field" :class="{ 'is-error': errors.amount }">
        <label class="field__lb">金额<i>*</i></label>
        <span class="input-affix">
          <input v-model="form.amount" class="input input--num" type="number" inputmode="decimal" step="0.01" placeholder="0.00" @blur="onBlur" @input="onInput('amount')" />
          <span class="input-affix__u">元</span>
        </span>
        <div v-if="errors.amount" class="field__err"><Icon name="alert" :size="12" :sw="2.2" />{{ errors.amount }}</div>
      </div>
    </div>

    <!-- 挂车：只有配件 / 证件才出现 -->
    <div v-if="wantsVehicle" class="field mt10" :class="{ 'is-error': errors.vehicleId }">
      <label class="field__lb">挂到哪台车<i>*</i></label>
      <select v-model="form.vehicleId" class="input select" @change="onBlur">
        <option value="">请选择车辆</option>
        <option v-for="v in vehicles" :key="v.id" :value="v.id">{{ v.plate }}（{{ v.type }}）</option>
      </select>
      <div v-if="errors.vehicleId" class="field__err"><Icon name="alert" :size="12" :sw="2.2" />{{ errors.vehicleId }}</div>
      <div v-else-if="picked" class="hint">这笔会算进 {{ picked.plate }} 的{{ purposeName(form.purpose) }}成本</div>
      <div v-else class="hint">用途是「{{ purposeName(form.purpose) }}」，必须选一台车</div>
    </div>

    <div class="field mt10" :class="{ 'is-error': errors.note }">
      <label class="field__lb">备注</label>
      <input
        v-model="form.note"
        class="input"
        :placeholder="form.purpose === 'other' ? '这笔是什么支出？例如：仓库月租' : '选填，例如：四条轮胎'"
        @blur="onBlur"
        @input="onInput('note')"
      />
      <div v-if="errors.note" class="field__err"><Icon name="alert" :size="12" :sw="2.2" />{{ errors.note }}</div>
      <div v-else-if="warnings.note" class="hint hint--warn">{{ warnings.note }}</div>
    </div>

    <template #footer>
      <button class="btn btn--ghost" style="flex: 0 0 auto" @click="emit('close')">取消</button>
      <button class="btn btn--primary flex1" :disabled="saving" @click="submit">
        <Icon name="check" :size="15" :sw="2.4" />{{ isEdit ? '保存修改' : '保存成本' }}
      </button>
    </template>
  </SheetModal>
</template>

<style scoped>
.purposes {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}
.purpose {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 12px 6px 10px;
  border-radius: var(--r-md);
  border: 1.5px solid var(--line-2);
  background: var(--surface);
  color: var(--ink-2);
  transition: border-color var(--dur-1) var(--ease), background var(--dur-1) var(--ease),
    color var(--dur-1) var(--ease), transform var(--dur-1) var(--ease);
}
.purpose:hover {
  border-color: var(--line-strong);
  transform: translateY(-1px);
}
.purpose.is-on {
  border-color: var(--primary);
  background: var(--primary-soft);
  color: var(--primary);
}
.purpose__t {
  font-size: 12.5px;
  font-weight: 650;
  color: var(--ink);
}
.purpose.is-on .purpose__t {
  color: var(--primary);
}
.purpose__tag {
  font-size: 10px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: var(--r-pill);
  background: var(--surface-3);
  color: var(--ink-3);
}
.purpose.is-on .purpose__tag {
  background: rgba(79, 70, 229, 0.12);
  color: var(--primary);
}
@media (max-width: 380px) {
  .purposes {
    grid-template-columns: 1fr;
  }
  .purpose {
    flex-direction: row;
    justify-content: flex-start;
    padding: 11px 13px;
  }
  .purpose__tag {
    margin-left: auto;
  }
}
</style>
