<script setup>
/**
 * 二次确认对话框
 * ------------------------------------------------------------
 * 删除这类不可撤销的操作必须过这一道。
 * 用自绘弹层而不是 window.confirm：原生弹窗样式不可控、会阻塞主线程，
 * 移动端浏览器里标题还会显示成域名，很出戏。
 */
import { onUnmounted, watch } from 'vue'
import Icon from './Icon.vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, default: '确认操作' },
  message: { type: String, default: '' },
  /** 第二行小字，用来说明影响范围之类的细节 */
  detail: { type: String, default: '' },
  confirmText: { type: String, default: '确认' },
  cancelText: { type: String, default: '取消' },
  danger: { type: Boolean, default: true },
})
const emit = defineEmits(['confirm', 'cancel'])

function onKey(e) {
  if (e.key === 'Escape') emit('cancel')
  if (e.key === 'Enter') emit('confirm')
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
      <div class="mask" @click="emit('cancel')" />
      <div class="confirm" role="alertdialog" aria-modal="true" :aria-label="title">
        <div class="confirm__ico" :class="danger ? 'is-danger' : 'is-info'">
          <Icon :name="danger ? 'alert' : 'info'" :size="22" :sw="2" />
        </div>
        <div class="confirm__t">{{ title }}</div>
        <div v-if="message" class="confirm__m">{{ message }}</div>
        <div v-if="detail" class="confirm__d">{{ detail }}</div>
        <div class="confirm__ft">
          <button class="btn btn--ghost flex1" @click="emit('cancel')">{{ cancelText }}</button>
          <button
            class="btn flex1"
            :class="danger ? 'btn--danger-solid' : 'btn--primary'"
            @click="emit('confirm')"
          >
            {{ confirmText }}
          </button>
        </div>
      </div>
    </template>
  </Teleport>
</template>
