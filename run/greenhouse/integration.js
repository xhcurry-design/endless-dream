(() => {
  "use strict";

  const RUN_STATE_KEY = "moyuqi.runState.v1";
  const RETURN_URL = "../main_pro.html?resume=greenhouse&reward=mirror-flower";
  const DOOR_TRIGGER = {
    halfWidth: 1.15,
    maxZ: -4.45,
  };

  let exitReady = false;
  let navigating = false;
  let frameId = 0;

  const hint = document.createElement("div");
  hint.className = "greenhouse-exit-hint";
  hint.setAttribute("role", "status");
  hint.setAttribute("aria-live", "polite");
  hint.hidden = true;
  hint.textContent = "门已打开。点击画面继续行走，进入门内返回墨雨栖。";

  const fade = document.createElement("div");
  fade.className = "greenhouse-return-fade";
  fade.setAttribute("aria-hidden", "true");
  fade.hidden = true;
  fade.textContent = "镜面正在接住你……";

  document.body.append(hint, fade);

  function armOpenDoorExit() {
    const debug = window.__mirrorRoomDebug;
    const puzzle = debug?.puzzleState;
    if (!debug?.playerYaw || !puzzle) {
      window.setTimeout(armOpenDoorExit, 50);
      return;
    }

    puzzle.mirrorMode = false;
    puzzle.cutsceneStage = "idle";
    puzzle.cutsceneTime = 0;
    puzzle.doorOpenTarget = 1;

    const exitOverlay = document.getElementById("exit-overlay");
    if (exitOverlay) {
      exitOverlay.hidden = true;
    }

    const controlText = document.getElementById("control-text");
    if (controlText) {
      controlText.textContent = "点击画面继续行走，穿过已经打开的门返回墨雨栖。";
    }

    exitReady = true;
    hint.hidden = false;
  }

  function isPlayerInsideDoor() {
    const debug = window.__mirrorRoomDebug;
    const position = debug?.playerYaw?.position;
    const puzzle = debug?.puzzleState;
    if (!position || !puzzle || puzzle.doorOpenTarget < 0.99) {
      return false;
    }

    return Math.abs(position.x) <= DOOR_TRIGGER.halfWidth && position.z <= DOOR_TRIGGER.maxZ;
  }

  function returnToMainRoom() {
    if (navigating) {
      return;
    }

    navigating = true;
    hint.hidden = true;
    if (document.pointerLockElement) {
      document.exitPointerLock();
    }

    fade.hidden = false;
    window.requestAnimationFrame(() => {
      fade.classList.add("is-visible");
    });

    try {
      const stored = JSON.parse(window.sessionStorage.getItem(RUN_STATE_KEY) || "{}");
      const state = stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {};
      if (!state.flowerOffered && !state.sunKey) {
        state.mirrorComplete = true;
        state.flowerOwned = true;
      }
      window.sessionStorage.setItem(RUN_STATE_KEY, JSON.stringify(state));
    } catch (error) {
      console.warn("Unable to save the mirror flower reward.", error);
    }

    window.setTimeout(() => {
      window.location.assign(RETURN_URL);
    }, 650);
  }

  function watchDoor() {
    if (exitReady && !navigating && isPlayerInsideDoor()) {
      returnToMainRoom();
    }
    frameId = window.requestAnimationFrame(watchDoor);
  }

  window.addEventListener("greenhouse-room-exit-ready", armOpenDoorExit);
  window.addEventListener("dream-game-restart", (event) => {
    if (event.detail?.pageRoom !== "greenhouse" || !window.GreenhouseMirrorRoom?.reset) {
      return;
    }

    event.preventDefault();
    window.GreenhouseMirrorRoom.reset();
    window.EndlessDreamGameShell?.resume?.();
  });
  window.addEventListener("pagehide", () => {
    window.cancelAnimationFrame(frameId);
    frameId = 0;
  });
  window.addEventListener("pageshow", () => {
    navigating = false;
    fade.classList.remove("is-visible");
    fade.hidden = true;
    if (exitReady) {
      hint.hidden = false;
    }
    if (!frameId) {
      frameId = window.requestAnimationFrame(watchDoor);
    }
  });

  if (window.GreenhouseMirrorRoom?.getState().exitReady) {
    armOpenDoorExit();
  }
  frameId = window.requestAnimationFrame(watchDoor);
})();
