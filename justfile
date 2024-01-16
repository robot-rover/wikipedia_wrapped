ADB_DEVICE := "TODO"

build:
    web-ext build --overwrite-dest

phone:
    web-ext run -t firefox-android --adb-device {{ADB_DEVICE}} --firefox-apk org.mozilla.firefox_beta