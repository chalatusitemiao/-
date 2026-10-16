<script setup>
/**
 * 路线管理：路线库 + 收费站按车型定价
 * ------------------------------------------------------------
 * 每条路线一行：起点 → 终点、单程公里数、途经收费站数量，
 * 以及**按车型分别汇总**的总过路费 —— 同一个站，皮卡和自卸车不是一个价。
 */
import { computed, ref } from 'vue'
import RouteForm from '../components/RouteForm.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import Icon from '../components/Icon.vue'
import Chips from '../components/Chips.vue'
import { CAR_TYPES } from '../data/vehicles.js'
import { routes, addRoute, updateRoute, removeRoute, tollTotalFor, searchRoutes } from '../store/routes.js'
import { removeTripsByRoute, trips } from '../store/trips.js'
import { num } from '../utils/format.js'

const q = ref('')
const typeFilter = ref('all')
const sortKey = ref('created')
const sortDir = ref('desc')
const formOpen = ref(false)
const editing = ref(null)
const pendingDelete = ref(null)
const toast = ref('')
let toastTimer = 0

function showToast(msg) {
  toast.value = msg
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = ''), 2600)
}

/* ---------------- 汇总 ---------------- */
const summary = computed(() => {
  const n = routes.length
  const km = routes.reduce((a, r) => a + (Number(r.distance) || 0), 0)
  const stations = routes.reduce((a, r) => a + r.tolls.length, 0)
  // 各车型在全路线上的过路费合计，用来看「不同车型差多少」
  const byType = CAR_TYPES.map((t) => ({
    type: t,
    total: routes.reduce((a, r) => a + tollTotalFor(r, t), 0),
  })).filter((x) => x.total > 0).sort((a, b) => a.total - b.total)
  return {
    count: n,
    km,
    avgKm: n ? km / n : 0,
    stations,
    avgStations: n ? stations / n : 0,
    byType,
    cheapest: byType[0] || null,
    priciest: byType[byType.length - 1] || null,
  }
})

/** 有价格的车型（用于每行的收费胶囊） */
const pricedTypes = computed(() =>
  CAR_TYPES.filter((t) => routes.some((r) => tollTotalFor(r, t) > 0))
)

const typeChips = computed(() => [{ key: 'all', name: '全部', count: routes.length }].concat(
  CAR_TYPES.map((t) => ({ key: t, name: t, count: routes.filter((r) => tollTotalFor(r, t) > 0).length })).filter((c) => c.count > 0)
))

/* ---------------- 列表 ---------------- */
function toggleSort(k) {
  if (sortKey.value === k) sortDir.value = sortDir.value === 'desc' ? 'asc' : 'desc'
  else {
    sortKey.value = k
    sortDir.value = 'desc'
  }
}

/** 当前对比的车型（筛选器选中的那个；选「全部」时用最贵车型） */
const compareType = computed(() =>
  typeFilter.value === 'all' ? summary.value.priciest?.type || CAR_TYPES[0] : typeFilter.value
)

const rows = computed(() => {
  let list = searchRoutes(q.value)
  if (typeFilter.value !== 'all') list = list.filter((r) => tollTotalFor(r, typeFilter.value) > 0)
  const k = sortKey.value
  const dir = sortDir.value === 'desc' ? -1 : 1
  return list.slice().sort((a, b) => {
    if (k === 'created') return 0
    if (k === 'toll') return (tollTotalFor(a, compareType.value) - tollTotalFor(b, compareType.value)) * dir
    if (k === 'stations') return (a.tolls.length - b.tolls.length) * dir
    const x = a[k]
    const y = b[k]
    if (typeof x === 'string') return String(x).localeCompare(String(y), 'zh') * dir
    return ((Number(x) || 0) - (Number(y) || 0)) * dir
  })
})

/* ---------------- 增改删 ---------------- */
function openNew() {
  editing.value = null
  formOpen.value = true
}
function openEdit(r) {
  editing.value = r
  formOpen.value = true
}
function onSaved(payload) {
  if (editing.value) {
    updateRoute(editing.value.id, payload)
    showToast(`已保存 ${payload.from} → ${payload.to} 的修改`)
  } else {
    addRoute(payload)
    showToast(`已录入路线 ${payload.from} → ${payload.to}`)
  }
  formOpen.value = false
}

