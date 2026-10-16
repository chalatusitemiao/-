<script setup>
/**
 * 趟次录入 / 编辑
 * ------------------------------------------------------------
 * 选路线 → 自动带出公里数与该车型的过路费；
 * 选车辆 → 自动带出车型与司机（可改）。
 *
 * 下半部分是这一趟的油耗体检：标准油耗、实际油耗、节油量与节油率，
 * 录入时就能看到这趟开得省还是费。
 */
import { computed, reactive, ref, watch } from 'vue'
import SheetModal from './SheetModal.vue'
import Icon from './Icon.vue'
import { CAR_TYPES } from '../data/vehicles.js'
import { routes, tollTotalFor } from '../store/routes.js'
import { vehicles } from '../store/vehicles.js'
import { drivers } from '../store/drivers.js'
import { validateTrip, toTripPayload } from '../utils/tripRules.js'
import { fuelPer100km, fuelPerTon100km, tonHundredKm, isSuspicious, isEstimatedType } from '../utils/fuelModel.js'
import { toISO } from '../utils/date.js'
import { openDatePicker } from '../utils/datePicker.js'
import { num, yuan } from '../utils/format.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  trip: { type: Object, default: null },
})
const emit = defineEmits(['close', 'saved'])

const isEdit = computed(() => !!props.trip)
const today = new Date()

const form = reactive({
  date: '', routeId: '', type: '', driverId: '', vehicleId: '',
  tonnage: '', actualFuel: '', toll: '', revenue: '', note: '', distance: '',
})
const errors = reactive({})
const warnings = reactive({})
const saving = ref(false)
/** 过路费是不是自动带出来的（带出来的才随车型变化，手工改过就不动它） */
const tollAuto = ref(true)

function reset() {
  const t = props.trip
  form.date = t ? t.date : toISO(today)
  form.routeId = t ? t.routeId : ''
  // 车型不从表单填：编辑时用记录里的快照，新增时等选完车辆带出
  form.type = t ? t.type : ''
  form.driverId = t ? t.driverId : ''
  form.vehicleId = t ? t.vehicleId : ''
  form.tonnage = t ? String(t.tonnage ?? '') : ''
  form.actualFuel = t ? String(t.actualFuel ?? '') : ''
  form.toll = t ? String(t.toll ?? '') : ''
  form.revenue = t ? String(t.revenue ?? '') : ''
  form.note = t ? t.note || '' : ''
  form.distance = t ? String(t.distance ?? '') : ''
  tollAuto.value = !t
  Object.keys(errors).forEach((k) => delete errors[k])
  Object.keys(warnings).forEach((k) => delete warnings[k])
  saving.value = false
}
watch(() => [props.open, props.trip], () => props.open && reset(), { immediate: true })

/* ---------------- 联动 ---------------- */
const currentRoute = computed(() => routes.find((r) => r.id === form.routeId) || null)
const currentVehicle = computed(() => vehicles.find((v) => v.id === form.vehicleId) || null)

/** 车型是从车辆上带出来的，不是用户填的 */
const estimated = computed(() => !!form.type && isEstimatedType(form.type))

function onRouteChange() {
  const r = currentRoute.value
  if (r) form.distance = String(r.distance)
  syncToll()
}
/** 过路费按「路线 + 车型」自动带出；用户手动改过之后就不再覆盖 */
function syncToll() {
  if (!tollAuto.value) return
  const r = currentRoute.value
  form.toll = r && form.type ? String(tollTotalFor(r, form.type)) : ''
}
function onTollInput() {
  tollAuto.value = false
}
/** 选车顺带带出车型与常用司机 */
/** 选车带出车型（并重算过路费）。车型不单独填，它绑在车辆上。 */
function onVehicleChange() {
  const v = currentVehicle.value
  form.type = v ? v.type : ''
  run()
  syncToll()
}

/* ---------------- 油耗体检 ---------------- */
/**
 * 只算一个指标：**每吨每百公里耗油量** = 实际油耗 ÷ (载重 × 公里数 ÷ 100)。
 * 它把载重归一化掉了，所以同一条路线、同一类型车辆的司机可以直接横向比。
 * 空载（载重 0）算不出来，这时显示「—」而不是 0。
 */
const check = computed(() => {
  const km = Number(form.distance)
  const fuel = Number(form.actualFuel)
  const load = Number(form.tonnage)
  if (!(km > 0) || !(fuel > 0)) return null
  return {
    actualFuel: fuel,
    per100km: fuelPer100km(km, fuel),
    perTon100: fuelPerTon100km(load, km, fuel),
    tonHundred: tonHundredKm(load, km),
    suspicious: isSuspicious({ type: form.type, actualFuel: fuel, distance: km }),
  }
})

