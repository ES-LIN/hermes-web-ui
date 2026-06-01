<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { NDropdown, NModal, NTabPane, NTabs, type DropdownOption } from 'naive-ui'
import { clearApiKey, isStoredSuperAdmin } from '@/api/client'
import DisplaySettings from '@/components/hermes/settings/DisplaySettings.vue'
import VoiceSettings from '@/components/hermes/settings/VoiceSettings.vue'

const router = useRouter()
const { t } = useI18n()
const show = ref(false)
const showSettings = ref(false)
const isSuperAdmin = computed(() => isStoredSuperAdmin())

const options = computed<DropdownOption[]>(() => [
  { label: t('publicChat.chatSettings'), key: 'settings' },
  ...(isSuperAdmin.value ? [{ label: t('publicChat.admin'), key: 'admin' }] : []),
  { type: 'divider', key: 'divider' },
  { label: t('sidebar.logout'), key: 'logout' },
])

function handleSelect(key: string | number) {
  show.value = false
  if (key === 'settings') {
    showSettings.value = true
  } else if (key === 'admin') {
    router.push({ name: 'admin.chat' })
  } else if (key === 'logout') {
    clearApiKey()
    localStorage.clear()
    router.replace({ name: 'login' })
  }
}
</script>

<template>
  <div class="public-chat-menu">
    <NDropdown
      trigger="click"
      placement="top-start"
      :options="options"
      :show="show"
      @update:show="show = $event"
      @select="handleSelect"
    >
      <button class="public-chat-menu__button" type="button" :title="t('sidebar.settings')">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>
    </NDropdown>
    <NModal
      v-model:show="showSettings"
      preset="card"
      :title="t('publicChat.chatSettings')"
      :style="{ width: 'min(720px, calc(100vw - 24px))' }"
      :mask-closable="true"
    >
      <NTabs type="line" animated>
        <NTabPane name="display" :tab="t('settings.tabs.display')">
          <DisplaySettings />
        </NTabPane>
        <NTabPane name="voice" :tab="t('settings.tabs.voice')">
          <VoiceSettings />
        </NTabPane>
      </NTabs>
    </NModal>
  </div>
</template>

<style scoped lang="scss">
@use '@/styles/variables' as *;

.public-chat-menu {
  position: fixed;
  left: 18px;
  bottom: 18px;
  z-index: 80;
}

.public-chat-menu__button {
  width: 38px;
  height: 38px;
  border: 1px solid $border-color;
  border-radius: 50%;
  background: $bg-card;
  color: $text-secondary;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);

  &:hover {
    color: $text-primary;
    border-color: $accent-primary;
  }
}
</style>
