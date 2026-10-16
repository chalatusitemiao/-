<script setup>
/**
 * 司机批量导入（Excel / CSV）
 * ------------------------------------------------------------
 * 规则和车辆模块一致：**手机号就是主键**
 *   · 文件里的手机号已存在 → 替换原来那位司机的资料
 *   · 文件里的手机号不存在 → 新增一位
 *
 * 只导入「可上传」的字段（姓名/手机号/入职日期/驾驶证号/工资）。当月创收/里程/油耗电耗是自动统计的，
 * 事故违章是手工子记录，这两类都不参与导入，模板里也没有它们的列。
 */
import { computed, ref, watch } from 'vue'
import SheetModal from './SheetModal.vue'
import Icon from './Icon.vue'
import { UPLOAD_FIELDS, FIELD_MAP } from '../utils/driverRules.js'
import { readSheet } from '../utils/sheet.js'
import { matchColumns, buildDrafts, summarizeDrafts, downloadTemplate } from '../utils/driverImport.js'
import { phoneSet, licenseSet, importDrivers } from '../store/drivers.js'
import { num } from '../utils/format.js'

const props = defineProps({ open: { type: Boolean, default: false } })
const emit = defineEmits(['close', 'imported'])

const stage = ref('pick') // pick | preview | done
const busy = ref(false)
const fatal = ref('')
const fileName = ref('')
const source = ref('')
const rawRows = ref([])
const mapping = ref({})
const onlyProblems = ref(false)
const done = ref(null)
const fileRef = ref(null)

const F = FIELD_MAP

function reset() {
  stage.value = 'pick'
  busy.value = false
  fatal.value = ''
  fileName.value = ''
  source.value = ''
  rawRows.value = []
  mapping.value = {}
  onlyProblems.value = false
  done.value = null
  if (fileRef.value) fileRef.value.value = ''
}
watch(
  () => props.open,
  (v) => v && reset()
)

async function handleFile(file) {
  if (!file) return
  busy.value = true
  fatal.value = ''
  try {
    const { rows, source: src } = await readSheet(file)
    if (!rows.length) throw new Error('文件是空的，没有读到任何行')
    if (rows.length < 2) throw new Error('只有表头，没有数据行')

    const { mapping: map, missing } = matchColumns(rows[0].map((c) => String(c ?? '').trim()))
    fileName.value = file.name
    source.value = src
    rawRows.value = rows
    mapping.value = map
    stage.value = 'preview'

    if (missing.length) {
      fatal.value = `没认出来这些必填列：${missing.map((k) => F[k].label).join('、')}。请对照模板调整表头后重新上传。`
    }
  } catch (e) {
    fatal.value = e?.message || '文件读取失败'
  } finally {
    busy.value = false
    if (fileRef.value) fileRef.value.value = ''
  }
}

const onPick = (e) => handleFile(e.target.files?.[0])
const onDrop = (e) => handleFile(e.dataTransfer?.files?.[0])

/* ---------------- 逐行校验 ---------------- */
const drafts = computed(() =>
  buildDrafts(rawRows.value, mapping.value, {
    existingPhones: phoneSet(),
    existingLicenses: licenseSet(),
  })
)
const summary = computed(() => summarizeDrafts(drafts.value))
const importable = computed(() => summary.value.add + summary.value.update)
const canImport = computed(() => !fatal.value && importable.value > 0)

const previewRows = computed(() => {
  const list = onlyProblems.value ? drafts.value.filter((d) => d.action === 'error') : drafts.value
  return list.slice(0, 30)
})

const ACTION = {
  add: { text: '新增', cls: 'pill--run' },
  update: { text: '替换', cls: 'pill--info' },
  error: { text: '错误', cls: 'pill--warn' },
}

function doImport() {
  if (!canImport.value) return
  const good = drafts.value.filter((d) => d.action === 'add' || d.action === 'update')
  const res = importDrivers(good)
  done.value = { ...res, errors: summary.value.error }
  stage.value = 'done'
}
</script>

