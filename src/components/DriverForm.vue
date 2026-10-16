<script setup>
/**
 * 司机录入 / 编辑
 * ------------------------------------------------------------
 * 上半部分是可上传的四个字段：姓名、手机号、入职日期、驾驶证号。
 * 下半部分是事故/违章子列表（发生时间、事件描述、经济损失）——
 * 这三项按需求不能从表格导入，只能在编辑态一条条手工添加，
 * 所以它们跟着主表单一起保存（而不是每行单独提交），只有一个「保存修改」。
 *
 * 当月创收/里程/油耗电耗是自动统计字段，表单里不出现。
 */
import { computed, reactive, ref, watch } from 'vue'
import SheetModal from './SheetModal.vue'
import Icon from './Icon.vue'
import { UPLOAD_FIELDS, FIELD_MAP, INCIDENT_FIELDS, validateDriver, toDriverPayload, validateIncident, toIncidentPayload } from '../utils/driverRules.js'
import { isPhoneTaken, isLicenseTaken } from '../store/drivers.js'
import { toISO } from '../utils/date.js'
import { openDatePicker } from '../utils/datePicker.js'
import { num, yuan } from '../utils/format.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  /** null = 新增；司机对象 = 编辑 */
  driver: { type: Object, default: null },
})
const emit = defineEmits(['close', 'saved'])

const isEdit = computed(() => !!props.driver)
const F = FIELD_MAP
const IF = Object.fromEntries(INCIDENT_FIELDS.map((f) => [f.key, f]))
const today = new Date()

const form = reactive({ name: '', phone: '', hireDate: '', licenseNo: '', salary: '' })
const errors = reactive({})
const warnings = reactive({})
const incidents = ref([])
const incErrors = reactive({}) // incident.id → { date, desc, loss }
const saving = ref(false)

/* ---------------- 初始化 ---------------- */
function reset() {
  const d = props.driver
  form.name = d ? d.name : ''
  form.phone = d ? d.phone : ''
  form.hireDate = d ? d.hireDate || '' : ''
  form.licenseNo = d ? d.licenseNo || '' : ''
  form.salary = d && d.salary ? String(d.salary) : ''
  // 本地草稿：改完一起提交，取消就不影响原数据
  incidents.value = d ? (d.incidents || []).map((i) => ({ ...i })) : []
  Object.keys(errors).forEach((k) => delete errors[k])
  Object.keys(warnings).forEach((k) => delete warnings[k])
  Object.keys(incErrors).forEach((k) => delete incErrors[k])
  saving.value = false
}
watch(() => [props.open, props.driver], () => props.open && reset(), { immediate: true })

