(function () {
    "use strict";

    var STATE_KEY = "moyuqi.runState.v1";
    var MUTED_KEY = "moyuqi.soundMuted.v1";
    var DEFAULT_STATE = Object.freeze({
        startedAt: 0,
        finishedAt: 0,
        introComplete: false,
        mirrorComplete: false,
        flowerOwned: false,
        flowerOffered: false,
        sunKey: false,
        keyDialogueComplete: false,
        keyUsed: false,
        won: false
    });

    function normalizeState(value) {
        var normalized = Object.assign({}, DEFAULT_STATE, value || {});
        ["startedAt", "finishedAt"].forEach(function (key) {
            normalized[key] = Number.isFinite(Number(normalized[key]))
                ? Math.max(0, Number(normalized[key]))
                : 0;
        });

        Object.keys(DEFAULT_STATE).forEach(function (key) {
            if (key !== "startedAt" && key !== "finishedAt") normalized[key] = normalized[key] === true;
        });

        if (normalized.flowerOwned) normalized.mirrorComplete = true;
        if (normalized.flowerOffered) normalized.mirrorComplete = true;
        if (normalized.sunKey) {
            normalized.mirrorComplete = true;
            normalized.flowerOwned = false;
            normalized.flowerOffered = true;
        }
        if (normalized.won) {
            normalized.sunKey = true;
            normalized.keyDialogueComplete = true;
            normalized.keyUsed = true;
            normalized.mirrorComplete = true;
            normalized.flowerOwned = false;
            normalized.flowerOffered = true;
        }
        if (normalized.flowerOffered) normalized.flowerOwned = false;
        return normalized;
    }

    var OPENING_DIALOGUE = Object.freeze([
        "你终于醒了。别急着相信这间房，它只记得你忘掉的东西。",
        "先去镜子那边。镜面里藏着一朵不肯醒来的花。",
        "把它带回来，交给向日葵。没有那朵花，它不会为你让路。",
        "之后的房间会试着把你留下。找到钥匙，再回来见我。",
        "梦会骗人，但光不会。去吧。"
    ]);

    var KEY_DIALOGUE = Object.freeze([
        "你听见了吗？这把钥匙正在替你记住门的方向。",
        "我只能送你到这里。握紧它，回到你醒来时身后的那扇门。",
        "别害怕门后的黑暗。那不是终点，只是另一场梦的入口。"
    ]);

    function readState() {
        var value = {};
        try {
            value = JSON.parse(window.sessionStorage.getItem(STATE_KEY) || "{}");
        } catch (_) {
            value = {};
        }
        if (!value || typeof value !== "object" || Array.isArray(value)) {
            value = {};
        }
        return normalizeState(value);
    }

    function saveState(patch) {
        var next = normalizeState(Object.assign({}, readState(), patch || {}));
        try {
            window.sessionStorage.setItem(STATE_KEY, JSON.stringify(next));
        } catch (_) {}
        return next;
    }

    function clearState() {
        try {
            window.sessionStorage.removeItem(STATE_KEY);
        } catch (_) {}
    }

    function isMuted() {
        try {
            return window.localStorage.getItem(MUTED_KEY) === "true";
        } catch (_) {
            return false;
        }
    }

    function storeMuted(value) {
        try {
            window.localStorage.setItem(MUTED_KEY, value ? "true" : "false");
        } catch (_) {}
    }

    var soundscape = (function () {
        var context = null;
        var master = null;
        var ambient = null;
        var music = null;
        var started = false;
        var musicPaused = false;
        var muted = isMuted();
        var MUSIC_URL = new URL(
            "../obj_wo3DlMOGwrbDjj7DisKw_58087338372_f23f_7d7e_eebb_b0385c1cb0bfc322ddd42d68d06b4fb9.mp3?v=20260824-music-toggle-1",
            (document.currentScript && document.currentScript.src) || window.location.href
        ).href;
        var MUSIC_VOLUME = 0.24;

        function setGain() {
            if (master && context) {
                master.gain.cancelScheduledValues(context.currentTime);
                master.gain.setTargetAtTime(muted ? 0 : 0.72, context.currentTime, 0.08);
            }
            if (music) {
                music.muted = muted;
                music.volume = MUSIC_VOLUME;
            }
        }

        function createMusic() {
            if (music) return music;
            music = new Audio(MUSIC_URL);
            music.loop = true;
            music.preload = "auto";
            music.volume = MUSIC_VOLUME;
            music.muted = muted;
            return music;
        }

        function startMusic() {
            var track = createMusic();
            track.muted = muted;
            track.volume = MUSIC_VOLUME;
            var playing = track.play();
            if (playing && typeof playing.catch === "function") {
                playing.catch(function () {});
            }
        }

        function createRain() {
            if (!context || ambient) return;
            var length = context.sampleRate * 3;
            var buffer = context.createBuffer(1, length, context.sampleRate);
            var channel = buffer.getChannelData(0);
            var previous = 0;
            for (var i = 0; i < length; i += 1) {
                var white = (Math.random() * 2) - 1;
                previous = (previous * 0.985) + (white * 0.015);
                channel[i] = (white * 0.16) + (previous * 0.84);
            }

            var source = context.createBufferSource();
            source.buffer = buffer;
            source.loop = true;
            var highpass = context.createBiquadFilter();
            highpass.type = "highpass";
            highpass.frequency.value = 180;
            var lowpass = context.createBiquadFilter();
            lowpass.type = "lowpass";
            lowpass.frequency.value = 1800;
            var gain = context.createGain();
            gain.gain.value = 0.055;
            source.connect(highpass);
            highpass.connect(lowpass);
            lowpass.connect(gain);
            gain.connect(master);
            source.start();
            ambient = source;
        }

        function prime() {
            var AudioContextClass = window.AudioContext || window.webkitAudioContext;
            if (!AudioContextClass) return Promise.resolve(false);
            if (!context) {
                context = new AudioContextClass();
                master = context.createGain();
                master.gain.value = muted ? 0 : 0.72;
                master.connect(context.destination);
            }
            var resume = context.state === "suspended" ? context.resume() : Promise.resolve();
            return resume.then(function () {
                if (!started) {
                    started = true;
                    createRain();
                }
                if (!musicPaused) {
                    startMusic();
                }
                setGain();
                return true;
            }).catch(function () {
                return false;
            });
        }

        function tone(frequency, start, duration, volume, type) {
            if (!context || !master || context.state !== "running" || muted) return;
            var oscillator = context.createOscillator();
            var gain = context.createGain();
            oscillator.type = type || "sine";
            oscillator.frequency.setValueAtTime(frequency, start);
            gain.gain.setValueAtTime(0.0001, start);
            gain.gain.exponentialRampToValueAtTime(volume, start + 0.035);
            gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
            oscillator.connect(gain);
            gain.connect(master);
            oscillator.start(start);
            oscillator.stop(start + duration + 0.04);
        }

        function play(kind) {
            if (!context || context.state !== "running" || muted) return;
            var now = context.currentTime + 0.01;
            if (kind === "flower") {
                tone(523.25, now, 0.75, 0.075, "sine");
                tone(659.25, now + 0.13, 0.8, 0.06, "sine");
                tone(783.99, now + 0.28, 1.0, 0.045, "sine");
            } else if (kind === "key") {
                tone(329.63, now, 0.4, 0.05, "triangle");
                tone(493.88, now + 0.08, 0.8, 0.075, "sine");
                tone(987.77, now + 0.16, 0.95, 0.035, "sine");
            } else if (kind === "page") {
                tone(392, now, 0.18, 0.025, "sine");
            } else if (kind === "door") {
                tone(98, now, 1.4, 0.07, "triangle");
                tone(146.83, now + 0.26, 1.6, 0.045, "sine");
            }
        }

        function toggle() {
            muted = !muted;
            storeMuted(muted);
            setGain();
            return muted;
        }

        function toggleMusic() {
            musicPaused = !musicPaused;
            if (musicPaused) {
                if (music) music.pause();
            } else {
                startMusic();
            }
            return musicPaused;
        }

        function stopMusic() {
            musicPaused = true;
            if (music) {
                music.pause();
                try { music.currentTime = 0; } catch (_) {}
            }
        }

        return {
            prime: prime,
            play: play,
            toggle: toggle,
            toggleMusic: toggleMusic,
            stopMusic: stopMusic,
            isMusicPaused: function () { return musicPaused; },
            isMuted: function () { return muted; }
        };
    }());

    function bindStaticUi() {
        var soundButton = document.getElementById("entry-sound");
        if (!soundButton || soundButton.dataset.bound === "true") return;
        soundButton.dataset.bound = "true";

        function sync() {
            var paused = soundscape.isMusicPaused();
            soundButton.classList.toggle("is-muted", paused);
            soundButton.setAttribute("aria-label", paused ? "继续音乐" : "暂停音乐");
            soundButton.title = paused ? "继续音乐" : "暂停音乐";
        }

        soundButton.addEventListener("click", function (event) {
            event.stopPropagation();
            soundscape.prime().then(function () {
                soundscape.toggleMusic();
                sync();
            });
        });
        sync();
    }

    function createMaterial(pc, app, options) {
        var material = new pc.StandardMaterial();
        var diffuse = options.diffuse || [1, 1, 1];
        var emissive = options.emissive || [0, 0, 0];
        material.diffuse.set(diffuse[0], diffuse[1], diffuse[2]);
        material.emissive.set(emissive[0], emissive[1], emissive[2]);
        material.emissiveIntensity = options.emissiveIntensity || 0;
        material.useMetalness = true;
        material.metalness = options.metalness || 0;
        material.gloss = options.gloss === undefined ? 0.45 : options.gloss;
        material.cull = pc.CULLFACE_NONE;
        material.useLighting = false;
        material.useFog = false;
        material.depthTest = false;
        material.depthWrite = false;
        if (options.opacity !== undefined && options.opacity < 1) {
            material.opacity = options.opacity;
            material.blendType = pc.BLEND_NORMAL;
        }
        material.update();
        app.on("destroy", function () { material.destroy(); });
        return material;
    }

    function createPrimitive(pc, app, parent, name, type, material, position, scale, rotation) {
        var entity = new pc.Entity(name);
        entity.addComponent("render", {
            type: type,
            material: material,
            layers: [pc.LAYERID_IMMEDIATE]
        });
        entity.setLocalPosition(position[0], position[1], position[2]);
        entity.setLocalScale(scale[0], scale[1], scale[2]);
        entity.setLocalEulerAngles(rotation[0], rotation[1], rotation[2]);
        parent.addChild(entity);
        return entity;
    }

    function createHeldItems(options) {
        var pc = window.pc;
        var app = options.app;
        var camera = options.camera;
        var root = new pc.Entity("DreamHeldItemRig");
        root.setLocalPosition(0.18, -0.175, -0.36);
        root.setLocalEulerAngles(-5, -8, -9);
        root.setLocalScale(0.25, 0.25, 0.25);
        camera.addChild(root);

        var hand = createMaterial(pc, app, {
            diffuse: [0.34, 0.29, 0.25],
            emissive: [0.035, 0.028, 0.022],
            emissiveIntensity: 0.32,
            gloss: 0.28
        });
        var sleeve = createMaterial(pc, app, {
            diffuse: [0.035, 0.044, 0.048],
            emissive: [0.008, 0.014, 0.016],
            emissiveIntensity: 0.2,
            gloss: 0.12
        });
        var stem = createMaterial(pc, app, {
            diffuse: [0.14, 0.34, 0.25],
            emissive: [0.07, 0.24, 0.16],
            emissiveIntensity: 1.0,
            gloss: 0.38
        });
        var petalBack = createMaterial(pc, app, {
            diffuse: [0.48, 0.50, 0.72],
            emissive: [0.24, 0.28, 0.50],
            emissiveIntensity: 0.88,
            gloss: 0.66
        });
        var petalFront = createMaterial(pc, app, {
            diffuse: [0.82, 0.83, 0.92],
            emissive: [0.42, 0.48, 0.66],
            emissiveIntensity: 0.94,
            gloss: 0.72
        });
        var flowerHeart = createMaterial(pc, app, {
            diffuse: [0.74, 0.56, 0.19],
            emissive: [0.48, 0.31, 0.07],
            emissiveIntensity: 1.05,
            gloss: 0.58
        });
        var brass = createMaterial(pc, app, {
            diffuse: [0.62, 0.42, 0.15],
            emissive: [0.55, 0.32, 0.08],
            emissiveIntensity: 1.20,
            metalness: 0,
            gloss: 0.78
        });
        var brassDark = createMaterial(pc, app, {
            diffuse: [0.31, 0.19, 0.065],
            emissive: [0.22, 0.12, 0.025],
            emissiveIntensity: 0.92,
            metalness: 0,
            gloss: 0.64
        });

        createPrimitive(pc, app, root, "DreamSleeve", "cylinder", sleeve, [0.045, -0.105, 0.04], [0.075, 0.18, 0.075], [70, 0, 14]);
        createPrimitive(pc, app, root, "DreamPalm", "sphere", hand, [0.015, -0.005, 0], [0.095, 0.065, 0.12], [8, 0, -12]);
        createPrimitive(pc, app, root, "DreamThumb", "capsule", hand, [-0.038, 0.045, -0.005], [0.025, 0.055, 0.025], [0, 0, 36]);
        createPrimitive(pc, app, root, "DreamFingerA", "capsule", hand, [0.008, 0.052, -0.025], [0.022, 0.056, 0.022], [0, 0, -7]);
        createPrimitive(pc, app, root, "DreamFingerB", "capsule", hand, [0.038, 0.047, -0.02], [0.021, 0.052, 0.021], [0, 0, -13]);

        var flower = new pc.Entity("MirrorBlossomHeld");
        flower.setLocalEulerAngles(0, -6, 5);
        root.addChild(flower);
        createPrimitive(pc, app, flower, "MirrorStem", "cylinder", stem, [-0.008, 0.265, 0], [0.008, 0.235, 0.008], [0, 0, 2]);
        createPrimitive(pc, app, flower, "MirrorLeafA", "sphere", stem, [-0.052, 0.225, 0], [0.018, 0.082, 0.009], [0, 0, 40]);
        createPrimitive(pc, app, flower, "MirrorLeafB", "sphere", stem, [0.046, 0.315, 0], [0.016, 0.070, 0.009], [0, 0, -46]);

        // A six-petal iris silhouette reads as a rare dream flower instead of a daisy.
        createPrimitive(pc, app, flower, "MirrorPetalBackL", "sphere", petalBack, [-0.050, 0.485, -0.010], [0.040, 0.115, 0.018], [10, 8, 34]);
        createPrimitive(pc, app, flower, "MirrorPetalBackC", "sphere", petalBack, [0.000, 0.515, -0.016], [0.043, 0.128, 0.019], [8, 0, 0]);
        createPrimitive(pc, app, flower, "MirrorPetalBackR", "sphere", petalBack, [0.050, 0.485, -0.010], [0.040, 0.115, 0.018], [10, -8, -34]);
        createPrimitive(pc, app, flower, "MirrorPetalFrontL", "sphere", petalFront, [-0.066, 0.415, 0.012], [0.050, 0.120, 0.021], [-8, 10, 58]);
        createPrimitive(pc, app, flower, "MirrorPetalFrontC", "sphere", petalFront, [0.000, 0.382, 0.025], [0.060, 0.132, 0.024], [-12, 0, 0]);
        createPrimitive(pc, app, flower, "MirrorPetalFrontR", "sphere", petalFront, [0.066, 0.415, 0.012], [0.050, 0.120, 0.021], [-8, -10, -58]);
        createPrimitive(pc, app, flower, "MirrorHeart", "sphere", flowerHeart, [0, 0.440, 0.045], [0.028, 0.032, 0.022], [0, 0, 0]);
        createPrimitive(pc, app, flower, "MirrorThroat", "capsule", flowerHeart, [0, 0.405, 0.043], [0.010, 0.042, 0.010], [0, 0, 0]);

        var key = new pc.Entity("SunKeyHeld");
        key.setLocalPosition(-0.02, 0.34, 0);
        key.setLocalEulerAngles(0, 8, -14);
        key.setLocalScale(1.10, 1.10, 1.10);
        root.addChild(key);
        var ringSegments = 14;
        for (var segment = 0; segment < ringSegments; segment += 1) {
            var ringAngle = (Math.PI * 2 * segment) / ringSegments;
            createPrimitive(
                pc,
                app,
                key,
                "KeyRing" + segment,
                "cylinder",
                brass,
                [Math.cos(ringAngle) * 0.082, 0.16 + Math.sin(ringAngle) * 0.082, 0],
                [0.014, 0.034, 0.014],
                [0, 0, -ringAngle * 180 / Math.PI]
            );
        }
        createPrimitive(pc, app, key, "SunSeal", "sphere", brass, [0, 0.16, 0.006], [0.055, 0.055, 0.018], [0, 0, 0]);
        createPrimitive(pc, app, key, "SunSealCore", "sphere", brassDark, [0, 0.16, 0.027], [0.021, 0.021, 0.008], [0, 0, 0]);
        createPrimitive(pc, app, key, "KeyStem", "box", brassDark, [0, -0.035, 0], [0.030, 0.25, 0.030], [0, 0, 0]);
        createPrimitive(pc, app, key, "KeyBitA", "box", brass, [0.048, -0.145, 0], [0.085, 0.030, 0.032], [0, 0, 0]);
        createPrimitive(pc, app, key, "KeyBitB", "box", brassDark, [0.068, -0.102, 0], [0.038, 0.052, 0.032], [0, 0, 0]);

        flower.enabled = false;
        key.enabled = false;
        root.enabled = false;

        return {
            root: root,
            flower: flower,
            key: key,
            set: function (kind) {
                flower.enabled = kind === "flower";
                key.enabled = kind === "key";
                root.enabled = Boolean(kind);
            },
            update: function (time, lowered) {
                if (!root.enabled) return;
                var lower = lowered ? -0.05 : 0;
                root.setLocalPosition(
                    0.18 + (Math.sin(time * 0.88) * 0.0025),
                    -0.175 + lower + (Math.sin(time * 1.35) * 0.002),
                    -0.36
                );
                root.setLocalEulerAngles(-5 + (Math.sin(time * 0.72) * 0.8), -8, -9 + (Math.sin(time * 0.55) * 0.9));
                flower.setLocalEulerAngles(0, -6 + (Math.sin(time * 0.65) * 1.1), 5 + (Math.sin(time * 0.52) * 0.8));
                key.setLocalEulerAngles(0, 8 + (Math.sin(time * 0.8) * 1.6), -14 + (Math.sin(time * 0.57) * 0.8));
            }
        };
    }

    function createController(options) {
        var pc = window.pc;
        var state = readState();
        var app = options.app;
        var camera = options.camera;
        var character = options.characterEntity;
        var catEntity = options.catEntity;
        var catModel = options.catModel;
        var catAnim = catModel && catModel.anim ? catModel.anim : null;
        var getLook = options.getLook;
        var setLook = options.setLook;
        var getGroundY = options.getGroundY;
        var onInputLockChange = options.onInputLockChange;
        var exitDoor = options.exitDoor || { position: [-0.42, -1.43], radius: 0.42 };

        var objective = document.getElementById("dream-objective");
        var objectiveChapter = document.getElementById("dream-objective-chapter");
        var objectiveTitle = document.getElementById("dream-objective-title");
        var objectiveDetail = document.getElementById("dream-objective-detail");
        var inventory = document.getElementById("inventory-hud");
        var toast = document.getElementById("dream-toast");
        var dialogue = document.getElementById("dream-dialogue");
        var dialogueSpeaker = document.getElementById("dream-dialogue-speaker");
        var dialogueLine = document.getElementById("dream-dialogue-line");
        var dialogueNext = document.getElementById("dream-dialogue-next");
        var dialogueProgress = document.getElementById("dream-dialogue-progress");
        var reward = document.getElementById("dream-reward");
        var rewardEyebrow = document.getElementById("dream-reward-eyebrow");
        var rewardName = document.getElementById("dream-reward-name");
        var rewardCopy = document.getElementById("dream-reward-copy");
        var victory = document.getElementById("dream-victory");
        var victoryTime = document.getElementById("dream-victory-time");
        var victoryRestart = document.getElementById("dream-victory-restart");
        var victoryTitle = document.getElementById("dream-victory-title-button");
        var transition = document.getElementById("transition-overlay");
        var heldItems = createHeldItems(options);

        var elapsed = 0;
        var started = false;
        var mode = "idle";
        var modeTime = 0;
        var inputLocked = false;
        var lookLimited = false;
        var lookAnchor = getLook ? getLook() : { yaw: 0, pitch: 0 };
        var toastTimer = 0;
        var rewardTimer = 0;
        var rewardCallback = null;
        var dialogueState = null;
        var catGesture = 0;
        var catTarget = null;
        var catArrival = null;
        var catAfterArrival = null;
        var catSpeed = 0.24;
        var exitTriggerArmed = false;
        var notifiedInputLocked = null;

        var catBaseScale = catModel ? catModel.getLocalScale().clone() : new pc.Vec3(1, 1, 1);
        var catBones = {
            head: catModel && catModel.findByName("Head"),
            neck: catModel && (catModel.findByName("Neck") || catModel.findByName("Neck.001")),
            leftEar: catModel && (catModel.findByName("Ear.L") || catModel.findByName("EarLeft") || catModel.findByName("Ear_L")),
            rightEar: catModel && (catModel.findByName("Ear.R") || catModel.findByName("EarRight") || catModel.findByName("Ear_R")),
            tail: []
        };
        if (catModel) {
            var tailRoot = catModel.findByName("Tail");
            if (tailRoot) catBones.tail.push(tailRoot);
            for (var tailIndex = 1; tailIndex <= 7; tailIndex += 1) {
                var tailName = "Tail." + String(tailIndex).padStart(3, "0");
                var tailBone = catModel.findByName(tailName);
                if (tailBone) catBones.tail.push(tailBone);
            }
        }

        function captureBase(node) {
            if (!node) return null;
            var localEuler = new pc.Vec3();
            node.getLocalRotation().getEulerAngles(localEuler);
            return localEuler;
        }

        var catBoneBases = {
            head: captureBase(catBones.head),
            neck: captureBase(catBones.neck),
            leftEar: captureBase(catBones.leftEar),
            rightEar: captureBase(catBones.rightEar),
            tail: catBones.tail.map(captureBase)
        };

        function setNodeOffset(node, base, x, y, z) {
            if (!node || !base) return;
            node.setLocalEulerAngles(base.x + x, base.y + y, base.z + z);
        }

        function refreshState() {
            state = readState();
            return state;
        }

        function patchState(patch) {
            state = saveState(patch);
            syncUi();
            return state;
        }

        function formatTime(milliseconds) {
            var seconds = Math.max(0, Math.floor(milliseconds / 1000));
            var minutes = Math.floor(seconds / 60);
            return String(minutes).padStart(2, "0") + ":" + String(seconds % 60).padStart(2, "0");
        }

        function getObjective() {
            if (!state.introComplete) {
                return null;
            }
            if (!state.mirrorComplete) {
                return {
                    chapter: "第一重梦 · 希望",
                    title: "走近镜面",
                    detail: "镜子后面，藏着一朵不肯醒来的花。"
                };
            }
            if (state.flowerOwned) {
                return {
                    chapter: "梦境回响 · 镜生花",
                    title: "唤醒向日葵",
                    detail: "把手中的光，交给窗前沉睡的花。"
                };
            }
            if (!state.sunKey) {
                return {
                    chapter: "第二与第三重梦",
                    title: "穿过错位与黑暗",
                    detail: "辨认假象，照亮恐惧，把钥匙带回来。"
                };
            }
            if (!state.keyDialogueComplete) {
                return {
                    chapter: "归途 · 引路者",
                    title: "听听黑猫的话",
                    detail: "这把钥匙记得门的方向。"
                };
            }
            if (!state.won) {
                return {
                    chapter: "终章 · 门",
                    title: "回到醒来时身后的门",
                    detail: "握紧日照钥匙，靠近房门。"
                };
            }
            return null;
        }

        function syncUi() {
            refreshState();
            var currentObjective = getObjective();
            if (objective) {
                objective.classList.toggle("is-visible", Boolean(currentObjective) && !inputLocked && mode !== "victory");
            }
            if (currentObjective) {
                if (objectiveChapter) objectiveChapter.textContent = currentObjective.chapter;
                if (objectiveTitle) objectiveTitle.textContent = currentObjective.title;
                if (objectiveDetail) objectiveDetail.textContent = currentObjective.detail;
            }

            var heldKind = state.flowerOwned ? "flower" : (state.sunKey && !state.keyUsed ? "key" : null);
            heldItems.set(heldKind);
            if (inventory) {
                inventory.classList.toggle("is-visible", Boolean(heldKind));
                inventory.textContent = heldKind === "flower" ? "镜生花" : (heldKind === "key" ? "日照钥匙" : "");
            }

            if (notifiedInputLocked !== inputLocked) {
                notifiedInputLocked = inputLocked;
                if (onInputLockChange) onInputLockChange(inputLocked);
            }
        }

        function showToast(message, seconds) {
            if (!toast) return;
            toast.textContent = message;
            toast.classList.add("is-visible");
            toastTimer = seconds || 3.6;
        }

        function showReward(kind, callback) {
            inputLocked = true;
            lookLimited = true;
            rewardCallback = callback || null;
            rewardTimer = kind === "flower" ? 2.8 : 2.35;
            if (rewardEyebrow) rewardEyebrow.textContent = kind === "flower" ? "第一重梦的回赠" : "三重梦境的回响";
            if (rewardName) rewardName.textContent = kind === "flower" ? "镜生花" : "日照钥匙";
            if (rewardCopy) rewardCopy.textContent = kind === "flower"
                ? "它只在被光真正看见时盛开。"
                : "它不保证醒来，只替你指出下一扇门。";
            if (reward) reward.classList.add("is-visible");
            soundscape.play(kind);
            syncUi();
        }

        function finishReward() {
            rewardTimer = 0;
            if (reward) reward.classList.remove("is-visible");
            var callback = rewardCallback;
            rewardCallback = null;
            if (callback) {
                callback();
            } else {
                inputLocked = false;
                lookLimited = false;
                syncUi();
            }
        }

        function showDialogue(lines, onComplete) {
            inputLocked = true;
            lookLimited = true;
            var currentLook = getLook ? getLook() : { yaw: 0, pitch: 0 };
            lookAnchor = { yaw: currentLook.yaw, pitch: currentLook.pitch };
            dialogueState = {
                lines: lines,
                index: 0,
                visibleChars: 0,
                charAccumulator: 0,
                ready: false,
                onComplete: onComplete
            };
            if (document.pointerLockElement) document.exitPointerLock();
            if (dialogue) dialogue.classList.add("is-visible");
            if (dialogueSpeaker) dialogueSpeaker.textContent = "引路者 · 黑猫";
            renderDialogue();
            syncUi();
        }

        function renderDialogue() {
            if (!dialogueState) return;
            var fullLine = dialogueState.lines[dialogueState.index];
            if (dialogueLine) dialogueLine.textContent = fullLine.slice(0, dialogueState.visibleChars);
            if (dialogueProgress) {
                dialogueProgress.textContent = (dialogueState.index + 1) + " / " + dialogueState.lines.length;
            }
            if (dialogueNext) dialogueNext.classList.toggle("is-ready", dialogueState.ready);
        }

        function advanceDialogue() {
            if (!dialogueState || !dialogueState.ready) return false;
            soundscape.play("page");
            catGesture = 1;
            if (dialogueState.index < dialogueState.lines.length - 1) {
                dialogueState.index += 1;
                dialogueState.visibleChars = 0;
                dialogueState.charAccumulator = 0;
                dialogueState.ready = false;
                renderDialogue();
                return true;
            }

            var callback = dialogueState.onComplete;
            dialogueState = null;
            if (dialogue) dialogue.classList.remove("is-visible");
            if (dialogueNext) dialogueNext.classList.remove("is-ready");
            inputLocked = false;
            lookLimited = false;
            if (callback) callback();
            syncUi();
            return true;
        }

        if (dialogueNext) {
            dialogueNext.addEventListener("click", function () {
                advanceDialogue();
            });
        }

        function normalizeAngle(value) {
            var result = value;
            while (result > 180) result -= 360;
            while (result < -180) result += 360;
            return result;
        }

        function approachCat(kind, afterArrival) {
            var player = character.getPosition();
            var floorY = player.y;
            var start = kind === "opening"
                ? new pc.Vec3(-0.74, floorY, -0.28)
                : new pc.Vec3(-0.70, floorY, -0.42);
            var arrival = kind === "opening"
                ? new pc.Vec3(-0.76, floorY, -1.03)
                : new pc.Vec3(-0.62, floorY, -0.96);

            if (getGroundY) {
                var startGround = getGroundY(start.x, start.z, floorY + 0.45);
                var arrivalGround = getGroundY(arrival.x, arrival.z, floorY + 0.45);
                if (Number.isFinite(startGround)) start.y = startGround;
                if (Number.isFinite(arrivalGround)) arrival.y = arrivalGround;
            }

            catEntity.setPosition(start);
            catTarget = arrival;
            catArrival = null;
            catAfterArrival = afterArrival;
            catSpeed = kind === "opening" ? 0.23 : 0.28;
            mode = "cat-approach";
            modeTime = 0;
            inputLocked = true;
            lookLimited = true;
            if (catAnim) catAnim.speed = 1;
            syncUi();
        }

        function updateCatApproach(dt) {
            if (!catTarget) return;
            var position = catEntity.getPosition();
            var dx = catTarget.x - position.x;
            var dz = catTarget.z - position.z;
            var distance = Math.hypot(dx, dz);
            if (distance > 0.012) {
                var step = Math.min(distance, catSpeed * dt);
                var x = position.x + (dx / distance) * step;
                var z = position.z + (dz / distance) * step;
                var y = position.y;
                if (getGroundY) {
                    var ground = getGroundY(x, z, position.y + 0.45);
                    if (Number.isFinite(ground)) y += (ground - y) * Math.min(1, dt * 8);
                }
                catEntity.setPosition(x, y, z);
                catEntity.setEulerAngles(0, Math.atan2(dx, dz) * 180 / Math.PI, 0);
            } else if (!catArrival) {
                catEntity.setPosition(catTarget);
                catArrival = 0.52;
                if (catAnim) catAnim.speed = 0.055;
            }

            var player = character.getPosition();
            var cat = catEntity.getPosition();
            var cameraDx = cat.x - player.x;
            var cameraDz = cat.z - player.z;
            var desiredYaw = Math.atan2(-cameraDx, -cameraDz) * 180 / Math.PI;
            var current = getLook ? getLook() : { yaw: desiredYaw, pitch: 0 };
            var yawDelta = normalizeAngle(desiredYaw - current.yaw);
            var nextYaw = current.yaw + (yawDelta * Math.min(1, dt * 2.5));
            var nextPitch = current.pitch + ((-8 - current.pitch) * Math.min(1, dt * 2.3));
            lookAnchor = { yaw: nextYaw, pitch: nextPitch };
            if (setLook) setLook(nextYaw, nextPitch);

            if (catArrival !== null) {
                catArrival -= dt;
                if (catArrival <= 0) {
                    mode = "cat-idle";
                    modeTime = 0;
                    var callback = catAfterArrival;
                    catAfterArrival = null;
                    if (callback) callback();
                }
            }
        }

        function updateCatIdle(time, dt) {
            if (!catModel) return;
            catGesture = Math.max(0, catGesture - (dt * 1.35));
            var breath = Math.sin(time * 1.72) * 0.008;
            catModel.setLocalScale(
                catBaseScale.x * (1 - breath * 0.35),
                catBaseScale.y * (1 + breath),
                catBaseScale.z * (1 - breath * 0.35)
            );

            var player = character.getPosition();
            var cat = catEntity.getPosition();
            var desired = Math.atan2(player.x - cat.x, player.z - cat.z) * 180 / Math.PI;
            var currentEuler = new pc.Vec3();
            catEntity.getRotation().getEulerAngles(currentEuler);
            var currentYaw = currentEuler.y;
            var bodyDelta = pc.math.clamp(normalizeAngle(desired - currentYaw), -12, 12);
            var headNod = (Math.sin(time * 0.66) * 1.5) - (catGesture * 4.5);
            setNodeOffset(catBones.neck, catBoneBases.neck, headNod * 0.35, bodyDelta * 0.3, 0);
            setNodeOffset(catBones.head, catBoneBases.head, headNod, bodyDelta * 0.55, Math.sin(time * 0.48) * 1.2);

            var earFlick = Math.pow(Math.max(0, Math.sin(time * 1.93)), 18) * 9;
            setNodeOffset(catBones.leftEar, catBoneBases.leftEar, earFlick, 0, Math.sin(time * 0.72) * 1.6);
            setNodeOffset(catBones.rightEar, catBoneBases.rightEar, -earFlick * 0.65, 0, Math.sin(time * 0.67 + 1.4) * 1.4);

            for (var i = 0; i < catBones.tail.length; i += 1) {
                var phase = time * 1.05 - (i * 0.38);
                var amplitude = 3.2 + (i * 0.72);
                setNodeOffset(catBones.tail[i], catBoneBases.tail[i], 0, Math.sin(phase) * amplitude, Math.cos(phase * 0.72) * 1.4);
            }
        }

        function beginOpening() {
            approachCat("opening", function () {
                showDialogue(OPENING_DIALOGUE, function () {
                    patchState({ introComplete: true });
                    mode = "cat-idle";
                    showToast("第一重梦已经苏醒。", 2.8);
                    if (window.EndlessDreamGameShell && window.EndlessDreamGameShell.showRoomIntro) {
                        window.EndlessDreamGameShell.showRoomIntro();
                    }
                });
            });
        }

        function beginKeyReturn() {
            showReward("key", function () {
                approachCat("return", function () {
                    showDialogue(KEY_DIALOGUE, function () {
                        patchState({ keyDialogueComplete: true });
                        mode = "cat-idle";
                    });
                });
            });
        }

        function start() {
            if (started) return;
            started = true;
            state = readState();
            if (!state.startedAt) state = saveState({ startedAt: Date.now() });
            bindStaticUi();

            // Deferred narrative beats must be locked from the first playable frame so
            // their short setup delays never become movement windows.
            var startsWithLockedSequence = !state.introComplete ||
                (options.resumeSource === "greenhouse" && state.flowerOwned) ||
                (state.sunKey && !state.keyDialogueComplete) ||
                state.won;
            if (startsWithLockedSequence) {
                inputLocked = true;
                lookLimited = true;
                var openingLook = getLook ? getLook() : { yaw: 0, pitch: 0 };
                lookAnchor = { yaw: openingLook.yaw, pitch: openingLook.pitch };
            }
            syncUi();

            if (!state.introComplete) {
                window.setTimeout(beginOpening, 520);
                return;
            }

            if (options.resumeSource === "greenhouse" && state.flowerOwned) {
                mode = "cat-idle";
                window.setTimeout(function () {
                    showReward("flower", function () {
                        inputLocked = false;
                        lookLimited = false;
                        mode = "cat-idle";
                        showToast("镜生花正在回应窗前的向日葵。", 3.1);
                        syncUi();
                    });
                }, 420);
                return;
            }

            if (state.sunKey && !state.keyDialogueComplete) {
                window.setTimeout(beginKeyReturn, 520);
                return;
            }

            if (state.won) {
                window.setTimeout(showVictory, 120);
                return;
            }

            mode = "cat-idle";
            inputLocked = false;
            lookLimited = false;
            syncUi();
        }

        function handleKeyDown(event) {
            if (dialogueState) {
                if (!event.repeat && (event.code === "KeyE" || event.code === "Enter" || event.code === "Space")) {
                    advanceDialogue();
                }
                return true;
            }
            if (mode === "victory" || mode === "door-transition" || rewardTimer > 0 || mode === "cat-approach") {
                return true;
            }
            return false;
        }

        function applyLookDelta(yaw, pitch, movementX, movementY) {
            if (inputLocked || mode === "victory" || mode === "door-transition") {
                return { yaw: yaw, pitch: pitch };
            }
            if (!lookLimited) {
                return {
                    yaw: yaw - (movementX * 0.08),
                    pitch: pc.math.clamp(pitch - (movementY * 0.08), -75, 75)
                };
            }
            var nextYaw = yaw - (movementX * 0.05);
            var nextPitch = pitch - (movementY * 0.05);
            var yawDelta = pc.math.clamp(normalizeAngle(nextYaw - lookAnchor.yaw), -18, 18);
            nextYaw = lookAnchor.yaw + yawDelta;
            nextPitch = pc.math.clamp(nextPitch, lookAnchor.pitch - 10, lookAnchor.pitch + 10);
            return { yaw: nextYaw, pitch: nextPitch };
        }

        function getPortalLabel(kind) {
            if (kind === "mirror") return "触碰镜面";
            if (kind === "sunflower") {
                return state.flowerOwned || state.flowerOffered ? "唤醒向日葵" : "倾听向日葵";
            }
            return "";
        }

        function canEnterSunflower() {
            return Boolean(state.flowerOwned || (state.flowerOffered && !state.sunKey));
        }

        function denySunflower() {
            showToast("黑猫：向日葵还在沉睡。先去镜中，把那朵花带回来。", 4.2);
            soundscape.play("page");
        }

        function offerFlower() {
            refreshState();
            if (state.flowerOwned) {
                patchState({ flowerOwned: false, flowerOffered: true });
                showToast("镜生花化作微光，沉进向日葵的花心。", 2.9);
                soundscape.play("flower");
            }
        }

        function segmentTouchesCircle(x0, z0, x1, z1, cx, cz, radius) {
            var dx = x1 - x0;
            var dz = z1 - z0;
            var lengthSquared = (dx * dx) + (dz * dz);
            var t = lengthSquared > 0
                ? (((cx - x0) * dx) + ((cz - z0) * dz)) / lengthSquared
                : 0;
            t = pc.math.clamp(t, 0, 1);
            var nearestX = x0 + (dx * t);
            var nearestZ = z0 + (dz * t);
            var offsetX = nearestX - cx;
            var offsetZ = nearestZ - cz;
            return (offsetX * offsetX) + (offsetZ * offsetZ) <= radius * radius;
        }

        function showVictory() {
            mode = "victory";
            inputLocked = true;
            lookLimited = true;
            soundscape.stopMusic();
            transition.classList.remove("is-active");
            if (victoryTime) {
                var startedAt = state.startedAt || Date.now();
                var finishedAt = state.finishedAt || Date.now();
                victoryTime.textContent = formatTime(finishedAt - startedAt);
            }
            if (victory) victory.classList.add("is-visible");
            syncUi();
        }

        function triggerDoor() {
            if (mode === "door-transition" || mode === "victory") return;
            mode = "door-transition";
            inputLocked = true;
            lookLimited = true;
            state = patchState({ keyUsed: true, won: true, finishedAt: Date.now() });
            heldItems.set(null);
            if (inventory) inventory.classList.remove("is-visible");
            if (document.pointerLockElement) document.exitPointerLock();
            soundscape.play("door");
            if (transition) transition.classList.add("is-active");
            window.setTimeout(showVictory, 1200);
        }

        function updateExitTrigger(fromX, fromZ, toX, toZ) {
            if (!state.sunKey || !state.keyDialogueComplete || state.won || mode === "victory") return;
            var position = exitDoor.position;
            var toDx = toX - position[0];
            var toDz = toZ - position[1];
            var toInside = (toDx * toDx) + (toDz * toDz) <= exitDoor.radius * exitDoor.radius;
            if (!exitTriggerArmed) {
                if (!toInside) exitTriggerArmed = true;
                return;
            }
            if (segmentTouchesCircle(fromX, fromZ, toX, toZ, position[0], position[1], exitDoor.radius)) {
                triggerDoor();
            }
        }

        if (victoryRestart) {
            victoryRestart.addEventListener("click", function () {
                clearState();
                var restartUrl = new URL(window.location.href);
                restartUrl.search = "?autostart=1";
                window.location.replace(restartUrl.href);
            });
        }

        if (victoryTitle) {
            victoryTitle.addEventListener("click", function () {
                clearState();
                var titleUrl = new URL(window.location.href);
                titleUrl.search = "";
                window.location.replace(titleUrl.href);
            });
        }

        function update(dt) {
            elapsed += dt;
            modeTime += dt;
            if (toastTimer > 0) {
                toastTimer = Math.max(0, toastTimer - dt);
                if (toastTimer === 0 && toast) toast.classList.remove("is-visible");
            }
            if (rewardTimer > 0) {
                rewardTimer = Math.max(0, rewardTimer - dt);
                if (rewardTimer === 0) finishReward();
            }
            if (dialogueState) {
                var line = dialogueState.lines[dialogueState.index];
                if (dialogueState.visibleChars < line.length) {
                    dialogueState.charAccumulator += dt * 24;
                    var count = Math.floor(dialogueState.charAccumulator);
                    if (count > 0) {
                        dialogueState.visibleChars = Math.min(line.length, dialogueState.visibleChars + count);
                        dialogueState.charAccumulator -= count;
                        if (dialogueState.visibleChars === line.length) dialogueState.ready = true;
                        renderDialogue();
                    }
                }
            }
            if (mode === "cat-approach") updateCatApproach(dt);
            if (mode === "cat-idle" || dialogueState) updateCatIdle(elapsed, dt);
            heldItems.update(elapsed, Boolean(dialogueState) || rewardTimer > 0 || mode === "victory");
        }

        return {
            start: start,
            update: update,
            updateExitTrigger: updateExitTrigger,
            handleKeyDown: handleKeyDown,
            applyLookDelta: applyLookDelta,
            isInputLocked: function () { return inputLocked; },
            isLookLimited: function () { return lookLimited; },
            isMirrorAvailable: function () { return !state.mirrorComplete && !state.sunKey; },
            isSunflowerAvailable: function () { return !state.sunKey; },
            getPortalLabel: getPortalLabel,
            canEnterSunflower: canEnterSunflower,
            denySunflower: denySunflower,
            offerFlower: offerFlower,
            refresh: syncUi
        };
    }

    window.EndlessDream = Object.freeze({
        STATE_KEY: STATE_KEY,
        getState: readState,
        saveState: saveState,
        clearState: clearState,
        primeAudio: soundscape.prime,
        stopMusic: soundscape.stopMusic,
        bindStaticUi: bindStaticUi,
        createController: createController
    });

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", bindStaticUi, { once: true });
    } else {
        bindStaticUi();
    }
}());

