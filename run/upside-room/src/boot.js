(function () {
    "use strict";

    var hint = document.getElementById("hint");
    var failed = false;
    var startupWatchdog = window.setTimeout(function () {
        fail(new Error("物理系统初始化超时，请刷新页面重试。"));
    }, 45000);

    var fail = function (error) {
        if (failed) {
            return;
        }
        failed = true;
        window.clearTimeout(startupWatchdog);
        var detail = error && error.message ? error.message : String(error || "未知错误");
        console.error(error);
        if (hint) {
            hint.textContent = "启动失败：" + detail;
            hint.style.background = "rgba(140, 40, 40, 0.9)";
            hint.style.color = "#fff";
        }
    };

    if (typeof window.pc === "undefined" || !pc.WasmModule) {
        fail(new Error("PlayCanvas 加载失败。"));
        return;
    }

    pc.WasmModule.setConfig("Ammo", {
        glueUrl: "vendor/ammo.wasm.js",
        wasmUrl: "vendor/ammo.wasm.wasm",
        fallbackUrl: "vendor/ammo.js",
        errorHandler: fail
    });

    pc.WasmModule.getInstance("Ammo", function () {
        if (failed) {
            return;
        }
        window.clearTimeout(startupWatchdog);
        var script = document.createElement("script");
        script.src = "./src/app.js?v=20260824-2";
        script.onerror = function () {
            fail(new Error("应用脚本加载失败。"));
        };
        document.body.appendChild(script);
    });
}());
