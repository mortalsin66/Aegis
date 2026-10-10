<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { nav } from '../router'
import { setToken } from '../lib/auth'
import { t } from '../lib/i18n'
import { apiGet } from '../lib/api'
import TwoFactorModal from './TwoFactorModal.vue'

defineProps<{ open: boolean }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const route = useRoute()
const router = useRouter()
const showTwoFactor = ref(false)
const version = ref('')

onMounted(async () => {
  try {
    const info = await apiGet<{ version: string }>('/api/panel/info')
    version.value = info.version || ''
  } catch {
    /* ignore */
  }
})

function go(path: string) {
  router.push(path)
  emit('close')
}
</script>

<template>
  <aside
    class="w-60 h-screen fixed lg:static inset-y-0 left-0 z-40 flex flex-col border-r border-ink-700 bg-ink-900 transition-transform duration-200 lg:translate-x-0"
    :class="open ? 'translate-x-0' : '-translate-x-full'"
  >
    <div class="h-16 flex items-center gap-3 px-5 border-b border-ink-700">
      <div
        class="w-8 h-8 rounded-lg bg-gradient-to-br from-accent-400 to-accent-600 flex items-center justify-center font-extrabold text-ink-950"
      >
        A
      </div>
      <div>
        <div class="flex items-center gap-2">
          <div class="font-bold leading-none text-white">Aegis</div>
          <span v-if="version" class="text-[10px] font-mono text-slate-500 px-1 py-0.5 rounded bg-ink-800 border border-ink-700 leading-none">v{{ version }}</span>
        </div>
        <div class="text-[11px] text-slate-500 mt-1">Server Panel</div>
      </div>
    </div>

    <nav class="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
      <button
        v-for="n in nav"
        :key="n.id"
        @click="go(n.path)"
        class="nav-link w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-slate-400"
        :class="{ active: route.path === n.path }"
      >
        <span class="w-5 text-center">{{ n.icon }}</span>
        <span>{{ t('nav.' + n.id) }}</span>
      </button>
    </nav>

    <div class="p-3 border-t border-ink-700">
      <div class="flex items-center gap-3 px-2 py-2">
        <div class="w-8 h-8 rounded-full bg-ink-700 flex items-center justify-center text-sm font-semibold">A</div>
        <div class="min-w-0">
          <div class="text-sm font-medium text-white truncate">admin</div>
          <div class="text-[11px] text-slate-500">root@prod-01</div>
        </div>
        <button class="text-slate-500 hover:text-slate-300" title="2FA" @click="showTwoFactor = true">🔐</button>
        <button class="ml-auto text-slate-500 hover:text-slate-300" :title="t('common.close')" @click="setToken(null)">⏻</button>
      </div>
    </div>

    <TwoFactorModal v-if="showTwoFactor" @close="showTwoFactor = false" />
  </aside>
</template>
