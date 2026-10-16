<script setup>
/**
 * 内联 SVG 图标集（描边风格，24×24 网格，currentColor）。
 * 不引图标库：demo 只需要十几个图标，自己写反而更可控、更统一。
 */
const props = defineProps({
  name: { type: String, required: true },
  size: { type: [Number, String], default: 20 },
  sw: { type: [Number, String], default: 1.7 },
})

const P = {
  gauge: '<path d="M3.6 18.4a8.4 8.4 0 1 1 16.8 0"/><path d="M12 18.4l4.6-6.2"/><circle cx="12" cy="18.4" r="1.5" fill="currentColor" stroke="none"/>',
  report: '<rect x="3.6" y="3.8" width="16.8" height="16.4" rx="2.4"/><path d="M8 16.4v-4.2M12 16.4V7.6M16 16.4v-6.2"/>',
  cost: '<ellipse cx="12" cy="6.6" rx="7.6" ry="3"/><path d="M4.4 6.6v5.2c0 1.66 3.4 3 7.6 3s7.6-1.34 7.6-3V6.6"/><path d="M4.4 11.8v5.2c0 1.66 3.4 3 7.6 3s7.6-1.34 7.6-3v-5.2"/>',
  chevL: '<path d="M14.4 6l-6 6 6 6"/>',
  truck: '<path d="M2.6 7.4h10.8v9.2H2.6z"/><path d="M13.4 10.4h3.9l3.1 3.1v3.1h-7z"/><circle cx="7" cy="18.4" r="1.9"/><circle cx="16.6" cy="18.4" r="1.9"/>',
  driver: '<circle cx="12" cy="8.2" r="3.5"/><path d="M5.2 20.4c0-3.7 3-6.3 6.8-6.3s6.8 2.6 6.8 6.3"/>',
  fuel: '<path d="M4.6 20.2V6a2 2 0 0 1 2-2h5a2 2 0 0 1 2 2v14.2"/><path d="M3 20.2h12.2"/><path d="M13.6 9.4h2.6a2 2 0 0 1 2 2v4.4a1.5 1.5 0 0 0 3 0v-6.1l-2.6-3"/><path d="M7 8.2h4.1v4H7z"/>',
  toll: '<path d="M6.6 3.4L4.2 20.6M17.4 3.4l2.4 17.2"/><path d="M12 6.2v3M12 12.2v3M12 18.2v3"/>',
  wallet: '<path d="M3.6 8.4a2 2 0 0 1 2-2h12.8a2 2 0 0 1 2 2v9.2a2 2 0 0 1-2 2H5.6a2 2 0 0 1-2-2z"/><path d="M3.6 10.6h16.8"/><circle cx="16.4" cy="15" r="1.3" fill="currentColor" stroke="none"/>',
  shield: '<path d="M12 3.4l7.2 2.6v6c0 4.3-3 7.6-7.2 9.2-4.2-1.6-7.2-4.9-7.2-9.2v-6z"/><path d="M9 12l2.3 2.3L15.4 10"/>',
  wrench: '<path d="M15.6 4.2a4.7 4.7 0 0 0-3 8.1l-7 7a1.9 1.9 0 1 0 2.7 2.7l7-7a4.7 4.7 0 0 0 5.8-6.5l-2.8 2.8-2.6-2.6 2.8-2.8a4.7 4.7 0 0 0-2.9-1.7z"/>',
  alert: '<path d="M12 4.2l8.6 15.2H3.4z"/><path d="M12 9.8v4.1M12 16.7v.2"/>',
  search: '<circle cx="11" cy="11" r="6.3"/><path d="M15.6 15.6L20.8 20.8"/>',
  download: '<path d="M12 4v11M7.6 10.6L12 15l4.4-4.4"/><path d="M4.6 19.6h14.8"/>',
  calendar: '<rect x="3.6" y="5.4" width="16.8" height="15" rx="2.2"/><path d="M3.6 10h16.8M8.2 3.4v4M15.8 3.4v4"/>',
  clock: '<circle cx="12" cy="12" r="8.2"/><path d="M12 7.4V12l3.2 2"/>',
  check: '<path d="M5 12.8l4.6 4.6L19 7.4"/>',
  info: '<circle cx="12" cy="12" r="8.2"/><path d="M12 11v5.2M12 8.1v.2"/>',
  trend: '<path d="M3.6 16.6l5-5 3.6 3.6 8-8"/><path d="M15.6 7.2h4.8v4.8"/>',
  box: '<path d="M12 3.2l8 4.4v8.8l-8 4.4-8-4.4V7.6z"/><path d="M4 7.6l8 4.4 8-4.4M12 12v8.8"/>',
  route: '<circle cx="6.4" cy="18" r="2.6"/><circle cx="17.6" cy="6" r="2.6"/><path d="M9 18h4.2a3.6 3.6 0 0 0 0-7.2h-3a3.6 3.6 0 0 1 0-7.2H14"/>',
  plus: '<path d="M12 5.2v13.6M5.2 12h13.6"/>',
  close: '<path d="M6.2 6.2l11.6 11.6M17.8 6.2L6.2 17.8"/>',
  chevD: '<path d="M6 9.6l6 6 6-6"/>',
  chevR: '<path d="M9.6 6l6 6-6 6"/>',
  arrUp: '<path d="M12 19V5M6.2 10.8L12 5l5.8 5.8"/>',
  arrDown: '<path d="M12 5v14M6.2 13.2L12 19l5.8-5.8"/>',
  arrRight: '<path d="M4.8 12h14.4M13.4 6.2L19.2 12l-5.8 5.8"/>',
  filter: '<path d="M3.8 6h16.4l-6.4 7.4v5.2l-3.6 1.8v-7z"/>',
  phone: '<path d="M7.4 3.6h3l1.4 3.6-1.9 1.4a11 11 0 0 0 5.5 5.5l1.4-1.9 3.6 1.4v3a2 2 0 0 1-2.2 2A15.6 15.6 0 0 1 5.4 5.8a2 2 0 0 1 2-2.2z"/>',
  more: '<circle cx="5.6" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="18.4" cy="12" r="1.5" fill="currentColor" stroke="none"/>',
  pin: '<path d="M12 21s6.4-5.6 6.4-10.4A6.4 6.4 0 0 0 5.6 10.6C5.6 15.4 12 21 12 21z"/><circle cx="12" cy="10.4" r="2.4"/>',
  layers: '<path d="M12 3.4l8.4 4.4L12 12.2 3.6 7.8z"/><path d="M3.6 12.4L12 16.8l8.4-4.4M3.6 16.6L12 21l8.4-4.4"/>',
}
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    :stroke-width="sw"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    v-html="P[name] || P.info"
  />
</template>