<template>
  <SheetModal :open="open" title="批量导入司机" @close="emit('close')">
    <!-- ============ 第一步：选文件 ============ -->
    <template v-if="stage === 'pick'">
      <label class="drop" @dragover.prevent @drop.prevent="onDrop">
        <input ref="fileRef" type="file" accept=".xlsx,.csv" hidden @change="onPick" />
        <span class="drop__ico"><Icon name="download" :size="22" /></span>
        <span class="drop__t">{{ busy ? '正在读取…' : '点击选择，或把文件拖到这里' }}</span>
        <span class="drop__d">支持 .xlsx 与 .csv，第一行必须是表头</span>
      </label>

      <div v-if="fatal" class="note note--warn mt14">
        <Icon name="alert" :size="15" />
        <div>{{ fatal }}</div>
      </div>

      <div class="note note--primary mt14">
        <Icon name="info" :size="15" />
        <div>
          <b>手机号是主键</b>：文件里的手机号已存在就<b>替换</b>那位司机，不存在就<b>新增</b>。
          可导入的列只有：姓名、手机号、入职日期、驾驶证号（选填）、工资（选填），列顺序随意。
          <br />
          当月创收 / 里程 / 油耗电耗属于<b>自动统计</b>，事故违章是<b>手工记录</b>，都不参与导入。
        </div>
      </div>

      <button class="btn btn--ghost btn--block mt14" @click="downloadTemplate">
        <Icon name="download" :size="14" />下载导入模板（CSV）
      </button>
    </template>

    <!-- ============ 第二步：预览确认 ============ -->
    <template v-else-if="stage === 'preview'">
      <div class="fmeta">
        <Icon name="box" :size="15" />
        <span class="fmeta__n">{{ fileName }}</span>
        <span class="fmeta__t">{{ source === 'xlsx' ? 'Excel' : 'CSV' }} · {{ summary.total }} 行数据</span>
      </div>

      <div class="stats">
        <div class="stat">
          <b class="stat__v c-good">{{ summary.add }}</b><span class="stat__l">新增</span>
        </div>
        <div class="stat">
          <b class="stat__v c-info">{{ summary.update }}</b><span class="stat__l">替换</span>
        </div>
        <div class="stat">
          <b class="stat__v c-bad">{{ summary.error }}</b><span class="stat__l">错误</span>
        </div>
        <div class="stat">
          <b class="stat__v">{{ num(importable) }}</b><span class="stat__l">可导入</span>
        </div>
      </div>

      <div v-if="fatal" class="note note--warn mt14">
        <Icon name="alert" :size="15" />
        <div>{{ fatal }}</div>
      </div>

      <div class="sec">
        <div class="sec__h">
          <Icon name="driver" :size="14" />数据预览
          <button v-if="summary.error" class="sec__toggle" @click="onlyProblems = !onlyProblems">
            {{ onlyProblems ? '显示全部' : '只看错误的' }}
          </button>
        </div>
        <div class="rows">
          <div v-for="d in previewRows" :key="d.line" class="prow">
            <div class="prow__h">
              <span class="pill" :class="ACTION[d.action].cls">{{ ACTION[d.action].text }}</span>
              <span class="prow__name">{{ d.draft.name || '（空姓名）' }}</span>
              <span class="prow__ln">第 {{ d.line }} 行</span>
            </div>
            <div class="prow__b">
              <span class="mono">{{ d.draft.phone || '（空手机号）' }}</span>
              <span>{{ d.draft.hireDate || '—' }}</span>
              <span class="mono">{{ d.draft.licenseNo || '驾驶证号未填' }}</span>
            </div>
            <div v-if="Object.keys(d.errors).length" class="prow__e">
              <Icon name="alert" :size="12" :sw="2.2" />
              {{
                Object.entries(d.errors)
                  .map(([k, v]) => (F[k]?.label || k) + '：' + v)
                  .join('；')
              }}
            </div>
            <div v-else-if="Object.values(d.warnings).length" class="prow__w">
              {{ Object.values(d.warnings).join('；') }}
            </div>
          </div>
          <div v-if="!previewRows.length" class="prow__more">没有需要显示的行</div>
          <div v-if="drafts.length > previewRows.length" class="prow__more">
            仅预览前 {{ previewRows.length }} 行，导入时会处理全部 {{ drafts.length }} 行
          </div>
        </div>
      </div>

      <div v-if="!canImport && !fatal" class="note note--amber mt14">
        <Icon name="alert" :size="15" />
        <div>没有可以导入的行 —— 文件里的数据都有错误，请修正后重新上传。</div>
      </div>
    </template>

    <!-- ============ 完成 ============ -->
    <template v-else>
      <div class="center" style="padding: 22px 0">
        <div class="okico"><Icon name="check" :size="24" :sw="2.6" /></div>
        <div style="font-size: 15px; font-weight: 650">导入完成</div>
        <div class="tiny muted mt6">
          新增 {{ done.add }} 位 · 替换 {{ done.update }} 位
          <template v-if="done.errors"> · 忽略 {{ done.errors }} 行错误</template>
        </div>
      </div>
    </template>

    <template #footer>
      <template v-if="stage === 'pick'">
        <button class="btn btn--ghost btn--block" @click="emit('close')">关闭</button>
      </template>
      <template v-else-if="stage === 'preview'">
        <button class="btn btn--ghost" style="flex: 0 0 auto" @click="stage = 'pick'">重选文件</button>
        <button class="btn btn--primary flex1" :disabled="!canImport" @click="doImport">
          <Icon name="check" :size="15" :sw="2.4" />确认导入 {{ importable }} 位
        </button>
      </template>
      <template v-else>
        <button class="btn btn--primary btn--block" @click="emit('imported', done)">完成</button>
      </template>
    </template>
  </SheetModal>
