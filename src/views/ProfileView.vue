<script setup>
import { reactive, ref } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { changeUserPassword, users } from '@/api/resources'

const auth = useAuthStore()

const nameForm = reactive({ firstName: auth.user?.firstName ?? '', lastName: auth.user?.lastName ?? '' })
const savingName = ref(false)
const nameError = ref('')
const nameSaved = ref(false)

async function saveName() {
  if (!nameForm.firstName.trim()) return
  savingName.value = true
  nameError.value = ''
  nameSaved.value = false
  try {
    await users.update(auth.user.id, {
      firstName: nameForm.firstName.trim(),
      lastName: nameForm.lastName.trim() || null,
    })
    await auth.fetchCurrentUser()
    nameSaved.value = true
  } catch (e) {
    nameError.value = e.message
  } finally {
    savingName.value = false
  }
}

const passwordForm = reactive({ currentPassword: '', password: '', passwordConfirm: '' })
const savingPassword = ref(false)
const passwordError = ref('')
const passwordSaved = ref(false)

async function savePassword() {
  passwordError.value = ''
  passwordSaved.value = false
  if (!passwordForm.currentPassword || !passwordForm.password) return
  if (passwordForm.password !== passwordForm.passwordConfirm) {
    passwordError.value = 'Новые пароли не совпадают'
    return
  }
  savingPassword.value = true
  try {
    await changeUserPassword(auth.user.id, {
      currentPassword: passwordForm.currentPassword,
      password: passwordForm.password,
    })
    passwordForm.currentPassword = ''
    passwordForm.password = ''
    passwordForm.passwordConfirm = ''
    passwordSaved.value = true
  } catch (e) {
    passwordError.value = e.message
  } finally {
    savingPassword.value = false
  }
}
</script>

<template>
  <div class="mx-auto max-w-lg space-y-4">
    <div class="card-pad">
      <h2 class="mb-4 text-sm font-semibold text-slate-800 dark:text-slate-100">Имя и фамилия</h2>
      <div class="space-y-3">
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="label">Имя</label>
            <input v-model="nameForm.firstName" class="input" />
          </div>
          <div>
            <label class="label">Фамилия</label>
            <input v-model="nameForm.lastName" class="input" placeholder="Необязательно" />
          </div>
        </div>
        <p v-if="nameError" class="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-500/10 dark:text-red-400">{{ nameError }}</p>
        <p v-if="nameSaved" class="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400">Сохранено</p>
        <button class="btn-primary" :disabled="savingName || !nameForm.firstName.trim()" @click="saveName">Сохранить</button>
      </div>
    </div>

    <div class="card-pad">
      <h2 class="mb-4 text-sm font-semibold text-slate-800 dark:text-slate-100">Смена пароля</h2>
      <div class="space-y-3">
        <div>
          <label class="label">Текущий пароль</label>
          <input v-model="passwordForm.currentPassword" type="password" class="input" autocomplete="current-password" />
        </div>
        <div>
          <label class="label">Новый пароль</label>
          <input v-model="passwordForm.password" type="password" class="input" autocomplete="new-password" />
        </div>
        <div>
          <label class="label">Повторите новый пароль</label>
          <input v-model="passwordForm.passwordConfirm" type="password" class="input" autocomplete="new-password" />
        </div>
        <p v-if="passwordError" class="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-500/10 dark:text-red-400">{{ passwordError }}</p>
        <p v-if="passwordSaved" class="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400">Пароль изменён</p>
        <button
          class="btn-primary"
          :disabled="savingPassword || !passwordForm.currentPassword || !passwordForm.password"
          @click="savePassword"
        >
          Сменить пароль
        </button>
      </div>
    </div>
  </div>
</template>
