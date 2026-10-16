<script setup>
/**
 * 「记一笔」成本录入抽屉。
 * 提交后会真正并入流水 —— 概览 / 报表 / 成本页的数字立刻跟着变，
 * 这样演示“录一笔看报表怎么变”才有说服力。
 */
import { computed, reactive, ref, watch } from 'vue'
import SheetModal from './SheetModal.vue'
import SegControl from './SegControl.vue'
import Icon from './Icon.vue'
import { DRIVERS, CATS, TODAY, dayKey } from '../data/mock.js'
import { vehicles as VEHICLES } from '../store/vehicles.js'
import { addEntry } from '../store/fleet.js'
import { entryOpen, entryCat, closeEntry } from '../store/ui.js'
import { yuan } from '../utils/format.js'

const CAT_OPTS = CATS.map((c) => ({ key: c.key, name: c.name }))

const form = reactive({
  cat: 'fuel',
  date: dayKey(TODAY),
  vehicleId: VEHICLES[0].id,
  driverId: DRIVERS[0].id,
  liters: '',
  price: '',
  km: '',
  amount: '',
  note: '',
})
const err = ref('')
const done = ref(false)

watch(entryOpen, (v) => {
  if (v) {
    form.cat = entryCat.value
    form.date = dayKey(TODAY)
    form.amount = ''
    form.liters = ''
    form.price = ''
    form.km = ''
    form.note = ''
    err.value = ''
    done.value = false
  }
})

const cat = computed(() => CATS.find((c) => c.key === form.cat))

/** 油耗：升数 × 单价 自动算金额 */
watch([() => form.liters, () => form.price], () => {
  if (form.cat !== 'fuel') return
  const l = Number(form.liters)
  const p = Number(form.price)
  if (l > 0 && p > 0) form.amount = String(Math.round(l * p))
})

const finalAmount = computed(() => {
  if (form.cat === 'fuel' && Number(form.liters) > 0 && Number(form.price) > 0) {
    return Math.round(Number(form.liters) * Number(form.price))
  }
  return Math.round(Number(form.amount) || 0)
})

function submit() {
  err.value = ''
  if (finalAmount.value <= 0) {
    err.value = '请填写金额（或油耗的升数与单价）'
    return
  }
  addEntry({
    cat: form.cat,
    date: form.date,
    vehicleId: form.vehicleId,
    driverId: form.cat === 'driver' ? form.driverId : null,
    liters: Number(form.liters) || 0,
    km: Number(form.km) || 0,
    amount: finalAmount.value,
    note: form.note,
  })
  done.value = true
  setTimeout(closeEntry, 900)
}

const vehicleOptions = computed(() =>
  VEHICLES.map((v) => ({ id: v.id, label: `${v.plate} · ${v.type}` }))
)
</script>

<template>
  <SheetModal :open="entryOpen" :title="`记一笔 · ${cat ? cat.name : ''}`" @close="closeEntry">
    <div v-if="done" class="center" style="padding: 26px 0">
      <div
        class="ibox"
        style="margin: 0 auto 12px; width: 46px; height: 46px; --ibox-fg: var(--green); --ibox-bg: var(--green-soft)"
      >
        <Icon name="check" :size="22" :sw="2.2" />
      </div>
      <div style="font-size: 14px; font-weight: 600">已计入 {{ yuan(finalAmount) }}</div>
      <div class="tiny muted mt6">相关报表与看板已同步更新</div>
    </div>

    <template v-else>
      <div class="field">
        <label class="field__lb">成本科目</label>
        <SegControl v-model="form.cat" :options="CAT_OPTS" ghost />
      </div>

      <div class="field">
        <label class="field__lb">发生日期</label>
        <input v-model="form.date" class="input mono" type="date" />
      </div>

      <div class="field">
        <label class="field__lb">{{ form.cat === 'driver' ? '司机' : '车辆' }}<i>*</i></label>
        <select v-if="form.cat === 'driver'" v-model="form.driverId" class="select">
          <option v-for="d in DRIVERS" :key="d.id" :value="d.id">
            {{ d.name }} · {{ d.license }} · 提成 {{ d.commission }} 元/km
          </option>
        </select>
        <select v-else v-model="form.vehicleId" class="select">
          <option v-for="v in vehicleOptions" :key="v.id" :value="v.id">{{ v.label }}</option>
        </select>
      </div>

      <!-- 油耗：升数 + 单价 -->
      <div v-if="form.cat === 'fuel'" class="field-grid">
        <div class="field">
          <label class="field__lb">加油升数 (L)<i>*</i></label>
          <input v-model="form.liters" class="input input--num" type="number" inputmode="decimal" placeholder="如 320" />
        </div>
        <div class="field">
          <label class="field__lb">柴油单价 (元/L)<i>*</i></label>
          <input v-model="form.price" class="input input--num" type="number" inputmode="decimal" step="0.01" placeholder="如 7.58" />
        </div>
      </div>

      <div v-if="form.cat === 'fuel'" class="field">
        <label class="field__lb">本次行驶里程 (km)</label>
        <input v-model="form.km" class="input input--num" type="number" inputmode="numeric" placeholder="填写后会一并更新百公里油耗" />
      </div>

      <div class="field">
        <label class="field__lb">
          金额 (元)<i v-if="form.cat !== 'fuel'">*</i>
        </label>
        <input
          v-model="form.amount"
          class="input input--num"
          type="number"
          inputmode="decimal"
          :placeholder="form.cat === 'fuel' ? '由升数 × 单价自动计算' : '如 1280'"
          :readonly="form.cat === 'fuel' && Number(form.liters) > 0 && Number(form.price) > 0"
        />
        <div v-if="finalAmount > 0" class="hint">将计入 {{ yuan(finalAmount) }}</div>
      </div>

      <div class="field">
        <label class="field__lb">备注</label>
        <input v-model="form.note" class="input" placeholder="如：苏嘉杭高速通行费 / 机油三滤保养" />
      </div>

      <div v-if="err" class="note note--warn mb10">
        <Icon name="alert" :size="15" style="flex: 0 0 auto; margin-top: 1px" />
        <div>{{ err }}</div>
      </div>

      <div class="note">
        <Icon name="info" :size="15" style="flex: 0 0 auto; margin-top: 1px" />
        <div>
          这是纯前端演示：数据全部由本地算法生成，新增记录只保存在当前页面内存里，
          <b>刷新即还原</b>，不会上传任何服务器。
        </div>
      </div>
    </template>

    <template v-if="!done" #footer>
      <button class="btn btn--ghost" style="flex: 0 0 auto" @click="closeEntry">取消</button>
      <button class="btn btn--primary" style="flex: 1" @click="submit">
        <Icon name="check" :size="15" :sw="2.2" />确认计入成本
      </button>
    </template>
  </SheetModal>
</template>
