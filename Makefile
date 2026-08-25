# Makefile — сборка приложений Wirehouse
# Запускать из папки wirehouse-front:  make apk

JAVA_HOME    := /opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home
ANDROID_HOME := $(HOME)/Library/Android/sdk
ADB          := $(ANDROID_HOME)/platform-tools/adb
APK          := android/app/build/outputs/apk/debug/app-debug.apk

.PHONY: apk apk-install web win mac desktop help
.DEFAULT_GOAL := help

apk: ## Пересобрать APK (фронт -> cap sync -> gradle)
	npm run build
	npx cap sync android
	cd android && JAVA_HOME="$(JAVA_HOME)" ANDROID_HOME="$(ANDROID_HOME)" ./gradlew assembleDebug
	@echo ""
	@echo "APK готов: $(APK)"

apk-install: apk ## Собрать APK и установить на телефон по USB (adb)
	$(ADB) install -r "$(APK)"
	@echo "Установлено на устройство"

web: ## Собрать фронт для сайта (папка dist/ — залить на сервер)
	npm run build
	@echo "dist/ готова к заливке на сервер"

win: ## Собрать установщик для Windows (.exe, NSIS) — запускать на Windows
	npm run electron:build:win

mac: ## Собрать установщик для macOS (.dmg) — запускать на Mac
	npm run electron:build:mac
	@echo ""
	@echo "DMG готов: dist-electron/ (Wirehouse-<версия>.dmg)"

desktop: ## Запустить десктоп-приложение (dev) на этом Mac
	npm run electron:dev

help: ## Показать список команд
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  make %-13s %s\n", $$1, $$2}'
