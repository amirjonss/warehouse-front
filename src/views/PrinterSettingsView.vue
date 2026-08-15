<script setup>
import { ref } from 'vue'
import { usePrinterStore } from '@/stores/printer'
import { buildTestReceipt, printBytes, canPrint } from '@/utils/printer'

const printer = usePrinterStore()

const testing = ref(false)
const error = ref('')
const ok = ref(false)
const native = canPrint()

async function testPrint() {
  error.value = ''
  ok.value = false
  if (!printer.ip) {
    error.value = 'Укажите IP принтера'
    return
  }
  testing.value = true
  try {
    const bytes = buildTestReceipt(Number(printer.width))
    await printBytes({ ip: printer.ip, port: printer.port, bytes })
    ok.value = true
  } catch (e) {
    error.value = e.message
  } finally {
    testing.value = false
  }
}
</script>

<template>
  <div class="mx-auto max-w-lg space-y-4">
    <div class="card-pad">
      <h2 class="mb-4 text-sm font-semibold text-slate-800 dark:text-slate-100">Сетевой чек-принтер</h2>

      <p
        v-if="!native"
        class="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-500/10 dark:text-amber-400"
      >
        Печать на чек работает только в Android-приложении. В браузере эти настройки
        сохранятся, но сама печать недоступна.
      </p>

      <div class="space-y-3">
        <div>
          <label class="label">IP-адрес принтера</label>
          <input v-model="printer.ip" class="input" inputmode="decimal" placeholder="192.168.1.50" />
          <p class="mt-1 text-xs text-slate-500">
            Адрес принтера в вашей Wi-Fi сети. Узнать можно на самом принтере
            (самодиагностика) или в роутере.
          </p>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="label">Порт</label>
            <input v-model.number="printer.port" type="number" class="input" placeholder="9100" />
          </div>
          <div>
            <label class="label">Ширина (символов)</label>
            <input v-model.number="printer.width" type="number" class="input" placeholder="48" />
            <p class="mt-1 text-xs text-slate-500">80мм ≈ 48, 58мм ≈ 32</p>
          </div>
        </div>

        <p v-if="error" class="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-500/10 dark:text-red-400">{{ error }}</p>
        <p v-if="ok" class="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400">Тестовый чек отправлен на принтер</p>

        <button class="btn-primary" :disabled="testing || !printer.ip" @click="testPrint">
          {{ testing ? 'Печать…' : 'Тестовая печать' }}
        </button>
      </div>
    </div>
  </div>
</template>