/** 删路线要连带清掉引用它的趟次，否则会留下孤儿记录 */
const tripCountOf = (r) => trips.filter((t) => t.routeId === r.id).length

function askDelete(r) {
  pendingDelete.value = r
}
function confirmDelete() {
  const r = pendingDelete.value
  if (!r) return
  const n = removeTripsByRoute(r.id)
  removeRoute(r.id)
  pendingDelete.value = null
  showToast(n ? `已删除 ${r.from} → ${r.to}，并清掉 ${n} 条相关趟次` : `已删除 ${r.from} → ${r.to}`)
}
const deleteMessage = computed(() => {
  const r = pendingDelete.value
  return r ? `将删除路线 ${r.from} → ${r.to}（${r.distance} km，${r.tolls.length} 个收费站）。` : ''
})
const deleteDetail = computed(() => {
  const r = pendingDelete.value
  if (!r) return ''
  const n = tripCountOf(r)
  return n ? `该路线上还有 ${n} 条趟次记录，会一并删除 · 此操作不可撤销` : '此操作不可撤销'
})
</script>

<template>
  <div class="stack">
    <!-- 标题 -->
    <div class="page-head">
      <div>
        <h1 class="page-head__ttl">路线管理</h1>
        <div class="page-head__desc">
          共 {{ summary.count }} 条路线 · 合计 {{ num(summary.km) }} km · {{ summary.stations }} 个收费站
        </div>
      </div>
      <div class="head-actions">
        <button class="btn btn--primary" @click="openNew">
          <Icon name="plus" :size="15" :sw="2.4" />录入路线
        </button>
      </div>
    </div>

    <!-- 汇总条 -->
    <div class="grid grid--kpi">
      <div class="vsum reveal" style="--d: 0ms">
        <div class="vsum__l">路线总数</div>
        <div class="vsum__v">{{ summary.count }}<small>条</small></div>
        <div class="vsum__s">合计 {{ num(summary.km) }} km</div>
      </div>
      <div class="vsum reveal" style="--d: 50ms">
        <div class="vsum__l">平均单程</div>
        <div class="vsum__v">{{ num(Math.round(summary.avgKm)) }}<small>km</small></div>
        <div class="vsum__s">合计里程 {{ num(summary.km) }} km</div>
      </div>
      <div class="vsum reveal" style="--d: 100ms">
        <div class="vsum__l">收费站</div>
        <div class="vsum__v">{{ summary.stations }}<small>个</small></div>
        <div class="vsum__s">平均 {{ summary.avgStations.toFixed(1) }} 个 / 条</div>
      </div>
      <div class="vsum reveal" style="--d: 150ms">
        <div class="vsum__l">过路费（全路线合计）</div>
        <div class="vsum__v" :class="{ 'is-placeholder': !summary.byType.length }">
          <template v-if="summary.byType.length">
            ¥{{ num(summary.cheapest.total) }}<small>~ ¥{{ num(summary.priciest.total) }}</small>
          </template>
          <template v-else>—</template>
        </div>
        <div class="vsum__s">
          <template v-if="summary.byType.length">
            最低 {{ summary.cheapest.type }} · 最高 {{ summary.priciest.type }}
          </template>
          <template v-else>还没填收费站价格</template>
        </div>
      </div>
    </div>

    <!-- 工具条 -->
    <div class="card">
      <div class="card__bd" style="padding: 14px 16px">
        <div class="vsearch">
          <Icon name="search" :size="15" />
          <input v-model="q" class="input" placeholder="搜索起点 / 终点 / 收费站" />
          <button v-if="q" class="vsearch__x" aria-label="清空" @click="q = ''">
            <Icon name="close" :size="13" :sw="2.2" />
          </button>
        </div>
        <div v-if="typeChips.length > 1" class="mt10">
          <Chips v-model="typeFilter" :options="typeChips" />
        </div>
      </div>
    </div>

    <!-- 列表 -->
    <div class="card card--clip">
      <div class="card__hd">
        <div class="card__title"><Icon name="route" :size="15" />路线列表</div>
        <div class="card__sub spacer">{{ rows.length }} / {{ summary.count }} 条</div>
      </div>

      <template v-if="rows.length">
        <!-- 桌面 -->
        <div class="tbl-wrap vonly-desktop">
          <table class="tbl" style="min-width: 960px">
            <thead>
              <tr>
                <th style="text-align: left">路线</th>
                <th class="is-sortable" @click="toggleSort('distance')">
                  公里数<span v-if="sortKey === 'distance'" class="tbl__sort">{{ sortDir === 'desc' ? '▼' : '▲' }}</span>
                </th>
                <th class="is-sortable" @click="toggleSort('stations')">
                  收费站<span v-if="sortKey === 'stations'" class="tbl__sort">{{ sortDir === 'desc' ? '▼' : '▲' }}</span>
                </th>
                <th class="is-sortable" style="text-align: left" @click="toggleSort('toll')">
                  总过路费（按车型）<span v-if="sortKey === 'toll'" class="tbl__sort">{{ sortDir === 'desc' ? '▼' : '▲' }}</span>
                </th>
                <th style="width: 150px">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in rows" :key="r.id">
                <td style="text-align: left">
                  <div class="rname"><span>{{ r.from }}</span><Icon name="arrRight" :size="12" :sw="2.2" /><span>{{ r.to }}</span></div>
                </td>
                <td class="num strong">{{ num(r.distance) }} km</td>
                <td class="num">{{ r.tolls.length }}</td>
                <td style="text-align: left">
                  <div v-if="pricedTypes.length" class="tolls">
                    <span v-for="t in pricedTypes" :key="t" class="tolls__i" :class="{ 'is-hi': t === compareType }">
                      {{ t }} <b>¥{{ num(tollTotalFor(r, t)) }}</b>
                    </span>
                  </div>
                  <span v-else class="muted">未填价格</span>
                </td>
                <td>
                  <div class="rowacts">
                    <button class="btn btn--ghost btn--sm" @click="openEdit(r)"><Icon name="wrench" :size="12" />编辑</button>
                    <button class="btn btn--danger btn--sm" @click="askDelete(r)"><Icon name="close" :size="12" :sw="2.2" />删除</button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- 移动 -->
        <div class="vonly-mobile">
          <div v-for="r in rows" :key="r.id" class="vcard">
            <div class="vcard__hd">
              <span class="rname"><span>{{ r.from }}</span><Icon name="arrRight" :size="12" :sw="2.2" /><span>{{ r.to }}</span></span>
            </div>
            <dl class="vcard__kv">
              <div><dt>公里数</dt><dd>{{ num(r.distance) }} km</dd></div>
              <div><dt>收费站</dt><dd>{{ r.tolls.length }} 个</dd></div>
            </dl>
            <div v-if="pricedTypes.length" class="tolls mt10">
              <span v-for="t in pricedTypes" :key="t" class="tolls__i">
                {{ t }} <b>¥{{ num(tollTotalFor(r, t)) }}</b>
              </span>
            </div>
            <div v-if="r.tolls.length" class="stations">
              <span v-for="t in r.tolls" :key="t.id" class="stations__i">{{ t.station }}</span>
            </div>
            <div class="vcard__acts">
              <button class="btn btn--ghost btn--sm flex1" @click="openEdit(r)"><Icon name="wrench" :size="13" />编辑</button>
              <button class="btn btn--danger btn--sm flex1" @click="askDelete(r)"><Icon name="close" :size="13" :sw="2.2" />删除</button>
            </div>
          </div>
        </div>
      </template>

      <div v-else class="empty">
        <div class="empty__ico"><Icon name="route" :size="24" /></div>
        <div class="empty__t">{{ q || typeFilter !== 'all' ? '没有匹配的路线' : '还没有路线数据' }}</div>
        <div class="empty__d">
          {{ q || typeFilter !== 'all' ? '换个起点、终点或收费站名试试' : '录入起点终点、公里数和途经收费站的价格' }}
        </div>
        <div class="empty__acts">
          <template v-if="q || typeFilter !== 'all'">
            <button class="btn btn--ghost btn--sm" @click="q = ''; typeFilter = 'all'">清空筛选</button>
          </template>
          <template v-else>
            <button class="btn btn--primary btn--sm" @click="openNew">
              <Icon name="plus" :size="13" :sw="2.3" />录入路线
            </button>
          </template>
        </div>
      </div>
    </div>

    <div class="note">
      <Icon name="info" :size="15" />
      <div>
        路线的<b>主键是「起点 + 终点」</b>：同一条路线录两次会被拦下。
        收费站价格<b>按车型分别存</b> —— 2020 年起全国货车高速按轴型收费，
        同样一段路皮卡和 30 吨自卸车差好几倍，所以总过路费也是分车型算的。
        <br />
        路线数据存在 <b>sessionStorage</b>：刷新不丢，关闭标签页后自动清空。
      </div>
    </div>

    <RouteForm :open="formOpen" :route="editing" @close="formOpen = false" @saved="onSaved" />
    <ConfirmDialog
      :open="!!pendingDelete"
      title="确认删除这条路线？"
      :message="deleteMessage"
      :detail="deleteDetail"
      confirm-text="删除"
      @cancel="pendingDelete = null"
      @confirm="confirmDelete"
    />

    <Transition name="toast">
      <div v-if="toast" class="toast"><Icon name="check" :size="14" :sw="2.4" />{{ toast }}</div>
    </Transition>
  </div>