</template>

<style scoped>
.drop {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 30px 18px;
  border-radius: var(--r-lg);
  border: 1.5px dashed var(--line-strong);
  background: var(--surface-2);
  cursor: pointer;
  text-align: center;
  transition: border-color var(--dur-2) var(--ease), background var(--dur-2) var(--ease);
}
.drop:hover {
  border-color: var(--primary);
  background: var(--primary-soft);
}
.drop__ico {
  width: 46px;
  height: 46px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: var(--primary-soft);
  color: var(--primary);
  margin-bottom: 4px;
}
.drop__t {
  font-size: 14px;
  font-weight: 600;
}
.drop__d {
  font-size: 12px;
  color: var(--ink-3);
}

.fmeta {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  color: var(--ink-3);
}
.fmeta__n {
  font-weight: 600;
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.fmeta__t {
  margin-left: auto;
  flex: 0 0 auto;
  font-size: 11.5px;
}

.stats {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  margin-top: 12px;
}
.stat {
  padding: 10px 8px;
  border-radius: var(--r-md);
  background: var(--surface-3);
  text-align: center;
  min-width: 0;
}
.stat__v {
  display: block;
  font-size: 19px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.stat__l {
  font-size: 11px;
  color: var(--ink-3);
}
.c-good {
  color: var(--green);
}
.c-bad {
  color: var(--red);
}
.c-info {
  color: var(--primary);
}

.sec {
  margin-top: 16px;
}
.sec__h {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  font-weight: 650;
  color: var(--ink-2);
  margin-bottom: 8px;
}
.sec__h svg {
  color: var(--ink-3);
}
.sec__toggle {
  margin-left: auto;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--primary);
}

.rows {
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  overflow: clip;
}
.prow {
  padding: 10px 12px;
  border-bottom: 1px solid var(--line);
  min-width: 0;
}
.prow:last-child {
  border-bottom: 0;
}
.prow__h {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.prow__name {
  font-size: 13px;
  font-weight: 650;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.prow__ln {
  margin-left: auto;
  flex: 0 0 auto;
  font-size: 11px;
  color: var(--ink-4);
}
.prow__b {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  margin-top: 5px;
  font-size: 12px;
  color: var(--ink-3);
}
.prow__e,
.prow__w {
  display: flex;
  align-items: flex-start;
  gap: 4px;
  margin-top: 6px;
  font-size: 11.5px;
  line-height: 1.5;
}
.prow__e {
  color: var(--red);
}
.prow__w {
  color: var(--amber);
}
.prow__more {
  padding: 10px 12px;
  font-size: 11.5px;
  color: var(--ink-3);
  background: var(--surface-2);
}

.okico {
  width: 52px;
  height: 52px;
  margin: 0 auto 12px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: var(--green-soft);
  color: var(--green);
}
</style>