/* ---------------- 主字段校验 ---------------- */
function run() {
  const { errors: e, warnings: w } = validateDriver(form, {
    phoneTaken: (p) => isPhoneTaken(p, props.driver?.id),
    licenseTaken: (n) => isLicenseTaken(n, props.driver?.id),
    today,
  })
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

/* ---------------- 事故 / 违章 ---------------- */
let seq = 0
function addRow() {
  incidents.value.unshift({ id: 'new_' + ++seq, date: '', desc: '', loss: '' })
}
function removeRow(id) {
  const i = incidents.value.findIndex((x) => x.id === id)
  if (i >= 0) incidents.value.splice(i, 1)
  delete incErrors[id]
}
/** 整行都空 —— 点「添加一条」又没填的，保存时直接丢掉，不该拦住用户 */
const isBlankRow = (inc) =>
  !String(inc.date || '').trim() && !String(inc.desc || '').trim() && String(inc.loss ?? '').trim() === ''

function runIncidents() {
  Object.keys(incErrors).forEach((k) => delete incErrors[k])
  let ok = true
  for (const inc of incidents.value) {
    if (isBlankRow(inc)) continue
    const { errors: e } = validateIncident(inc, { today })
    if (Object.keys(e).length) {
      incErrors[inc.id] = e
      ok = false
    }
  }
  return ok
}

const filled = computed(() => incidents.value.filter((i) => !isBlankRow(i)))
const incSummary = computed(() => ({
  count: filled.value.length,
  loss: filled.value.reduce((a, x) => a + (Number(x.loss) || 0), 0),
}))

/* ---------------- 提交 ---------------- */
function submit() {
  saving.value = true
  const okMain = run()
  const okInc = runIncidents()
  if (!okMain || !okInc) {
    saving.value = false
    return
  }
  const payload = toDriverPayload(form)
  if (isEdit.value) payload.incidents = filled.value.map(toIncidentPayload)
  emit('saved', payload)
}
</script>

<template>
  <SheetModal
    :open="open"
    :title="isEdit ? `编辑司机 · ${driver?.name || ''}` : '录入司机信息'"
    @close="emit('close')"
  >
    <div v-if="!isEdit" class="note note--primary mb10">
      <Icon name="info" :size="15" />
      <div>
        填写这 <b>4 项</b>即可（驾驶证号选填）。
        当月创收 / 里程 / 油耗电耗由运营流水自动统计，不需要填。
      </div>
    </div>

    <div class="field-grid">
      <!-- 姓名 -->
      <div class="field" :class="{ 'is-error': errors.name }">
        <label class="field__lb" for="df-name">{{ F.name.label }}<i>*</i></label>
        <input
          id="df-name"
          v-model="form.name"
          class="input"
          :placeholder="F.name.placeholder"
          autocomplete="off"
          @blur="onBlur"
          @input="onInput('name')"
        />
        <div v-if="errors.name" class="field__err">
          <Icon name="alert" :size="12" :sw="2.2" />{{ errors.name }}
        </div>
      </div>

      <!-- 手机号（主键） -->
      <div class="field" :class="{ 'is-error': errors.phone }">
        <label class="field__lb" for="df-phone">{{ F.phone.label }}<i>*</i></label>
        <input
          id="df-phone"
          v-model="form.phone"
          class="input input--num"
          type="tel"
          inputmode="numeric"
          
          :placeholder="F.phone.placeholder"
          autocomplete="off"
          @blur="onBlur"
          @input="onInput('phone')"
        />
        <div v-if="errors.phone" class="field__err">
          <Icon name="alert" :size="12" :sw="2.2" />{{ errors.phone }}
        </div>
        <div v-else class="hint">{{ F.phone.hint }}</div>
      </div>

      <!-- 入职日期 -->
      <div class="field" :class="{ 'is-error': errors.hireDate }">
        <label class="field__lb" for="df-hire">{{ F.hireDate.label }}<i>*</i></label>
        <input
          id="df-hire"
          v-model="form.hireDate"
          class="input"
          type="date"
          min="1990-01-01"
          :max="toISO(today)"
          @click="openDatePicker"
          @change="onBlur"
          @blur="onBlur"
        />
        <div v-if="errors.hireDate" class="field__err">
          <Icon name="alert" :size="12" :sw="2.2" />{{ errors.hireDate }}
        </div>
        <div v-else-if="warnings.hireDate" class="hint hint--warn">{{ warnings.hireDate }}</div>
        <div v-else class="hint">{{ F.hireDate.hint }}</div>
      </div>

      <!-- 驾驶证号（选填） -->
      <div class="field" :class="{ 'is-error': errors.licenseNo }">
        <label class="field__lb" for="df-lic">{{ F.licenseNo.label }}</label>
        <input
          id="df-lic"
          v-model="form.licenseNo"
          class="input input--num"
          :placeholder="F.licenseNo.placeholder"
          autocapitalize="characters"
          autocomplete="off"
          spellcheck="false"
          @blur="onBlur"
          @input="onInput('licenseNo')"
        />
        <div v-if="errors.licenseNo" class="field__err">
          <Icon name="alert" :size="12" :sw="2.2" />{{ errors.licenseNo }}
        </div>
        <div v-else-if="warnings.licenseNo" class="hint hint--warn">{{ warnings.licenseNo }}</div>
        <div v-else class="hint">{{ F.licenseNo.hint }}</div>
      </div>

      <!-- 工资（选填） -->
      <div class="field" :class="{ 'is-error': errors.salary }">
        <label class="field__lb" for="df-salary">{{ F.salary.label }}</label>
        <span class="input-affix">
          <input
            id="df-salary"
            v-model="form.salary"
            class="input input--num"
            type="number"
            inputmode="decimal"
            :placeholder="F.salary.placeholder"
            @blur="onBlur"
            @input="onInput('salary')"
          />
          <span class="input-affix__u">{{ F.salary.unit }}</span>
        </span>
        <div v-if="errors.salary" class="field__err">
          <Icon name="alert" :size="12" :sw="2.2" />{{ errors.salary }}
        </div>
        <div v-else-if="warnings.salary" class="hint hint--warn">{{ warnings.salary }}</div>
        <div v-else class="hint">{{ F.salary.hint }}</div>
      </div>
    </div>

    <!-- ============ 事故 / 违章 ============ -->
    <div class="inc">
      <div class="inc__hd">
        <Icon name="alert" :size="15" />
        <span class="inc__ttl">事故 / 违章记录</span>
        <span v-if="incSummary.count" class="inc__sum">
          {{ incSummary.count }} 条 · 共 {{ yuan(incSummary.loss) }}
        </span>
      </div>

      <template v-if="isEdit">
        <div v-if="!incidents.length" class="inc__empty">还没有记录</div>

        <div v-for="(inc, i) in incidents" :key="inc.id" class="inc__row">
          <div class="inc__rowhd">
            <span class="inc__no">第 {{ i + 1 }} 条</span>
            <button class="inc__del" @click="removeRow(inc.id)">
              <Icon name="close" :size="12" :sw="2.2" />删除
            </button>
          </div>
          <div class="field-grid">
            <div class="field" :class="{ 'is-error': incErrors[inc.id]?.date }">
              <label class="field__lb">{{ IF.date.label }}<i>*</i></label>
              <input v-model="inc.date" class="input" type="date" min="2000-01-01" @click="openDatePicker" />
              <div v-if="incErrors[inc.id]?.date" class="field__err">
                <Icon name="alert" :size="12" :sw="2.2" />{{ incErrors[inc.id].date }}
              </div>
            </div>
            <div class="field" :class="{ 'is-error': incErrors[inc.id]?.loss }">
              <label class="field__lb">{{ IF.loss.label }}<i>*</i></label>
              <span class="input-affix">
                <input v-model="inc.loss" class="input input--num" type="number" inputmode="decimal" placeholder="0" />
                <span class="input-affix__u">{{ IF.loss.unit }}</span>
              </span>
              <div v-if="incErrors[inc.id]?.loss" class="field__err">
                <Icon name="alert" :size="12" :sw="2.2" />{{ incErrors[inc.id].loss }}
              </div>
            </div>
          </div>
          <div class="field" style="margin-bottom: 0" :class="{ 'is-error': incErrors[inc.id]?.desc }">
            <label class="field__lb">{{ IF.desc.label }}<i>*</i></label>
            <input v-model="inc.desc" class="input" :placeholder="IF.desc.placeholder" />
            <div v-if="incErrors[inc.id]?.desc" class="field__err">
              <Icon name="alert" :size="12" :sw="2.2" />{{ incErrors[inc.id].desc }}
            </div>
          </div>
        </div>

        <button class="btn btn--ghost btn--block mt10" @click="addRow">
          <Icon name="plus" :size="14" :sw="2.3" />添加一条记录
        </button>
      </template>

      <div v-else class="inc__empty">
        事故 / 违章记录需要先保存司机，之后再进来添加。
      </div>
    </div>

    <template #footer>
      <button class="btn btn--ghost" style="flex: 0 0 auto" @click="emit('close')">取消</button>
      <button class="btn btn--primary flex1" :disabled="saving" @click="submit">
        <Icon name="check" :size="15" :sw="2.4" />{{ isEdit ? '保存修改' : '保存司机' }}
      </button>
    </template>
  </SheetModal>
</template>

<style scoped>
/* —— 事故 / 违章 —— */
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
  color: var(--amber);
}
.inc__sum {
  margin-left: auto;
  font-size: 11.5px;
  font-weight: 550;
  color: var(--red);
  font-variant-numeric: tabular-nums;
}
.inc__empty {
  margin-top: 10px;
  font-size: 12px;
  color: var(--ink-3);
}
.inc__row {
  margin-top: 12px;
  padding: 11px 12px;
  border-radius: var(--r-sm);
  background: var(--surface);
  border: 1px solid var(--line-2);
}
.inc__rowhd {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}
.inc__no {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--ink-3);
}
.inc__del {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--red);
  opacity: 0.85;
}
.inc__del:hover {
  opacity: 1;
  text-decoration: underline;
}
.inc .field {
  margin-bottom: 12px;
}
</style>
