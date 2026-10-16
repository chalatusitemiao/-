<script setup>
import { computed } from 'vue'
import { route, TABS, navigate } from './router.js'
import Icon from './components/Icon.vue'
import Vehicles from './views/Vehicles.vue'
import Drivers from './views/Drivers.vue'
import Routes from './views/Routes.vue'
import Trips from './views/Trips.vue'
import Income from './views/Income.vue'

/* 模块 → 页面。加模块时这里补一行 */
const VIEWS = { '/': Vehicles, '/drivers': Drivers, '/routes': Routes, '/trips': Trips, '/income': Income }
const view = computed(() => VIEWS[route.value] || Vehicles)

const todayStr = computed(() => {
  const d = new Date()
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
})
</script>

<template>
  <!-- 氛围层：极淡的顶部色晕 -->
  <div class="atmos">
    <div class="atmos__glow" />
  </div>

  <div class="shell">
    <!-- 移动端顶部栏 -->
    <header class="topbar">
      <div class="topbar__in">
        <div class="brand">
          <div class="brand__mark">车</div>
          <div class="brand__txt">
            <div class="brand__name">车队管理</div>
            <div class="brand__sub">{{ todayStr }}</div>
          </div>
        </div>
      </div>
    </header>

    <div class="body-row">
      <!-- 桌面端侧边菜单 -->
      <aside class="rail">
        <div class="rail__brand">
          <div class="brand__mark" style="width: 34px; height: 34px; font-size: 16px">车</div>
          <div>
            <div class="brand__name" style="font-size: 16px">车队管理</div>
            <div class="brand__sub">FLEET MANAGEMENT</div>
          </div>
        </div>

        <div class="rail__label">模块</div>
        <button
          v-for="t in TABS"
          :key="t.path"
          class="navitem"
          :class="{ 'is-active': t.path === route }"
          :aria-current="t.path === route ? 'page' : undefined"
          @click="navigate(t.path)"
        >
          <Icon class="navitem__ico" :name="t.icon" :size="17" />
          <span>{{ t.name }}</span>
        </button>

        <div class="rail__foot">
          <div class="tiny muted mono">{{ todayStr }}</div>
        </div>
      </aside>

      <!-- 内容区 -->
      <main class="main">
        <div :key="route" class="pagefade">
          <component :is="view" />
        </div>
      </main>
    </div>

    <!-- 移动端底部菜单 -->
    <nav class="tabbar">
      <button
        v-for="t in TABS"
        :key="t.path"
        class="tab"
        :class="{ 'is-active': t.path === route }"
        :aria-current="t.path === route ? 'page' : undefined"
        @click="navigate(t.path)"
      >
        <span class="tab__ico"><Icon :name="t.icon" :size="21" /></span>
        <span>{{ t.short || t.name }}</span>
      </button>
    </nav>
  </div>
</template>
