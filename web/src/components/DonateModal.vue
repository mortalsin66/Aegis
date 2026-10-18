<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import QRCode from 'qrcode'
import { DONATIONS } from '../lib/donate'
import { t } from '../lib/i18n'

const emit = defineEmits<{ (e: 'close'): void }>()

const activeIndex = ref(0)
const active = computed(() => DONATIONS[activeIndex.value] || DONATIONS[0])
const qrUrl = ref('')
const copied = ref(false)

onMounted(() => {
  void renderQr()
})

async function renderQr() {
  try {
    qrUrl.value = await QRCode.toDataURL(active.value.address, { width: 220, margin: 1 })
  } catch {
    qrUrl.value = ''
  }
}

function select(i: number) {
  if (i === activeIndex.value) return
  activeIndex.value = i
  copied.value = false
  void renderQr()
}

async function copyAddress() {
  try {
    await navigator.clipboard.writeText(active.value.address)
    copied.value = true
    setTimeout(() => (copied.value = false), 2000)
  } catch {
    /* ignore */
  }
}
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-6" @click.self="emit('close')">
      <div class="card w-full max-w-md p-6 max-h-[90vh] overflow-y-auto">
        <div class="flex items-center justify-between mb-4">
          <div class="flex items-center gap-2.5">
            <div
              class="w-8 h-8 rounded-lg bg-gradient-to-br from-accent-400 to-accent-600 flex items-center justify-center text-ink-950 text-base"
            >
              ❤
            </div>
            <h3 class="font-semibold text-white">{{ t('donate.title') }}</h3>
          </div>
          <button @click="emit('close')" class="text-slate-500 hover:text-slate-300 text-xl leading-none">×</button>
        </div>

        <p class="text-xs text-slate-500 mb-5">{{ t('donate.subtitle') }}</p>

        <div class="grid grid-cols-2 gap-2 mb-5">
          <button
            v-for="(d, i) in DONATIONS"
            :key="d.id"
            @click="select(i)"
            class="px-2 py-2 rounded-lg text-xs font-medium border transition-colors"
            :class="
              i === activeIndex
                ? 'bg-ink-800 border-accent-500 text-accent-400'
                : 'bg-ink-850 border-ink-700 text-slate-400 hover:text-slate-300'
            "
          >
            <div class="font-semibold">{{ d.coin }}</div>
            <div class="text-[10px] opacity-75 mt-0.5">{{ d.network }}</div>
          </button>
        </div>

        <div class="flex flex-col items-center">
          <div class="bg-white p-3 rounded-2xl mb-4">
            <img v-if="qrUrl" :src="qrUrl" width="200" height="200" alt="QR" class="rounded-lg" />
            <div v-else class="w-[200px] h-[200px] rounded-lg bg-ink-800 flex items-center justify-center text-xs text-slate-500">
              QR
            </div>
          </div>

          <div class="w-full bg-ink-850 border border-ink-700 rounded-lg px-3 py-2 flex items-center gap-2">
            <span class="font-mono text-white text-sm break-all flex-1">{{ active.address }}</span>
            <button
              @click="copyAddress"
              class="shrink-0 px-2.5 py-1 rounded bg-accent-500 text-ink-950 text-xs font-semibold hover:bg-accent-400"
            >
              {{ copied ? t('donate.copied') : t('donate.copy') }}
            </button>
          </div>
        </div>

        <div class="mt-4 p-3 rounded-lg bg-ink-850 border border-ink-700 text-[11px] text-slate-400 leading-relaxed">
          ⚠ {{ t('donate.warning', { coin: active.coin, network: active.network }) }}
        </div>

        <div class="mt-4 flex flex-col items-center gap-2">
          <a
            :href="active.explorer.replace('{address}', active.address)"
            target="_blank"
            rel="noopener"
            class="text-xs text-accent-400 hover:text-accent-500"
          >
            {{ t('donate.explorer') }} ↗
          </a>
          <div class="text-xs text-slate-500">❤ {{ t('donate.thanks') }}</div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
