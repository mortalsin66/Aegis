<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'

const props = defineProps<{
  modelValue: string
  options: { value: string; label: string }[]
  label?: string
}>()

const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>()

const open = ref(false)
const rootEl = ref<HTMLElement | null>(null)

const currentLabel = computed(
  () => props.options.find((o) => o.value === props.modelValue)?.label ?? props.modelValue,
)

function toggle() {
  open.value = !open.value
}
function select(v: string) {
  emit('update:modelValue', v)
  open.value = false
}
function onDocClick(e: MouseEvent) {
  if (rootEl.value && !rootEl.value.contains(e.target as Node)) open.value = false
}
onMounted(() => document.addEventListener('click', onDocClick))
onUnmounted(() => document.removeEventListener('click', onDocClick))
</script>

<template>
  <div ref="rootEl" class="relative">
    <button
      @click="toggle"
      class="flex items-center gap-1.5 bg-ink-850 border border-ink-700 hover:bg-ink-800 rounded-lg px-3 py-1.5 text-xs text-slate-300"
    >
      <span class="whitespace-nowrap">{{ label ? label + ': ' : '' }}{{ currentLabel }}</span>
      <svg
        class="w-3 h-3 transition-transform duration-150"
        :class="open ? 'rotate-180' : ''"
        viewBox="0 0 20 20"
        fill="none"
      >
        <path d="M5 7.5L10 12.5L15 7.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </button>
    <transition name="drop">
      <div v-if="open" class="absolute left-0 top-full mt-1 z-50 card p-1 min-w-full max-h-72 overflow-y-auto">
        <button
          v-for="o in options"
          :key="o.value"
          @click="select(o.value)"
          class="w-full text-left px-3 py-1.5 rounded-lg text-xs whitespace-nowrap"
          :class="o.value === modelValue ? 'bg-accent-500/15 text-accent-400' : 'text-slate-300 hover:bg-ink-850'"
        >
          {{ o.label }}
        </button>
      </div>
    </transition>
  </div>
</template>
