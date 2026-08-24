(function () {
    "use strict";

    if (window.EndlessDreamGameShell) {
        return;
    }

    var RUN_STATE_KEY = "moyuqi.runState.v1";
    var body = document.body;
    var pageRoomId = body.getAttribute("data-dream-room") || "main";
    var roomId = pageRoomId;

    var ROOMS = {
        main: {
            chapter: "梦境中枢 · 墨雨栖",
            title: "穿过三重梦境",
            objective: "听完黑猫的引导，依次从镜面与向日葵进入三重梦境，带回镜生花与日照钥匙，最后寻找真正的出口。",
            controls: [
                { keys: ["W", "A", "S", "D"], action: "行走" },
                { keys: ["鼠标"], action: "环顾房间" },
                { keys: ["Shift"], action: "奔跑" },
                { keys: ["Space"], action: "跳跃" },
                { keys: ["E"], action: "观察或进入梦境入口" }
            ],
            steps: [
                { title: "听黑猫说完", copy: "开场对白结束前，视角和行走都会保持锁定。" },
                { title: "先触碰镜面", copy: "完成逐光温室，带回只在光里盛开的镜生花。" },
                { title: "再唤醒向日葵", copy: "将镜生花交给窗前向日葵，进入倒置房间与储藏室。" },
                { title: "带钥匙回来", copy: "听完黑猫最后的提示，再用日照钥匙寻找出口。" }
            ]
        },
        greenhouse: {
            chapter: "第一重梦 · 希望",
            title: "逐光温室",
            objective: "接手镜架，调整反射光的方向，按顺序持续照亮三朵向日葵，让门上的藤蔓全部枯萎。",
            controls: [
                { keys: ["W", "A", "S", "D"], action: "行走" },
                { keys: ["鼠标"], action: "环顾房间" },
                { keys: ["E"], action: "接手或放开镜架" },
                { keys: ["J", "L"], action: "镜面向左或向右" },
                { keys: ["I"], action: "镜面向上" },
                { keys: ["K"], action: "镜面向下" },
                { keys: ["R"], action: "重置本房间谜题" }
            ],
            steps: [
                { title: "走近镜架", copy: "准星靠近镜架后按 E，接手镜面的方向。" },
                { title: "追踪光束", copy: "用 I 向上、K 向下，J/L 向左或向右微调镜面，让反射光停在当前目标花朵上。" },
                { title: "保持照射", copy: "每朵花需要持续受光约三秒，并且必须按界面顺序唤醒。" },
                { title: "穿过出口", copy: "三朵花全部苏醒后，藤蔓会退去；走进打开的门返回主房间。" }
            ]
        },
        upside: {
            chapter: "第二与第三重梦 · 记忆 / 恐惧",
            title: "倒置房间与储藏室",
            objective: "先在阴暗模式找出三件异常物品；房间倒转后，循着手电找出三道光痕，依次净化节点并取得日照钥匙。",
            controls: [
                { keys: ["W", "A", "S", "D"], action: "行走" },
                { keys: ["鼠标"], action: "环顾或控制光束" },
                { keys: ["Shift"], action: "加速移动" },
                { keys: ["Q"], action: "切换阳光 / 阴暗模式" },
                { keys: ["E"], action: "观察、净化或拾取" },
                { keys: ["R"], action: "失败后重启储藏室挑战" }
            ],
            steps: [
                { title: "比较明暗", copy: "先记住房间在阳光里的样子，再按 Q 切到阴暗模式。" },
                { title: "找出三处异常", copy: "靠近不该存在的物品，将准星对准它并按 E。" },
                { title: "顺着倒转进入深处", copy: "三件异常全部消失后，保持原地等待房间完成倒转。" },
                { title: "追踪光痕", copy: "在储藏室用光束沿柜边、墙缝和门侧慢慢扫，让光痕显影。" },
                { title: "净化并取钥匙", copy: "每道光痕会引出一个节点；靠近按 E 净化，三个节点完成后去房间中心取钥匙。" }
            ]
        },
        storage: {
            chapter: "第三重梦 · 恐惧",
            title: "限时储藏室",
            objective: "在倒计时结束前，用手电依次照出三道光痕，净化它们唤醒的节点，避开扩散的污染并取得房间中心的日照钥匙。",
            controls: [
                { keys: ["W", "A", "S", "D"], action: "行走" },
                { keys: ["鼠标"], action: "环顾并控制手电光束" },
                { keys: ["Shift"], action: "加速移动" },
                { keys: ["E"], action: "净化节点或拾取钥匙" },
                { keys: ["R"], action: "失败后重新开始挑战" }
            ],
            steps: [
                { title: "留意倒计时", copy: "污染会随时间扩散；不要在红色区域里停留太久。" },
                { title: "先找光痕", copy: "让手电沿柜边、墙缝、远处角落和来时的门侧缓慢扫过。" },
                { title: "稳定照射", copy: "光束对准当前光痕后保持片刻，它才会完全显影并唤醒对应节点。" },
                { title: "靠近净化", copy: "找到亮起的节点，将准星对准它并按 E，然后继续追踪下一道光痕。" },
                { title: "取得钥匙", copy: "三个节点全部净化后，前往房间中心按 E 拾取日照钥匙；失败时按 R 重试。" }
            ]
        }
    };

    var room = ROOMS[roomId] || ROOMS.main;
    var ready = false;
    var shownIntros = new Set();
    var activePanel = null;
    var previousFocus = null;
    var pauseReasons = new Set();
    var roomMusic = null;
    var roomMusicStarted = false;
    var roomMusicPaused = false;
    var roomMusicButton = null;
    var MUSIC_MUTED_KEY = "moyuqi.soundMuted.v1";
    var MUSIC_VOLUME = 0.24;

    function syncRoomMusicButton() {
        if (!roomMusicButton) return;
        var label = roomMusicPaused ? "继续音乐" : "暂停音乐";
        roomMusicButton.classList.toggle("is-muted", roomMusicPaused);
        roomMusicButton.setAttribute("aria-label", label);
        roomMusicButton.title = label;
        roomMusicButton.innerHTML = (roomMusicPaused ? ICONS.musicOff : ICONS.music) + '<span class="dream-game-tool__label"></span>';
        roomMusicButton.querySelector("span").textContent = label;
    }

    function startRoomMusic() {
        if (pageRoomId === "main" || roomMusicStarted || roomMusicPaused) return;
        roomMusicStarted = true;
        try {
            var muted = window.localStorage.getItem(MUSIC_MUTED_KEY) === "true";
            roomMusic = new Audio(new URL("../../obj_wo3DlMOGwrbDjj7DisKw_58087338372_f23f_7d7e_eebb_b0385c1cb0bfc322ddd42d68d06b4fb9.mp3?v=20260824-music-toggle-1", window.location.href).href);
            roomMusic.loop = true;
            roomMusic.preload = "auto";
            roomMusic.volume = MUSIC_VOLUME;
            roomMusic.muted = muted;
            var playing = roomMusic.play();
            if (playing && typeof playing.catch === "function") {
                playing.catch(function () {
                    roomMusicStarted = false;
                });
            }
        } catch (_) {
            roomMusicStarted = false;
        }
    }

    function stopRoomMusic() {
        if (roomMusic) {
            roomMusic.pause();
            try { roomMusic.currentTime = 0; } catch (_) {}
        }
        roomMusicStarted = false;
    }

    function toggleRoomMusic() {
        roomMusicPaused = !roomMusicPaused;
        if (roomMusicPaused) {
            if (roomMusic) roomMusic.pause();
        } else {
            startRoomMusic();
            if (roomMusic) {
                var playing = roomMusic.play();
                if (playing && typeof playing.catch === "function") playing.catch(function () {});
            }
        }
        syncRoomMusicButton();
    }

    function createElement(tagName, className, textContent) {
        var element = document.createElement(tagName);
        if (className) {
            element.className = className;
        }
        if (textContent !== undefined) {
            element.textContent = textContent;
        }
        return element;
    }

    var ICONS = {
        controls: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"></rect><path d="M7 9h.01M11 9h.01M15 9h.01M7 13h.01M11 13h6"></path></svg>',
        guide: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 4.5A2.5 2.5 0 0 1 4.5 2H11a1 1 0 0 1 1 1v17a1 1 0 0 0-1-1H4.5A2.5 2.5 0 0 0 2 21.5z"></path><path d="M22 4.5A2.5 2.5 0 0 0 19.5 2H13a1 1 0 0 0-1 1v17a1 1 0 0 1 1-1h6.5a2.5 2.5 0 0 1 2.5 2.5z"></path></svg>',
        pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="4" width="4" height="16" rx="1"></rect><rect x="14" y="4" width="4" height="16" rx="1"></rect></svg>',
        restart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"></path><path d="M3 3v5h5"></path></svg>',
        close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"></path></svg>',
        play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7z"></path></svg>',
        music: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4V5z"></path><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path><path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path></svg>',
        musicOff: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4V5z"></path><path d="m15 9 6 6M21 9l-6 6"></path></svg>'
    };

    function iconButton(kind, label, modifier) {
        var button = createElement("button", "dream-game-tool" + (modifier ? " " + modifier : ""));
        button.type = "button";
        button.setAttribute("aria-label", label);
        button.title = label;
        button.innerHTML = ICONS[kind] + '<span class="dream-game-tool__label"></span>';
        button.querySelector("span").textContent = label;
        return button;
    }

    var toolbar = createElement("nav", "dream-game-toolbar");
    toolbar.setAttribute("aria-label", "游戏工具");
    toolbar.hidden = true;
    var controlsButton = iconButton("controls", "按键说明");
    var guideButton = iconButton("guide", "游戏指南");
    var pauseButton = iconButton("pause", "暂停游戏");
    var restartButton = iconButton("restart", "重新开始", "dream-game-tool--danger");
    toolbar.append(controlsButton, guideButton, pauseButton, restartButton);

    if (pageRoomId !== "main") {
        roomMusicButton = iconButton("music", "暂停音乐", "dream-music-toggle");
        roomMusicButton.addEventListener("click", function (event) {
            event.stopPropagation();
            toggleRoomMusic();
        });
        body.appendChild(roomMusicButton);
        syncRoomMusicButton();
        startRoomMusic();
        document.addEventListener("pointerdown", startRoomMusic);
        document.addEventListener("keydown", startRoomMusic);
    }

    var modal = createElement("div", "dream-game-modal");
    modal.hidden = true;
    modal.setAttribute("aria-hidden", "true");
    var panel = createElement("section", "dream-game-modal__panel");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-labelledby", "dream-game-modal-title");
    var header = createElement("header", "dream-game-modal__header");
    var headingGroup = createElement("div", "dream-game-modal__heading");
    var eyebrow = createElement("span", "dream-game-modal__eyebrow");
    var modalTitle = createElement("h2", "dream-game-modal__title");
    modalTitle.id = "dream-game-modal-title";
    headingGroup.append(eyebrow, modalTitle);
    var closeButton = iconButton("close", "关闭", "dream-game-modal__close");
    header.append(headingGroup, closeButton);
    var content = createElement("div", "dream-game-modal__content");
    var footer = createElement("footer", "dream-game-modal__footer");
    panel.append(header, content, footer);
    modal.appendChild(panel);
    body.append(toolbar, modal);

    function releasePointerLock() {
        try {
            if (document.pointerLockElement && document.exitPointerLock) {
                document.exitPointerLock();
            }
        } catch (error) {
            console.warn("Unable to release pointer lock for the game menu.", error);
        }
    }

    function syncPausedState() {
        var paused = pauseReasons.size > 0;
        var previous = body.classList.contains("dream-game-is-paused");
        body.classList.toggle("dream-game-is-paused", paused);
        pauseButton.classList.toggle("is-active", activePanel === "pause");
        pauseButton.setAttribute("aria-pressed", String(activePanel === "pause"));
        if (paused) {
            releasePointerLock();
        }
        if (paused !== previous) {
            window.dispatchEvent(new CustomEvent("dream-game-pause-change", {
                detail: { paused: paused, panel: activePanel }
            }));
        }
    }

    function setPanelPaused(value) {
        if (value) {
            pauseReasons.add("panel");
        } else {
            pauseReasons.delete("panel");
        }
        syncPausedState();
    }

    function makeActionButton(label, modifier, icon) {
        var button = createElement("button", "dream-game-action" + (modifier ? " " + modifier : ""));
        button.type = "button";
        if (icon) {
            button.innerHTML = ICONS[icon] + "<span></span>";
            button.querySelector("span").textContent = label;
        } else {
            button.textContent = label;
        }
        return button;
    }

    function renderControls() {
        eyebrow.textContent = room.chapter;
        modalTitle.textContent = "按键说明";
        content.className = "dream-game-modal__content dream-game-modal__content--controls";
        var intro = createElement("p", "dream-game-modal__lead", "点击游戏画面锁定鼠标；按 Esc 可暂停并释放鼠标。");
        var list = createElement("dl", "dream-game-controls");
        room.controls.forEach(function (control) {
            var keyGroup = createElement("dt", "dream-game-controls__keys");
            control.keys.forEach(function (key) {
                keyGroup.appendChild(createElement("kbd", "dream-game-key", key));
            });
            var action = createElement("dd", "dream-game-controls__action", control.action);
            list.append(keyGroup, action);
        });
        content.replaceChildren(intro, list);
        var done = makeActionButton("返回游戏", "dream-game-action--primary", "play");
        done.addEventListener("click", closePanel, { once: true });
        footer.replaceChildren(done);
    }

    function renderGuide() {
        eyebrow.textContent = room.chapter;
        modalTitle.textContent = room.title;
        content.className = "dream-game-modal__content dream-game-modal__content--guide";
        var objective = createElement("section", "dream-game-objective");
        objective.append(
            createElement("span", "dream-game-objective__label", "本房目标"),
            createElement("p", "dream-game-objective__copy", room.objective)
        );
        var steps = createElement("ol", "dream-game-steps");
        room.steps.forEach(function (step, index) {
            var item = createElement("li", "dream-game-step");
            item.append(
                createElement("span", "dream-game-step__number", String(index + 1).padStart(2, "0")),
                createElement("strong", "dream-game-step__title", step.title),
                createElement("p", "dream-game-step__copy", step.copy)
            );
            steps.appendChild(item);
        });
        content.replaceChildren(objective, steps);
        var controls = makeActionButton("查看按键");
        controls.addEventListener("click", function () { openPanel("controls"); }, { once: true });
        var begin = makeActionButton("开始探索", "dream-game-action--primary", "play");
        begin.addEventListener("click", closePanel, { once: true });
        footer.replaceChildren(controls, begin);
    }

    function renderPause() {
        eyebrow.textContent = room.chapter;
        modalTitle.textContent = "梦境已暂停";
        content.className = "dream-game-modal__content dream-game-modal__content--pause";
        content.replaceChildren(createElement(
            "p",
            "dream-game-pause-copy",
            "时间与操作已经停下。继续时，点击画面即可重新锁定鼠标。"
        ));
        var guide = makeActionButton("查看指南");
        guide.addEventListener("click", function () { openPanel("guide"); }, { once: true });
        var resume = makeActionButton("继续游戏", "dream-game-action--primary", "play");
        resume.addEventListener("click", closePanel, { once: true });
        footer.replaceChildren(guide, resume);
    }

    function renderRestart() {
        eyebrow.textContent = "重新开始";
            modalTitle.textContent = pageRoomId === "main" ? "重新开始整场梦境？" : "重新开始当前房间？";
        content.className = "dream-game-modal__content dream-game-modal__content--pause";
        content.replaceChildren(createElement(
            "p",
            "dream-game-pause-copy",
            pageRoomId === "main"
                ? "本轮获得的道具、房间进度与通关计时都会清除，并返回游戏封面。"
                : "当前房间内尚未完成的解谜进度会重置，主房间已经记录的旅程不会清除。"
        ));
        var cancel = makeActionButton("取消");
        cancel.addEventListener("click", closePanel, { once: true });
        var confirm = makeActionButton("确认重新开始", "dream-game-action--danger", "restart");
        confirm.addEventListener("click", performRestart, { once: true });
        footer.replaceChildren(cancel, confirm);
    }

    function renderPanel(kind) {
        if (kind === "controls") {
            renderControls();
        } else if (kind === "guide") {
            renderGuide();
        } else if (kind === "restart") {
            renderRestart();
        } else {
            renderPause();
        }
    }

    function openPanel(kind) {
        if (!ready) {
            showToolbar();
        }
        previousFocus = document.activeElement;
        activePanel = kind;
        renderPanel(kind);
        modal.hidden = false;
        modal.setAttribute("aria-hidden", "false");
        body.classList.add("dream-game-menu-open");
        setPanelPaused(true);
        window.requestAnimationFrame(function () {
            modal.classList.add("is-visible");
            closeButton.focus({ preventScroll: true });
        });
    }

    function closePanel() {
        if (!activePanel) {
            return;
        }
        activePanel = null;
        modal.classList.remove("is-visible");
        modal.setAttribute("aria-hidden", "true");
        body.classList.remove("dream-game-menu-open");
        setPanelPaused(false);
        window.setTimeout(function () {
            if (!activePanel) {
                modal.hidden = true;
            }
        }, 180);
        if (previousFocus && typeof previousFocus.focus === "function" && previousFocus.isConnected) {
            previousFocus.focus({ preventScroll: true });
        }
        previousFocus = null;
    }

    function performRestart() {
        var restartEvent = new CustomEvent("dream-game-restart", {
            cancelable: true,
            detail: { room: roomId, pageRoom: pageRoomId, scope: pageRoomId === "main" ? "journey" : "room" }
        });
        if (!window.dispatchEvent(restartEvent)) {
            return;
        }

        releasePointerLock();
        stopRoomMusic();
        if (pageRoomId === "main") {
            try {
                if (window.EndlessDream && typeof window.EndlessDream.clearState === "function") {
                    window.EndlessDream.clearState();
                } else {
                    window.sessionStorage.removeItem(RUN_STATE_KEY);
                }
            } catch (error) {
                console.warn("Unable to clear the current dream state.", error);
            }
            window.location.replace(new URL("run/main_pro.html", document.baseURI).href);
            return;
        }
        window.location.reload();
    }

    function showToolbar() {
        ready = true;
        toolbar.hidden = false;
        body.classList.add("dream-game-shell-ready");
    }

    function setRoomContext(nextRoomId) {
        if (nextRoomId && ROOMS[nextRoomId]) {
            roomId = nextRoomId;
            room = ROOMS[nextRoomId];
            body.setAttribute("data-dream-room-context", nextRoomId);
        }
    }

    function showRoomIntro(nextRoomId) {
        setRoomContext(nextRoomId);
        showToolbar();
        if (shownIntros.has(roomId)) {
            return;
        }
        shownIntros.add(roomId);
        openPanel("guide");
    }

    function readyGame(options) {
        showToolbar();
        if (options && options.autoGuide) {
            showRoomIntro();
        }
    }

    function roomHasLoaded() {
        if (pageRoomId === "greenhouse") {
            var loading = document.getElementById("loading");
            return Boolean(window.__mirrorRoomDebug && loading && loading.hidden);
        }
        if (pageRoomId === "upside") {
            try {
                return Boolean(window.__upsideRoomDebug && window.__upsideRoomDebug.getState().loaded);
            } catch (error) {
                return false;
            }
        }
        return false;
    }

    function waitForRoom() {
        var startedAt = Date.now();
        var watchStage = function () {
            if (pageRoomId !== "upside") {
                return;
            }
            try {
                var state = window.__upsideRoomDebug && window.__upsideRoomDebug.getState();
                if (state && state.stage === "storage") {
                    showRoomIntro("storage");
                }
            } catch (error) {
                // The room can be between scene states while the flip animation runs.
            }
            window.setTimeout(watchStage, 160);
        };
        var check = function () {
            if (roomHasLoaded() || Date.now() - startedAt > 20000) {
                readyGame({ autoGuide: true });
                watchStage();
                return;
            }
            window.setTimeout(check, 120);
        };
        check();
    }

    controlsButton.addEventListener("click", function () { openPanel("controls"); });
    guideButton.addEventListener("click", function () { openPanel("guide"); });
    pauseButton.addEventListener("click", function () { openPanel("pause"); });
    restartButton.addEventListener("click", function () { openPanel("restart"); });
    closeButton.addEventListener("click", closePanel);
    modal.addEventListener("mousedown", function (event) {
        if (event.target === modal) {
            closePanel();
        }
    });

    document.addEventListener("keydown", function (event) {
        if (event.code === "Escape" && ready) {
            event.preventDefault();
            event.stopImmediatePropagation();
            if (activePanel) {
                closePanel();
            } else {
                openPanel("pause");
            }
            return;
        }

        if (!activePanel || event.code !== "Tab") {
            return;
        }
        var focusable = Array.from(panel.querySelectorAll("button:not([disabled]), [href], [tabindex]:not([tabindex='-1'])"));
        if (!focusable.length) {
            return;
        }
        var first = focusable[0];
        var last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    }, true);

    window.addEventListener("pagehide", function () {
        pauseReasons.clear();
        stopRoomMusic();
    });

    window.EndlessDreamGameShell = Object.freeze({
        ready: readyGame,
        isPaused: function () { return pauseReasons.size > 0; },
        openControls: function () { openPanel("controls"); },
        openGuide: function (nextRoomId) { setRoomContext(nextRoomId); openPanel("guide"); },
        showRoomIntro: showRoomIntro,
        setRoom: setRoomContext,
        pause: function () { openPanel("pause"); },
        resume: closePanel,
        restart: function () { openPanel("restart"); },
        getRoom: function () { return roomId; },
        getPageRoom: function () { return pageRoomId; }
    });

    if (body.getAttribute("data-dream-auto-guide") === "true") {
        waitForRoom();
    }
}());
