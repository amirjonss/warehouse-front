<script setup>
// Логотип приложения — та же изометрическая коробка, что и в иконках Windows
// и Android. Источник геометрии — scripts/generate-icons.cjs; если правите
// форму или цвета там, поправьте и здесь.
defineProps({
  size: { type: Number, default: 36 },
})
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 512 512"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <defs>
      <linearGradient id="wirehouse-logo" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#6366F1" />
        <stop offset="1" stop-color="#4338CA" />
      </linearGradient>
    </defs>
    <rect width="512" height="512" rx="112" fill="url(#wirehouse-logo)" />
    <polygon points="256,116 396,196 256,276 116,196" fill="#fff" />
    <polygon points="116,196 256,276 256,436 116,356" fill="#fff" opacity="0.78" />
    <polygon points="396,196 256,276 256,436 396,356" fill="#fff" opacity="0.52" />
  </svg>
</template>
