<script setup lang="ts">
import { useRoute } from 'vue-router'

const route = useRoute()
</script>

<template>
  <div class="h-full flex flex-col items-center justify-center text-center gap-3 min-h-[50vh]">
    <div class="text-5xl">{{ route.meta.icon || '▣' }}</div>
    <h2 class="text-xl font-bold text-white">{{ route.meta.title }}</h2>
    <p class="text-sm text-slate-500 max-w-md">
      Раздел в разработке. Реализуем на следующих шагах — с реальными данными с сервера.
    </p>
  </div>
</template>
