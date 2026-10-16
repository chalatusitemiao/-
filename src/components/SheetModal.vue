<script setup>
/** 底部抽屉（移动）/ 居中弹层（桌面）。Teleport 到 body，避免被卡片 overflow 裁掉。 */
import { watch, onUnmounted } from 'vue'
import Icon from './Icon.vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, default: '' },
})
const emit = defineEmits(['close'])

function onKey(e) {
  if (e.key === 'Escape') emit('close')
}
watch(
  () => props.open,
  (v) => {
    document.body.style.overflow = v ? 'hidden' : ''
    if (v) window.addEventListener('keydown', onKey)
    else window.removeEventListener('keydown', onKey)
  }
)
onUnmounted(() => {
  document.body.style.overflow = ''
  window.removeEventListener('keydown', onKey)
})
</script>

<template>
  <Teleport to="body">
    <template v-if="open">
      <div class="mask" @click="emit('close')" />
      <div class="sheet" role="dialog" aria-modal="true">
        <div class="sheet__grab" />
        <div class="sheet__hd">
          <div class="sheet__ttl">{{ title }}</div>
          <button class="xbtn spacer" aria-label="关闭" @click="emit('close')">
            <Icon name="close" :size="15" />
          </button>
        </div>
        <div class="sheet__bd"><slot /></div>
        <div v-if="$slots.footer" class="sheet__ft"><slot name="footer" /></div>
      </div>
    </template>
  </Teleport>
</template>