</template>

<style scoped>
.head-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.vsum {
  min-width: 0;
  padding: 14px 15px;
  border-radius: var(--r-lg);
  border: 1px solid var(--line);
  background: var(--surface);
  box-shadow: var(--sh-1);
}
.vsum__l {
  font-size: 12px;
  color: var(--ink-2);
}
.vsum__v {
  margin-top: 7px;
  font-size: clamp(19px, 5.4vw, 25px);
  font-weight: 680;
  letter-spacing: -0.02em;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}
.vsum__v.is-placeholder {
  color: var(--ink-4);
}
.vsum__v small {
  font-size: 11.5px;
  font-weight: 500;
  color: var(--ink-3);
  margin-left: 5px;
  letter-spacing: 0;
}
.vsum__s {
  margin-top: 8px;
  font-size: 11.5px;
  color: var(--ink-3);
}
.vsearch {
  position: relative;
  display: flex;
  align-items: center;
  min-width: 0;
}
.vsearch > svg {
  position: absolute;
  left: 12px;
  color: var(--ink-4);
  pointer-events: none;
}
.vsearch .input {
  padding-left: 35px;
  padding-right: 34px;
}
.vsearch__x {
  position: absolute;
  right: 8px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  color: var(--ink-3);
  background: var(--surface-3);
}