/* ---------------- 校验 / 提交 ---------------- */
function run() {
  const { errors: e, warnings: w } = validateTrip(form, { today })
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

function submit() {
  saving.value = true
  if (!run()) {
    saving.value = false
    return
  }
  emit('saved', toTripPayload(form))
}

/* ---------------- 显示 ---------------- */
const routeLabel = (r) => `${r.from} → ${r.to}（${num(r.distance)} km）`
</script>

<template>
  <SheetModal
    :open="open"
    :title="isEdit ? '编辑趟次' : '录入趟次'"
    @close="emit('close')"
  >
    <div v-if="!routes.length || !drivers.length" class="note note--warn mb10">
      <Icon name="alert" :size="15" />
      <div>
        <template v-if="!routes.length">还没有路线，请先到「路线管理」录入路线。<br /></template>
        <template v-if="!drivers.length">还没有司机，请先到「司机管理」录入司机。</template>
      </div>
    </div>

    <div class="field-grid">
      <div class="field" :class="{ 'is-error': errors.date }">
        <label class="field__lb">运输日期<i>*</i></label>
        <input v-model="form.date" class="input" type="date" :max="toISO(today)" @click="openDatePicker" @change="onBlur" @blur="onBlur" />
        <div v-if="errors.date" class="field__err"><Icon name="alert" :size="12" :sw="2.2" />{{ errors.date }}</div>
      </div>
      <div class="field" :class="{ 'is-error': errors.routeId }">
        <label class="field__lb">路线<i>*</i></label>
        <select v-model="form.routeId" class="input select" @change="onRouteChange">
          <option value="">请选择</option>
          <option v-for="r in routes" :key="r.id" :value="r.id">{{ routeLabel(r) }}</option>
        </select>
        <div v-if="errors.routeId" class="field__err"><Icon name="alert" :size="12" :sw="2.2" />{{ errors.routeId }}</div>
      </div>
    </div>

    <div class="field-grid">
      <div class="field" :class="{ 'is-error': errors.driverId }">
        <label class="field__lb">司机<i>*</i></label>
        <select v-model="form.driverId" class="input select">
          <option value="">请选择</option>
          <option v-for="d in drivers" :key="d.id" :value="d.id">{{ d.name }}</option>
        </select>
        <div v-if="errors.driverId" class="field__err"><Icon name="alert" :size="12" :sw="2.2" />{{ errors.driverId }}</div>
      </div>
      <div class="field" :class="{ 'is-error': errors.vehicleId }">
        <label class="field__lb">车辆<i>*</i></label>
        <select v-model="form.vehicleId" class="input select" @change="onVehicleChange">
          <option value="">请选择</option>
          <option v-for="v in vehicles" :key="v.id" :value="v.id">{{ v.plate }}（{{ v.type }}）</option>
        </select>
        <div v-if="errors.vehicleId" class="field__err"><Icon name="alert" :size="12" :sw="2.2" />{{ errors.vehicleId }}</div>
        <!-- 车型不再单独填：它绑在车辆上，选完车辆自动带出 -->
        <div v-else-if="form.type" class="hint">
          <template v-if="estimated">车型：{{ form.type }}（不在油耗基准表里，油耗下限按通用货车估）</template>
          <template v-else>车型：{{ form.type }}（随车辆带出）</template>
        </div>
        <div v-else class="hint">选完车辆会自动带出车型</div>
      </div>
    </div>

    <div class="field-grid">
      <div class="field" :class="{ 'is-error': errors.distance }">
        <label class="field__lb">公里数<i>*</i></label>
        <span class="input-affix">
          <input v-model="form.distance" class="input input--num" type="number" inputmode="decimal" placeholder="选路线后自动带出" @blur="onBlur" @input="onInput('distance')" />
          <span class="input-affix__u">km</span>
        </span>
        <div v-if="errors.distance" class="field__err"><Icon name="alert" :size="12" :sw="2.2" />{{ errors.distance }}</div>
      </div>
      <div class="field"></div>
    </div>

    <div class="field-grid">
      <div class="field" :class="{ 'is-error': errors.tonnage }">
        <label class="field__lb">实际载重<i>*</i></label>
        <span class="input-affix">
          <input v-model="form.tonnage" class="input input--num" type="number" inputmode="decimal" placeholder="30" @blur="onBlur" @input="onInput('tonnage')" />
          <span class="input-affix__u">吨</span>
        </span>
        <div v-if="errors.tonnage" class="field__err"><Icon name="alert" :size="12" :sw="2.2" />{{ errors.tonnage }}</div>
      </div>
      <div class="field" :class="{ 'is-error': errors.actualFuel }">
        <label class="field__lb">实际油耗<i>*</i></label>
        <span class="input-affix">
          <input v-model="form.actualFuel" class="input input--num" type="number" inputmode="decimal" placeholder="35" @blur="onBlur" @input="onInput('actualFuel')" />
          <span class="input-affix__u">L</span>
        </span>
        <div v-if="errors.actualFuel" class="field__err"><Icon name="alert" :size="12" :sw="2.2" />{{ errors.actualFuel }}</div>
        <div v-else-if="warnings.actualFuel" class="hint hint--warn">{{ warnings.actualFuel }}</div>
      </div>
    </div>

    <!-- 油耗体检：只给「每吨每百公里耗油量」这一个指标 -->
    <div v-if="check" class="check">
      <div class="check__row">
        <span class="check__l">每吨每百公里耗油量</span>
        <b class="check__v">
          <template v-if="check.perTon100 !== null">{{ check.perTon100 }}<small>L / 吨·百公里</small></template>
          <template v-else>—</template>
        </b>
      </div>
      <div class="check__row">
        <span class="check__l">载重 × 公里（{{ form.tonnage }} 吨 × {{ form.distance }} km）</span>
        <b class="check__v">{{ num(check.tonHundred, 1) }}<small>吨·百公里</small></b>
      </div>
      <div class="check__row">
        <span class="check__l">实际加油</span>
        <b class="check__v">{{ num(check.actualFuel, 1) }}<small>L</small></b>
      </div>
      <div class="check__row">
        <span class="check__l">折合百公里（不按载重归一，仅供参考）</span>
        <b class="check__v">{{ check.per100km }}<small>L/100km</small></b>
      </div>
      <div v-if="check.perTon100 === null" class="check__warn">
        <Icon name="alert" :size="12" :sw="2.2" />载重为 0 算不出每吨耗油，空载趟次不计入油耗对比
      </div>
      <div v-else-if="check.suspicious" class="check__warn">
        <Icon name="alert" :size="12" :sw="2.2" />这个油耗低于该车型的物理下限，建议核对里程与加油量
      </div>
    </div>

    <div class="field-grid mt10">
      <div class="field" :class="{ 'is-error': errors.toll }">
        <label class="field__lb">过路费</label>
        <span class="input-affix">
          <input v-model="form.toll" class="input input--num" type="number" inputmode="decimal" placeholder="0" @input="onTollInput" @blur="onBlur" />
          <span class="input-affix__u">元</span>
        </span>
        <div v-if="errors.toll" class="field__err"><Icon name="alert" :size="12" :sw="2.2" />{{ errors.toll }}</div>
        <div v-else class="hint">按路线 + 车型自动带出，可改</div>
      </div>
      <div class="field" :class="{ 'is-error': errors.revenue }">
        <label class="field__lb">运费收入</label>
        <span class="input-affix">
          <input v-model="form.revenue" class="input input--num" type="number" inputmode="decimal" placeholder="0" @blur="onBlur" @input="onInput('revenue')" />
          <span class="input-affix__u">元</span>
        </span>
        <div v-if="errors.revenue" class="field__err"><Icon name="alert" :size="12" :sw="2.2" />{{ errors.revenue }}</div>
        <div v-else class="hint">用于统计司机当月创收</div>
      </div>
    </div>

    <div class="field">
      <label class="field__lb">备注</label>
      <input v-model="form.note" class="input" placeholder="选填，如返程空载、绕行等" />
    </div>

    <template #footer>
      <button class="btn btn--ghost" style="flex: 0 0 auto" @click="emit('close')">取消</button>
      <button class="btn btn--primary flex1" :disabled="saving" @click="submit">
        <Icon name="check" :size="15" :sw="2.4" />{{ isEdit ? '保存修改' : '保存趟次' }}
      </button>
    </template>
  </SheetModal>
</template>

<style scoped>
.check {
  margin-top: 4px;
  padding: 12px 13px;
  border-radius: var(--r-md);
  border: 1px solid var(--line);
  background: var(--surface-3);
}
.check.is-good {
  border-color: color-mix(in oklab, var(--green) 35%, var(--line));
}
.check.is-bad {
  border-color: color-mix(in oklab, var(--red) 30%, var(--line));
}
.check__row {
  display: flex;
  align-items: baseline;
  gap: 10px;
  font-size: 12px;
  min-width: 0;
}
.check__row + .check__row {
  margin-top: 5px;
}
.check__l {
  color: var(--ink-3);
  min-width: 0;
}
.check__v {
  margin-left: auto;
  flex: 0 0 auto;
  font-variant-numeric: tabular-nums;
  color: var(--ink);
}
.check__v small {
  font-weight: 500;
  color: var(--ink-4);
  margin-left: 4px;
}
.check__res {
  margin-top: 10px;
  padding-top: 9px;
  border-top: 1px dashed var(--line-2);
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  font-weight: 600;
}
.is-good .check__res {
  color: var(--green);
}
.is-bad .check__res {
  color: var(--red);
}
.check__res b {
  font-variant-numeric: tabular-nums;
}
.check__warn {
  margin-top: 8px;
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11.5px;
  color: var(--amber);
}
</style>
