(function () {
    "use strict";

    var RUN_STATE_KEY = "moyuqi.runState.v1";
    var RETURN_URL = "../main_pro.html?resume=upside&reward=sun-key";
    var RETURN_DELAY_MS = 720;
    var returning = false;
    var watchTimerId = 0;
    var overlay = document.getElementById("upside-return-overlay");

    var saveSunKey = function () {
        var runState = {};
        var storedState = sessionStorage.getItem(RUN_STATE_KEY);

        if (storedState) {
            try {
                var parsedState = JSON.parse(storedState);
                if (parsedState && typeof parsedState === "object" && !Array.isArray(parsedState)) {
                    runState = parsedState;
                }
            } catch (parseError) {
                console.warn("Ignoring invalid Moyuqi run state.", parseError);
            }
        }

        runState.mirrorComplete = true;
        runState.flowerOwned = false;
        runState.flowerOffered = true;
        runState.sunKey = true;
        sessionStorage.setItem(RUN_STATE_KEY, JSON.stringify(runState));
    };

    var returnToMainRoom = function () {
        if (returning) {
            return;
        }

        returning = true;
        window.clearTimeout(watchTimerId);
        watchTimerId = 0;

        if (overlay) {
            overlay.classList.add("upside-return-overlay--active");
        }

        try {
            if (document.exitPointerLock) {
                document.exitPointerLock();
            }
        } catch (pointerLockError) {
            console.warn("Unable to release pointer lock before returning.", pointerLockError);
        }

        try {
            saveSunKey();
        } catch (storageError) {
            console.error("Unable to save the Sun Key run state.", storageError);
        }

        window.setTimeout(function () {
            window.location.replace(RETURN_URL);
        }, RETURN_DELAY_MS);
    };

    var watchKey = function () {
        watchTimerId = 0;
        var debug = window.__upsideRoomDebug;

        if (debug && typeof debug.getState === "function") {
            try {
                if (debug.getState().storageKeyCollected) {
                    returnToMainRoom();
                    return;
                }
            } catch (stateError) {
                console.warn("Unable to read the upside-room state.", stateError);
            }
        }

        if (!returning) {
            watchTimerId = window.setTimeout(watchKey, 120);
        }
    };

    var startWatching = function () {
        if (!returning && !watchTimerId) {
            watchTimerId = window.setTimeout(watchKey, 0);
        }
    };

    window.addEventListener("pagehide", function () {
        window.clearTimeout(watchTimerId);
        watchTimerId = 0;
    });
    window.addEventListener("pageshow", startWatching);
    window.addEventListener("upside-room-key-collected", returnToMainRoom);
    window.addEventListener("dream-game-restart", function (event) {
        var debug = window.__upsideRoomDebug;
        var detail = event.detail || {};
        if (detail.pageRoom !== "upside" || detail.room !== "storage" ||
            !debug || typeof debug.restartStorageChallenge !== "function") {
            return;
        }

        if (debug.restartStorageChallenge()) {
            event.preventDefault();
            if (window.EndlessDreamGameShell && typeof window.EndlessDreamGameShell.resume === "function") {
                window.EndlessDreamGameShell.resume();
            }
        }
    });

    startWatching();
}());
