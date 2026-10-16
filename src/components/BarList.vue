<script setup>
/**
 * 横向条形榜（自绘，零依赖）
 * ------------------------------------------------------------
 * 用来看「哪台车最费钱」。条宽按占最大值的比例算 ——
 * 用最大值而不是总和当基准，小项之间的差异才看得出来。
 * 支持分段堆叠（比如一根条里同时看折旧 / 油耗 / 手工）。
 *
 * ⚠ 类名统一用 bl / bls 前缀。
 *   app.css 里有一组**全局**的 .bar / .bar__fill（归档的仪表盘在用，是个 6px 高的进度条），
 *   裸用 .bar 会被它套上 height:6px + overflow:hidden，整条榜会被压成一条线、
 *   文字全部叠在一起。components 里的 scoped 样式挡不住全局规则。
 */
import { computed } from 'vue'

const props = defineProps({
  /** [{ key, label, value, sub?, segments?: [{ key, value, color }] }] */
  items: { type: Array, default: () => [] },
  format: { type: Function, default: (v) => String(v) },
  /** 最多显示几条，其余折叠成「其他 N 台」 */
  limit: { type: Number, default: 0 },
})

const shown = computed(() => {
  const list = [...props.items].sort((a, b) => b.value - a.value)
  if (!props.limit || list.length <= props.limit) return list
  const head = list.slice(0, props.limit)
  const rest = list.slice(props.limit)
  return head.concat([
    {
      key: '__rest__',
      label: `其他 ${rest.length} 台`,
      value: rest.reduce((a, x) => a + x.value, 0),
      rest: true,
    },
  ])
})

const max = computed(() => Math.max(1, ...shown.value.map((x) => Number(x.value) || 0)))
</script>

<template>
  <ul class="bls">
    <li v-for="(it, i) in shown" :key="it.key" class="bl" :style="{ '--d': Math.min(i, 12) * 40 + 'ms' }">
      <div class="bl__hd">
        <span class="bl__l" :class="{ 'is-rest': it.rest }">{{ it.label }}</span>
        <span v-if="it.sub" class="bl__sub">{{ it.sub }}</span>
        <span class="bl__v">{{ format(it.value) }}</span>
      </div>
      <div class="bl__track">
        <!-- 分段堆叠：一段一个成本来源 -->
        <template v-if="it.segments && it.segments.length">
          <span
            v-for="s in it.segments"
            :key="s.key"
            class="bl__seg"
            :style="{
              width: ((Number(s.value) || 0) / max) * 100 + '%',
              background: s.color,
            }"
            :title="`${s.label} ${format(s.value)}`"
          />
        </template>
        <span
          v-else
          class="bl__fill"
          :style="{ width: ((Number(it.value) || 0) / max) * 100 + '%' }"
        />
      </div>
    </li>
    <li v-if="!shown.length" class="bls__empty">还没有可比较的数据</li>
  </ul>
</template>

<style scoped>
.bls {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}
.bl {
  min-width: 0;
  animation: bl-in 0.42s var(--ease) both;
  animation-delay: var(--d, 0ms);
}
@keyframes bl-in {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
}
.bl__hd {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 5px;
  min-width: 0;
  font-size: 12.5px;
}
.bl__l {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.bl__l.is-rest {
  color: var(--ink-3);
  font-weight: 500;
}
.bl__sub {
  color: var(--ink-3);
  font-size: 11.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bl__v {
  margin-left: auto;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
  flex: 0 0 auto;
}
.bl__track {
  display: flex;
  height: 9px;
  border-radius: var(--r-pill);
  background: var(--surface-3);
  overflow: hidden;
}
.bl__seg,
.bl__fill {
  height: 100%;
  transition: width 0.5s var(--ease);
}
.bl__seg + .bl__seg {
  box-shadow: inset 1px 0 0 rgba(255, 255, 255, 0.55);
}
.bl__fill {
  background: linear-gradient(90deg, var(--primary), var(--primary-2, var(--primary)));
  border-radius: var(--r-pill);
}
.bls__empty {
  font-size: 12.5px;
  color: var(--ink-3);
  padding: 6px 0;
}
</style>
