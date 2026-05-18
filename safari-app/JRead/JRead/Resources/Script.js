function show(enabled, useSettingsInsteadOfPreferences) {
    if (useSettingsInsteadOfPreferences) {
        document.getElementsByClassName('state-on')[0].innerText = "JRead 擴充功能目前已啟用。可在 Safari 設定的「擴充功能」分頁中關閉。";
        document.getElementsByClassName('state-off')[0].innerText = "JRead 擴充功能目前未啟用。可在 Safari 設定的「擴充功能」分頁中開啟。";
        document.getElementsByClassName('state-unknown')[0].innerText = "可在 Safari 設定的「擴充功能」分頁中啟用 JRead。";
        document.getElementsByClassName('open-preferences')[0].innerText = "結束並開啟 Safari 設定…";
    }

    if (typeof enabled === "boolean") {
        document.body.classList.toggle(`state-on`, enabled);
        document.body.classList.toggle(`state-off`, !enabled);
    } else {
        document.body.classList.remove(`state-on`);
        document.body.classList.remove(`state-off`);
    }
}

function openPreferences() {
    webkit.messageHandlers.controller.postMessage("open-preferences");
}

document.querySelector("button.open-preferences").addEventListener("click", openPreferences);