.rname {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  font-size: 13.5px;
  font-weight: 650;
  color: var(--ink);
}
.rname svg {
  flex: 0 0 auto;
  color: var(--ink-4);
}
.tolls {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}
.tolls__i {
  padding: 2px 7px;
  border-radius: var(--r-pill);
  font-size: 11px;
  background: var(--surface-3);
  color: var(--ink-2);
  white-space: nowrap;
}
.tolls__i b {
  font-variant-numeric: tabular-nums;
  color: var(--ink);
}
.tolls__i.is-hi {
  background: var(--primary-soft);
  color: var(--primary);
}
.tolls__i.is-hi b {
  color: var(--primary);
}
.stations {
  margin-top: 9px;
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}
.stations__i {
  padding: 2px 7px;
  border-radius: var(--r-sm);
  font-size: 11px;
  border: 1px solid var(--line-2);
  color: var(--ink-3);
}
.rowacts {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
}
.vonly-desktop {
  display: none;
}
.vonly-mobile {
  display: block;
}
@media (min-width: 760px) {
  .vonly-desktop {
    display: block;
  }
  .vonly-mobile {
    display: none;
  }
}
.vcard {
  padding: 14px 16px;
  border-bottom: 1px solid var(--line);
}
.vcard:last-child {
  border-bottom: 0;
}
.vcard__hd {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex-wrap: wrap;
}
.vcard__kv {
  margin: 12px 0 0;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px 14px;
}
.vcard__kv dt {
  font-size: 11.5px;
  color: var(--ink-3);
}
.vcard__kv dd {
  margin: 3px 0 0;
  font-size: 14px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.vcard__acts {
  margin-top: 13px;
  display: flex;
  gap: 8px;
}
.toast {
  position: fixed;
  left: 50%;
  transform: translateX(-50%);
  bottom: calc(var(--tabbar-h) + var(--sab) + 18px);
  z-index: 60;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 10px 16px;
  border-radius: var(--r-pill);
  background: #14171c;
  color: #fff;
  font-size: 13px;
  font-weight: 550;
  box-shadow: var(--sh-4);
  max-width: calc(100vw - 32px);
}
@media (min-width: 900px) {
  .toast {
    bottom: 28px;
  }
}
.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.2s var(--ease), transform 0.2s var(--ease);
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(8px);
}
</style>
