"use strict";
/* =================================================================
   GAME CONNECTOR — Canvas-ДВИЖОК
   engine.js — сердце, снаряды, шаблоны атак, рендер, watchdog.

   Загружается ПОСЛЕ script.js. Общая шина состояния: G (script.js).
   Требования движка:
     • Обязательный watchdog: 7 сек -> очистка bullets -> endAttack.
     • Базовый урон босса +0.5 за раунд.
     • ТУРБО-атаки (без «СПРИНТ»): «ШИНЫ ИЗ ПИТ-СТОПА», «ТОПЛИВО»,
       «КЛЕТЧАТЫЙ ФЛАГ», «В ЦЕНТР».
     • Радиус хитбокса сердца уменьшен на 30%.
   ================================================================= */

/* ------------------------- КОНСТАНТЫ ------------------------- */
const CV_W = 640, CV_H = 480;                      // логический размер канваса
const ARENA = { x: 190, y: 190, w: 260, h: 260 };  // арена сердца
const HEART_SPEED = 175;                            // скорость сердца, px/сек
const FIGHT_DMG_MIN = 28, FIGHT_DMG_MAX = 42;       // урон игрока за [АТАКА]

/* Обязательный watchdog атаки: 7 секунд и очистка поля. */
const ATTACK_WATCHDOG_MS = 7000;

/* ------------------------- КАНВАС / СЕРДЦЕ ------------------------- */
const cv = $("cv");
const ctx = cv.getContext("2d");
const heart = { x: ARENA.x + ARENA.w / 2, y: ARENA.y + ARENA.h / 2 };

G.arenaInset = 0;

/* ------------------------- ГЕОМЕТРИЯ / РИСОВАНИЕ ------------------------- */
function rect(x, y, w, h, c) {
    ctx.fillStyle = c;
    ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}
function glowRect(x, y, w, h, c, blur) {
    ctx.save();
    ctx.shadowColor = c; ctx.shadowBlur = blur;
    ctx.fillStyle = c;
    ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
    ctx.restore();
}
/* Отрисовка пиксель-карты (сердце, спрайты) */
function drawPixelMap(map, cx, cy, scale, color) {
    ctx.fillStyle = color;
    for (let r = 0; r < map.length; r++) {
        for (let c = 0; c < map[r].length; c++) {
            if (map[r][c] === "1") {
                ctx.fillRect(Math.round(cx + (c - map[r].length / 2) * scale),
                             Math.round(cy + (r - map.length / 2) * scale),
                             Math.ceil(scale), Math.ceil(scale));
            }
        }
    }
}
function bounds() {
    const i = G.arenaInset || 0;
    return { x: ARENA.x + i, y: ARENA.y + i, w: ARENA.w - 2 * i, h: ARENA.h - 2 * i };
}

/* ------------------------- ВВОД ------------------------- */
const keys = { up: false, down: false, left: false, right: false };
const KEYMAP = {
    arrowup: "up", w: "up",
    arrowdown: "down", s: "down",
    arrowleft: "left", a: "left",
    arrowright: "right", d: "right"
};

/* =================================================================
   ИСПОЛНИТЕЛЬ: сердце, урон, коллизии
   ================================================================= */
function updateHeart(dt) {
    let dx = 0, dy = 0;
    if (keys.up) dy -= 1;
    if (keys.down) dy += 1;
    if (keys.left) dx -= 1;
    if (keys.right) dx += 1;
    const len = Math.hypot(dx, dy);
    if (len > 0) { dx /= len; dy /= len; }

    /* ИНЕРЦИЯ СЕРДЦА — включается на атаке «ТОПЛИВО!» (плавное скольжение). */
    const slip = G.attackActive && G.activePattern && G.activePattern.name === "boost";
    if (slip) {
        const k = 1 - Math.exp(-5 * dt);
        G.hvx += (dx * HEART_SPEED - G.hvx) * k;
        G.hvy += (dy * HEART_SPEED - G.hvy) * k;
        heart.x += G.hvx * dt;
        heart.y += G.hvy * dt;
    } else {
        G.hvx = dx * HEART_SPEED; G.hvy = dy * HEART_SPEED;
        heart.x += dx * HEART_SPEED * dt;
        heart.y += dy * HEART_SPEED * dt;
    }
    G.moving = len > 0;
    const b = bounds();
    heart.x = clamp(heart.x, b.x + 7, b.x + b.w - 7);
    heart.y = clamp(heart.y, b.y + 7, b.y + b.h - 7);
    if (G.iframe > 0) G.iframe -= dt;
}
/* Базовый урон босса растёт на 0.5 за раунд (G.bossBaseDamage). */
function hurtPlayer(n) {
    if (G.cheatCreative) return;               // РЕЖИМ «ТВОРЧЕСТВО»: сердце игнорирует любые коллизии
    if (G.iframe > 0) return;
    let dmg = (n == null) ? G.bossBaseDamage : n;
    if (G.equippedArmor === findItem("ichest")) dmg = Math.max(0, dmg - 2);           // Железный нагрудник: -2
    else if (G.equippedArmor === findItem("dchest")) dmg = Math.round(dmg * 0.90);     // Алмазный нагрудник: -10%
    dmg = Math.max(1, Math.round(dmg));
    G.playerHP = Math.max(0, G.playerHP - dmg);
    G.iframe = 0.9;
    G.flash = 0.35;
    updateHUD();
}
function aabb(b) {
    /* Хитбокс сердца уменьшен на 30% (было 6 -> 4.2): плотные атаки проходимы. */
    const hw = 4.2, hh = 4.2;
    return Math.abs(b.x - heart.x) < b.w / 2 + hw / 2 &&
           Math.abs(b.y - heart.y) < b.h / 2 + hh / 2;
}
function distSeg(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const l2 = dx * dx + dy * dy;
    if (l2 === 0) return Math.hypot(px - x1, py - y1);
    let t = ((px - x1) * dx + (py - y1) * dy) / l2;
    t = clamp(t, 0, 1);
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}
function collides(b) {
    if (b.kind === "lightning") return b.phase === "zap" && aabb(b);
    if (b.kind === "laser") return b.phase === "zap" &&
        distSeg(heart.x, heart.y, b.x1, b.y1, b.x2, b.y2) < b.thickness / 2 + 3;
    /* «КЛЕТЧАТЫЙ ФЛАГ»: чёрно-белые БЕЗОПАСНЫЕ ОКНА.
       Урон наносит только «белая» клетка, «чёрные» — безопасные окна. */
    if (b.kind === "band") {
        if (!aabb(b)) return false;
        const cell = 12;
        const lx = Math.floor((heart.x - (b.x - b.w / 2)) / cell);
        const ly = Math.floor((heart.y - (b.y - b.h / 2)) / cell);
        return ((lx + ly) % 2 === 0);       // белая клетка = опасность, чёрная = безопасно
    }
    return aabb(b);
}
/* Цветные снаряды (механика UNDERTALE):
   синие бьют, если сердце ДВИГАЕТСЯ; оранжевые — если СТОИТ.
   Возвращает true, если для этого снаряда сейчас БЕЗОПАСНО. */
function colorGuard(b) {
    if (!b.color) return false;
    if (b.color === "blue") return !G.moving;
    if (b.color === "orange") return G.moving;
    return false;
}

/* =================================================================
   ИСПОЛНИТЕЛЬ: снаряды
   ================================================================= */
function spawn(o) {
    G.bullets.push(Object.assign({
        life: 8, maxLife: 8, vx: 0, vy: 0, w: 0, h: 0,
        phase: "active", phaseT: 0, landed: false
    }, o));
}
/* Редкое окрашивание снаряда (реплика Undertale): ~12% синий/оранжевый */
function rareColor() {
    return Math.random() < 0.12 ? (Math.random() < 0.5 ? "blue" : "orange") : undefined;
}
function spawnSword(insetBounds) {
    const b = insetBounds || bounds();
    const x = b.x + 16 + Math.random() * Math.max(1, b.w - 32);
    const vx = clamp((heart.x - x) * 0.5, -90, 90);   // доводка к игроку
    spawn({ x, y: b.y - 26, w: 16, h: 26, vx, vy: rand(330, 520),
            kind: "sword", life: 8, color: rareColor() });
}
function spawnBlock() {
    const x = clamp(heart.x + rand(-55, 55), ARENA.x + 16, ARENA.x + ARENA.w - 16);
    spawn({ x, y: ARENA.y - 26, w: 28, h: 28, vx: rand(-90, 90), vy: 290,
            kind: "block", life: 8, color: rareColor() });
}
/* Цветовая схема молний: каждая линия — либо синяя, либо оранжевая */
const LIGHT_COLORS = {
    blue:   { c: "#3db7ff", soft: "#9fd7ff", core: "#d3efff" },
    orange: { c: "#ff8a2a", soft: "#ffb37a", core: "#ffe0bd" }
};
function spawnLightning() {
    const bd = bounds();
    const vx = (Math.random() < 0.5 ? -1 : 1) * rand(190, 260);
    const x = vx < 0 ? bd.x + bd.w - 22 : bd.x + 22;
    const color = Math.random() < 0.5 ? "blue" : "orange";
    spawn({ x, y: bd.y + bd.h / 2 + 8, w: 16, h: bd.h + 16,
            vx, vy: 0, color, kind: "lightning", phase: "warn", phaseT: 0.5, life: 6, zapT: 0 });
}
function spawnAnvil() {
    const x = clamp(heart.x + rand(-35, 35), ARENA.x + 14, ARENA.x + ARENA.w - 14);
    spawn({ x, y: ARENA.y - 30, w: 32, h: 30, vx: 0, vy: 470,
            kind: "anvil", life: 8, color: rareColor() });
}
function spawnBone(color) {
    const bd = bounds();
    let x;
    if (color === "orange") {
        x = clamp(heart.x + (Math.random() < 0.5 ? -1 : 1) * rand(50, 170), bd.x + 18, bd.x + bd.w - 18);
    } else {
        x = bd.x + 18 + Math.random() * Math.max(1, bd.w - 36);
    }
    spawn({ x, y: bd.y - 30, w: 20, h: 30,
            vx: rand(-70, 70), vy: color === "blue" ? rand(280, 380) : rand(330, 450),
            color: color || rareColor(), kind: "bone", life: 8 });
}
function spawnFireball(ang, color) {
    const ox = ARENA.x + ARENA.w / 2;
    const oy = ARENA.y + ARENA.h / 2;
    spawn({ x: ox, y: oy, w: 15, h: 15, color,
            vx: Math.cos(ang) * 280, vy: Math.sin(ang) * 280,
            kind: "fireball", life: 5 });
}
function spawnLaser() {
    const b = bounds();
    const ax = b.x + Math.random() * b.w;
    const ay = b.y + Math.random() * b.h;
    const ang = Math.atan2(heart.y - ay, heart.x - ax) + rand(-0.45, 0.45);
    const len = Math.max(b.w, b.h) * 1.6;
    spawn({ kind: "laser", x: ax, y: ay, w: 0, h: 0,
            x1: ax - Math.cos(ang) * len / 2, y1: ay - Math.sin(ang) * len / 2,
            x2: ax + Math.cos(ang) * len / 2, y2: ay + Math.sin(ang) * len / 2,
            thickness: 12, phase: "warn", phaseT: 0.3, zapT: 0.16, life: 2 });
}
/* Самонаводящийся снаряд (используется атакой heartseek / «В ЦЕНТР»). */
function spawnHeartseek() {
    const b = bounds();
    const r = Math.random();
    let x, y;
    if (r < 0.25) { x = b.x - 10; y = b.y + Math.random() * b.h; }
    else if (r < 0.5) { x = b.x + b.w + 10; y = b.y + Math.random() * b.h; }
    else if (r < 0.75) { x = b.x + Math.random() * b.w; y = b.y - 10; }
    else { x = b.x + Math.random() * b.w; y = b.y + b.h + 10; }
    const dx = heart.x - x, dy = heart.y - y;
    const len = Math.hypot(dx, dy) || 1;
    const spd = rand(420, 520);
    spawn({ x, y, w: 10, h: 10, vx: (dx / len) * spd, vy: (dy / len) * spd,
            kind: "heartseek", life: 7, color: rareColor() });
}
/* «В ЦЕНТР»: снаряд из РАМКИ летит к ТЕКУЩЕЙ координате сердца. */
function spawnCenter() {
    const b = bounds();
    const r = Math.random();
    let x, y;
    if (r < 0.25) { x = b.x; y = b.y + Math.random() * b.h; }
    else if (r < 0.5) { x = b.x + b.w; y = b.y + Math.random() * b.h; }
    else if (r < 0.75) { x = b.x + Math.random() * b.w; y = b.y; }
    else { x = b.x + Math.random() * b.w; y = b.y + b.h; }
    const dx = heart.x - x, dy = heart.y - y;
    const len = Math.hypot(dx, dy) || 1;
    const spd = rand(250, 360);
    spawn({ x, y, w: 12, h: 12, vx: (dx / len) * spd, vy: (dy / len) * spd,
            kind: "center", life: 6, color: rareColor() });
}

function updateBullets(dt) {
    /* подшаги ≤1/60с — защита от «прошивания» снарядами при просадке FPS */
    let rem = dt;
    while (rem > 1e-9) {
        const step = rem > 1 / 60 ? 1 / 60 : rem;
        rem -= step;
        stepBullets(step);
    }
}
function stepBullets(dt) {
    for (let i = G.bullets.length - 1; i >= 0; i--) {
        const b = G.bullets[i];

        if (b.kind === "lightning") {           // молния: телеграф у края -> проезд через арену
            if (b.phase === "warn") {
                b.phaseT -= dt;
                if (b.phaseT <= 0) { b.phase = "zap"; b.x += b.vx * dt; }
            } else {
                b.zapT += dt;
                b.x += b.vx * dt;
            }
            b.life -= dt;
        } else if (b.kind === "laser") {
            if (b.phase === "warn") {
                b.phaseT -= dt;
                if (b.phaseT <= 0) { b.phase = "zap"; b.zapT = 0.16; }
            } else {
                b.zapT -= dt;
                if (b.zapT <= 0) b.life = -1;
            }
            b.life -= dt;
        } else if (b.kind === "tire") {
            /* «ШИНЫ ИЗ ПИТ-СТОПА»: падают СВЕРХУ, 2 отскока снизу
               с потерей высоты (каждый отскок ниже предыдущего). */
            b.vy += 900 * dt;
            b.x += b.vx * dt; b.y += b.vy * dt;
            const bd = bounds();
            if (b.y + b.h / 2 > bd.y + bd.h) {
                b.bounces = (b.bounces || 0) + 1;
                if (b.bounces > 2) { b.life = -1; }
                else {
                    b.y = bd.y + bd.h - b.h / 2;
                    b.vy = -Math.abs(b.vy) * 0.5;       // потеря высоты
                    b.vx *= 0.8;
                }
            }
            if (b.y - b.h / 2 < bd.y) { b.y = bd.y + b.h / 2; b.vy = Math.abs(b.vy) * 0.6; }
            b.life -= dt;
        } else {
            b.x += b.vx * dt;
            b.y += b.vy * dt;
            b.life -= dt;
            if (b.kind === "anvil" && !b.landed) {
                const bd = bounds();
                if (b.y >= bd.y + bd.h - b.h / 2) {
                    b.y = bd.y + bd.h - b.h / 2;
                    b.landed = true; b.vx = 0; b.vy = 0; b.life = 3.2;
                }
            }
        }

        if (b.life > -0.5 && collides(b) && !colorGuard(b)) hurtPlayer();

        const bd = bounds();
        const out = b.x < bd.x - 140 || b.x > bd.x + bd.w + 140 ||
                    b.y < bd.y - 280 || b.y > bd.y + bd.h + 140;
        if (b.life <= 0 || b.dead || out) G.bullets.splice(i, 1);
    }
}

/* =================================================================
   ИСПОЛНИТЕЛЬ: шаблоны атак
   ================================================================= */
function makePattern(name, duration, step) {
    return { name, t: 0, acc: 0, duration, done: false, list: null, spiralAng: 0, step };
}
const STANDARD = [];
const HARDCORE = [];

/* --- СТАНДАРТНЫЕ АТАКИ --- */
STANDARD.push({ name: "swords", ru: "АЛМАЗНЫЙ ДОЖДЬ!", make: () => makePattern("swords", 6.5, (p, dt) => {
    p.acc += dt;
    if (p.acc > 0.22) { p.acc -= 0.22; spawnSword(); }
})});
STANDARD.push({ name: "blocks", ru: "БЛОКИ ПАДАЮТ!", make: () => makePattern("blocks", 6.5, (p, dt) => {
    p.acc += dt;
    if (p.acc > 0.32) { p.acc -= 0.32; spawnBlock(); }
})});
STANDARD.push({ name: "lightning", ru: "ГРОЗА!", make: () => makePattern("lightning", 6.5, (p, dt) => {
    p.acc += dt;
    if (p.acc > 0.5) { p.acc -= 0.5; spawnLightning(); }
})});

/* --- ХАРДКОРНЫЕ АТАКИ (агрессия) --- */
HARDCORE.push({ name: "cage", ru: "ЛОВУШКА ИЗ БЕДРОКА!", make: () => makePattern("cage", 6.5, (p, dt) => {
    const T = p.t;
    let inset;
    if (T < 2.5) inset = 92 * (T / 2.5);
    else if (T < 3.5) inset = 92;
    else inset = 92 * (1 - (T - 3.5) / 3.0);
    G.arenaInset = Math.max(0, inset);
    p.acc += dt;
    if (p.acc > 0.32 && T < 4.2) { p.acc -= 0.32; spawnSword(bounds()); }
})});
HARDCORE.push({ name: "anvil", ru: "НАКОВАЛЬНИ!", make: () => makePattern("anvil", 6.5, (p, dt) => {
    p.acc += dt;
    if (p.acc > 0.4) { p.acc -= 0.4; spawnAnvil(); }
})});
HARDCORE.push({ name: "command", ru: "ОШИБКА КОМАНДНОГО БЛОКА!", make: () => makePattern("command", 6.5, (p, dt) => {
    p.acc += dt;
    if (p.acc > 0.28) {
        p.acc -= 0.28;
        Math.random() < 0.5 ? spawnBlock() : spawnSword();
    }
    G.commandShuffle = true;
})});
HARDCORE.push({ name: "spiral", ru: "СПИРАЛЬ ГАСТОВ!", make: () => makePattern("spiral", 6.5, (p, dt) => {
    p.acc += dt;
    if (p.t < 0.5) return;
    p.spiralAng += dt * 4.2;
    if (p.acc > 0.055) {
        p.acc -= 0.055;
        spawnFireball(p.spiralAng);
        spawnFireball(p.spiralAng + Math.PI);   // двойная спираль
    }
})});
HARDCORE.push({ name: "lasers", ru: "ЛАЗЕРЫ ИФРИТА!", make: () => makePattern("lasers", 6.5, (p, dt) => {
    p.acc += dt;
    if (p.acc > 0.32) { p.acc -= 0.32; spawnLaser(); }
})});

/* =================================================================
   ТУРБО-ПУЛ: гоночные атаки. Активируется на «Турбо Шике».
   ================================================================= */
function spawnChecker() {
    const bd = bounds();
    const vx = (Math.random() < 0.5 ? -1 : 1) * rand(240, 330);
    const x = vx < 0 ? bd.x + bd.w + 30 : bd.x - 30;
    spawn({ x, y: bd.y + bd.h / 2, w: 46, h: bd.h + 20,
            vx, vy: 0, kind: "band", life: 4 });
}
function spawnBoost() {
    const bd = bounds();
    const x = clamp(heart.x + rand(-30, 30), bd.x + 16, bd.x + bd.w - 16);
    spawn({ x, y: bd.y - 26, w: 26, h: 16, vx: 0, vy: 460, kind: "boost", life: 5 });
}
/* «ШИНЫ ИЗ ПИТ-СТОПА»: стартуют сверху и падают вниз с отскоками. */
function spawnTire() {
    const bd = bounds();
    spawn({ x: bd.x + 20 + Math.random() * (bd.w - 40), y: bd.y - 6,
            w: 22, h: 22, vx: rand(-45, 45), vy: rand(60, 130),
            kind: "tire", life: 10, bounces: 0 });
}
const TURBO_FIGHT = [];
/* «КЛЕТЧАТЫЙ ФЛАГ» — чёрно-белые безопасные окна. */
TURBO_FIGHT.push({ name: "checker", ru: "КЛЕТЧАТЫЙ ФЛАГ!", make: () => makePattern("checker", 6.5, (p, dt) => {
    p.acc += dt;
    if (p.acc > 1.1) { p.acc -= 1.1; spawnChecker(); spawnChecker(); }
})});
/* «ТОПЛИВО» — плотность x2.5 + инерция сердца (см. updateHeart). */
TURBO_FIGHT.push({ name: "boost", ru: "ТОПЛИВО!", make: () => makePattern("boost", 6.5, (p, dt) => {
    p.acc += dt;
    if (p.acc > 0.168) { p.acc -= 0.168; spawnBoost(); }
})});
/* «ШИНЫ ИЗ ПИТ-СТОПА» — падают сверху, 2 отскока. */
TURBO_FIGHT.push({ name: "tires", ru: "ШИНЫ ИЗ ПИТ-СТОПА!", make: () => makePattern("tires", 6.5, (p, dt) => {
    p.acc += dt;
    if (p.acc > 0.5) { p.acc -= 0.5; for (let i = 0; i < 2; i++) spawnTire(); }
})});
/* «В ЦЕНТР» — снаряды из рамки летят к текущей координате сердца. */
TURBO_FIGHT.push({ name: "center", ru: "В ЦЕНТР!", make: () => makePattern("center", 6.5, (p, dt) => {
    p.acc += dt;
    if (p.acc > 0.34) { p.acc -= 0.34; spawnCenter(); spawnCenter(); }
})});

let lastPatternName = null;
function pickPattern() {
    let pool;
    if (G.turboMode) {
        pool = TURBO_FIGHT.slice();                 // ТУРБО: только гоночные атаки
    } else {
        pool = STANDARD.slice();
        if (G.isAggressive) pool = pool.concat(HARDCORE);
    }
    const choices = pool.filter(x => x.name !== lastPatternName);
    const pick = choices[Math.floor(Math.random() * choices.length)];
    lastPatternName = pick.name;
    const pat = pick.make();
    pat.list = pick;
    return pat;
}
/* Сброс состояния шаблонов между боями (вызывает resetBattle). */
function resetPatternState() {
    lastPatternName = null;
    if (attackWatchdog) { clearTimeout(attackWatchdog); attackWatchdog = null; }
    G.attackActive = false;
    G.activePattern = null;
    G.onAttackEnd = null;
    G.bullets = [];
    G.arenaInset = 0;
    G.aimActive = false; G.aimResolve = null;
}

/* =================================================================
   ЗАПУСК АТАКИ + ОБЯЗАТЕЛЬНЫЙ WATCHDOG (7 секунд)
   ================================================================= */
let attackWatchdog = null;
function runAttack(pattern) {
    return new Promise(resolve => {
        G.bullets = [];
        G.arenaInset = 0;
        G.iframe = 0.4;
        heart.x = ARENA.x + ARENA.w / 2;
        heart.y = ARENA.y + ARENA.h / 2;
        G.hvx = 0; G.hvy = 0;
        G.activePattern = pattern;
        G.attackActive = true;
        G.phase = "BOSS_ATTACK";            // фаза атаки босса
        if (G.turboMode) G.emotion = "turbo_talk";   // Турбо открывает рот, объявляя приём
        G.onAttackEnd = resolve;
        const speaker = G.turboMode ? (typeof bossName !== "undefined" ? bossName : "ТУРБО ШИК") : "ХЕРОБРИН";
        setDialogImmediate(speaker + ": " + pattern.list.ru + (pattern.list.hint ? "  [" + pattern.list.hint + "]" : ""));
        if (attackWatchdog) clearTimeout(attackWatchdog);
        /* Обязательный watchdog: не даём атаке зависнуть. По истечении
           7 секунд принудительно деактивируем фазу атаки. */
        attackWatchdog = setTimeout(() => {
            if (G.attackActive && G.activePattern === pattern) forceEndAttackPhase();
        }, ATTACK_WATCHDOG_MS);
    });
}
/* Гарантированная деактивация фазы атаки по watchdog (7 сек):
   чистит снаряды, сбрасывает все дебаффы (скольжение «ТОПЛИВО»,
   сжатие арены и т.п.) и возвращает управление игроку. endAttack()
   резолвит runAttack(), после чего script.js увеличивает счётчик
   ходов (+1) и разблокирует UI-кнопки игрока. */
function forceEndAttackPhase() {
    G.bullets = [];                         // принудительная очистка снарядов
    G.arenaInset = 0;                       // сброс сжатия арены (ловушка)
    G.hvx = 0; G.hvy = 0;                   // сброс инерции/скольжения (ТОПЛИВО)
    G.moving = false;
    G.commandShuffle = false;               // сброс дебаффа «командного блока»
    G.aimActive = false;                    // сброс незавершённого прицеливания
    endAttack();
}
function endAttack() {
    if (attackWatchdog) { clearTimeout(attackWatchdog); attackWatchdog = null; }
    G.attackActive = false;
    G.activePattern = null;
    G.phase = "PLAYER_TURN";                // ход возвращается игроку
    G.bullets = [];                     // очистка bullets
    G.arenaInset = 0;
    G.hvx = 0; G.hvy = 0;
    if (G.turboMode && G.emotion === "turbo_talk") G.emotion = "turbo";
    const r = G.onAttackEnd; G.onAttackEnd = null;
    if (r) r();
}
/* СТАРТ ФАЗЫ АТАКИ БОССА (точка входа из script.js).
   Гарантированно запускает игровой цикл Canvas (requestAnimationFrame),
   чтобы сердце двигалось и снаряды летели, переводит состояние в
   BOSS_ATTACK и проигрывает паттерн. Промис резолвится движком по
   завершении атаки или по watchdog'у (7 сек). */
function startBossAttackPhase(pattern) {
    ensureGameLoop();                        // гарантированная перерисовка Canvas
    G.phase = "BOSS_ATTACK";                 // gameState.phase = "BOSS_ATTACK"
    return runAttack(pattern || pickPattern());
}
/* Прицельная атака (как в UNDERTALE): цель — центр босса. */
function startFightAim() {
    return new Promise(resolve => {
        G.aimActive = true;
        G.aimX = 0; G.aimDir = 1; G.aimSpeed = 1.05;
        G.sweeps = 0;
        G.aimResolve = resolve;
    });
}
function aimDamage(dist) {
    const max = FIGHT_DMG_MAX, min = 3;
    return Math.round(min + (max - min) * Math.exp(-Math.pow(dist * 2, 2)));
}
function fireAim() {
    if (!G.aimActive) return;
    const dist = Math.abs(G.aimX - 0.5) * 2;
    G.aimLockX = G.aimX;
    G.aimHit = dist;
    G.aimFlash = 0.5;
    G.aimActive = false;
    const r = G.aimResolve; G.aimResolve = null;
    if (r) r({ dist, dmg: aimDamage(dist) });
}
function updateAim(dt) {
    if (!G.aimActive) return;
    G.aimX += G.aimDir * G.aimSpeed * dt;
    if (G.aimX >= 1) { G.aimX = 1; G.aimDir = -1; G.sweeps = (G.sweeps || 0) + 1; }
    if (G.aimX <= 0) { G.aimX = 0; G.aimDir = 1; G.sweeps = (G.sweeps || 0) + 1; }
    if ((G.sweeps || 0) >= 6) fireAim();   // автовыстрел — ничего не виснет
}
function updateAttack(dt) {
    if (!G.attackActive) return;
    const p = G.activePattern;
    p.t += dt;
    p.step(p, dt);
    updateBullets(dt);
    updateHeart(dt);
    if (G.flash > 0) G.flash -= dt * 2.5;
    if (p.t >= p.duration) p.done = true;
    if (G.playerHP <= 0) { endAttack(); return; }
    if (p.done) endAttack();
}

/* =================================================================
   ВИЗУАЛИЗАЦИЯ БОССА: авторские спрайты из локальной папки ассетов.
   Турбо Шик — ОТДЕЛЬНЫЙ персонаж (папка photos/):
     • Турбо.png                    — обычная улыбка
     • Турбо_говорит.png            — открытый рот
     • Турбо_зол.png                — злая гримаса
     • Турбо_серьёзное_лицо.png     — точка вместо рта
   ================================================================= */
const SPRITE_IDS = {
    resolved:   "sprite_resolute",
    surprised:  "sprite_resolute",
    despair:    "sprite_resolute",
    angry:      "sprite_mad",
    hope:       "sprite_steve",
    turbo:      "sprite_turbo",        // Турбо.png — обычная улыбка
    turbo_talk: "sprite_turbo_talk",   // Турбо_говорит.png — открытый рот
    turbo_mad:  "sprite_turbo_mad",    // Турбо_зол.png — злая гримаса
    turbo_sad:  "sprite_turbo_sad"     // Турбо_серьёзное_лицо.png — точка вместо рта
};
function bossSpriteEl() {
    return $(SPRITE_IDS[G.emotion] || "sprite_resolute");
}
function drawBoss(ts) {
    if (!G.bossVisible) return;
    const img = bossSpriteEl();
    if (!img || !img.complete || !img.naturalWidth) return;   // грузится/нет картинки
    const maxW = 300, maxH = 176;
    const s = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight, 4);
    const w = img.naturalWidth * s, h = img.naturalHeight * s;
    let ox = 0, oy = 0;
    if (G.emotion === "resolved") oy = Math.sin(ts / 260) * 3;
    else if (G.emotion === "angry") ox = rand(-2, 2);
    else if (G.emotion === "surprised") oy = -2;
    else if (G.emotion === "hope") oy = Math.sin(ts / 260) * 2;
    else if (G.emotion && G.emotion.indexOf("turbo") === 0) { ox = rand(-3, 3); oy = rand(-2, 2); }
    else if (G.emotion === "despair") ox = rand(-4, 4);
    if (G.glitch > 0.01) ox = rand(-6, 6);
    const cx = 320 + ox, cy = 96 + oy;
    ctx.save();
    ctx.imageSmoothingEnabled = false;                        // пиксельный вид
    ctx.drawImage(img, Math.round(cx - w / 2), Math.round(cy - h / 2), Math.round(w), Math.round(h));
    ctx.restore();
    if (G.emotion === "despair") spawnTears(ts, cx, cy - 6);
}
/* Пиксельные слёзы из глаз (Отчаяние) */
function spawnTears(ts, ex, ey) {
    if (G.particles.length > 180) return;
    for (let i = 0; i < 2; i++) {
        G.particles.push({
            x: ex + (Math.random() < 0.5 ? -12 : 12) + rand(-3, 3),
            y: ey + rand(-3, 4),
            vx: rand(-15, 15), vy: rand(30, 70),
            s: rand(2, 4), life: 1.1, maxLife: 1.1,
            c: "#ffffff"
        });
    }
}

/* =================================================================
   РЕНДЕР: арена, снаряды, сердце
   ================================================================= */
const HEART_MAP = [
    "01100110", "11111111", "11111111", "11111111",
    "01111110", "00111100", "00011000"
];
function drawHeartSprite(cx, cy, scale, color) {
    drawPixelMap(HEART_MAP, cx, cy, scale, color);
}
function soulColor(ts) {
    for (const b of G.bullets) {
        if (b.color === "blue") return "#3db7ff";
        if (b.color === "orange") return Math.floor(ts / 140) % 2 ? "#ff8a2a" : "#ff2b2b";
    }
    return "#ff2b2b";
}
function drawArena() {
    const b = bounds();
    rect(b.x, b.y, b.w, b.h, "#050505");
    ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 4;
    ctx.strokeRect(Math.round(b.x) + 2, Math.round(b.y) + 2, Math.round(b.w) - 4, Math.round(b.h) - 4);
}
function drawBullets() {
    for (const b of G.bullets) {
        switch (b.kind) {
            case "sword": {
                ctx.save();
                ctx.translate(b.x, b.y);
                ctx.fillStyle = "#ffffff"; ctx.strokeStyle = "#7a7a7a"; ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(0, -b.h / 2); ctx.lineTo(b.w / 2, 0);
                ctx.lineTo(0, b.h / 2); ctx.lineTo(-b.w / 2, 0);
                ctx.closePath(); ctx.fill(); ctx.stroke();
                ctx.restore();
                break;
            }
            case "block":
                rect(b.x - b.w / 2, b.y - b.h / 2, b.w, b.h, "#8f8f8f");
                ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 2;
                ctx.strokeRect(b.x - b.w / 2, b.y - b.h / 2, b.w, b.h);
                break;
            case "anvil":
                rect(b.x - b.w / 2, b.y - b.h / 2, b.w, b.h, "#3a3a3a");
                rect(b.x - b.w / 2, b.y - b.h / 2, b.w, 7, "#1a1a1a");
                rect(b.x - b.w / 4, b.y - b.h / 2 - 5, b.w / 2, 5, "#2a2a2a");
                ctx.strokeStyle = "#fff"; ctx.lineWidth = 1;
                ctx.strokeRect(b.x - b.w / 2, b.y - b.h / 2, b.w, b.h);
                break;
            case "lightning": {
                const lc = LIGHT_COLORS[b.color] || LIGHT_COLORS.blue;
                if (b.phase === "warn") {
                    ctx.save(); ctx.globalAlpha = 0.5;
                    ctx.strokeStyle = lc.c; ctx.lineWidth = 3; ctx.setLineDash([8, 10]);
                    ctx.beginPath(); ctx.moveTo(b.x, b.y - b.h / 2); ctx.lineTo(b.x, b.y + b.h / 2); ctx.stroke();
                    ctx.setLineDash([]);
                    const d = b.vx > 0 ? 1 : -1;
                    ctx.fillStyle = lc.c;
                    ctx.beginPath();
                    ctx.moveTo(b.x + d * 14, b.y);
                    ctx.lineTo(b.x + d * 6, b.y - 6);
                    ctx.lineTo(b.x + d * 6, b.y + 6);
                    ctx.closePath(); ctx.fill();
                    ctx.restore();
                } else {
                    if (b.zapT < 0.15) glowRect(b.x - b.w, b.y - b.h / 2, b.w * 2, b.h, lc.soft, 26);
                    glowRect(b.x - b.w / 2, b.y - b.h / 2, b.w, b.h, lc.c, 18);
                    rect(b.x - b.w / 2 + 4, b.y - b.h / 2, b.w - 8, b.h, lc.core);
                }
                break;
            }
            case "laser":
                if (b.phase === "warn") {
                    ctx.save(); ctx.globalAlpha = 0.3;
                    ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 2; ctx.setLineDash([10, 10]);
                    ctx.beginPath(); ctx.moveTo(b.x1, b.y1); ctx.lineTo(b.x2, b.y2); ctx.stroke();
                    ctx.setLineDash([]); ctx.restore();
                } else {
                    ctx.save();
                    ctx.shadowColor = "#ffffff"; ctx.shadowBlur = 18;
                    ctx.strokeStyle = "#ffffff"; ctx.lineWidth = b.thickness; ctx.lineCap = "round";
                    ctx.beginPath(); ctx.moveTo(b.x1, b.y1); ctx.lineTo(b.x2, b.y2); ctx.stroke();
                    ctx.restore();
                }
                break;
            case "bone": {
                const bcol = b.color === "orange" ? "#ff8a2a" : "#3db7ff";
                glowRect(b.x - b.w / 2, b.y - b.h / 2, b.w, b.h, bcol, 10);
                rect(b.x - b.w / 2, b.y - b.h / 2, b.w, b.h, bcol);
                ctx.save(); ctx.fillStyle = "#ffffff"; ctx.globalAlpha = 0.85;
                ctx.beginPath();
                ctx.moveTo(b.x, b.y + b.h / 2);
                ctx.lineTo(b.x - b.w / 2 + 4, b.y + b.h / 2 - 10);
                ctx.lineTo(b.x + b.w / 2 - 4, b.y + b.h / 2 - 10);
                ctx.closePath(); ctx.fill(); ctx.restore();
                break;
            }
            case "fireball":
            case "center": {
                const bfc = b.color === "orange" ? "#ff8a2a" : (b.color === "blue" ? "#3db7ff" : "#ffffff");
                glowRect(b.x - b.w / 2, b.y - b.h / 2, b.w, b.h, bfc, 12);
                rect(b.x - b.w / 2, b.y - b.h / 2, b.w, b.h, bfc);
                break;
            }
            case "heartseek": {
                const hc = b.color === "orange" ? "#ff8a2a" : (b.color === "blue" ? "#3db7ff" : "#ffd75e");
                glowRect(b.x - b.w / 2, b.y - b.h / 2, b.w, b.h, hc, 10);
                rect(b.x - b.w / 2, b.y - b.h / 2, b.w, b.h, hc);
                break;
            }
            case "band": {  // ТУРБО: клетчатый гоночный флаг (чёрные клетки = безопасные окна)
                const x0 = b.x - b.w / 2, y0 = b.y - b.h / 2;
                const cell = 12;
                for (let r = 0; r * cell < b.h; r++) {
                    for (let c = 0; c * cell < b.w; c++) {
                        ctx.fillStyle = ((r + c) % 2 === 0) ? "#ffffff" : "#15151c";
                        ctx.fillRect(Math.round(x0 + c * cell), Math.round(y0 + r * cell), cell, cell);
                    }
                }
                break;
            }
            case "boost": {  // ТУРБО: топливный буст
                const x0 = b.x - b.w / 2, y0 = b.y - b.h / 2;
                rect(x0, y0, b.w, b.h, "#1f7a1f");
                ctx.fillStyle = "#7dff6a";
                ctx.beginPath();
                ctx.moveTo(x0 + 3, y0 + b.h / 2);
                ctx.lineTo(x0 + b.w / 2, y0 + 2);
                ctx.lineTo(x0 + b.w - 3, y0 + b.h / 2);
                ctx.closePath(); ctx.fill();
                break;
            }
            case "tire": {  // ТУРБО: шина
                rect(b.x - b.w / 2, b.y - b.h / 2, b.w, b.h, "#1a1a1d");
                ctx.strokeStyle = "#55555c"; ctx.lineWidth = 3;
                ctx.strokeRect(b.x - b.w / 2 + 3, b.y - b.h / 2 + 3, b.w - 6, b.h - 6);
                rect(b.x - 3, b.y - 3, 6, 6, "#9e9ea6");
                break;
            }
        }
    }
}
function drawParticles() {
    for (const p of G.particles) {
        ctx.globalAlpha = clamp(p.life / p.maxLife, 0, 1);
        rect(p.x, p.y, p.s, p.s, p.c || "#ffffff");
    }
    ctx.globalAlpha = 1;
}
function updateParticles(dt) {
    for (let i = G.particles.length - 1; i >= 0; i--) {
        const p = G.particles[i];
        p.vy += 90 * dt;
        p.x += p.vx * dt; p.y += p.vy * dt;
        p.life -= dt;
        if (p.life <= 0) G.particles.splice(i, 1);
    }
}
/* Всплывающий текст урона и серия точных ударов */
function addFloatText(x, y, text, color) {
    G.floatTexts.push({ x, y, text, color, life: 1.0, maxLife: 1.0 });
}
function updateFloatTexts(dt) {
    for (let i = G.floatTexts.length - 1; i >= 0; i--) {
        const t = G.floatTexts[i];
        t.y -= 42 * dt;
        t.life -= dt;
        if (t.life <= 0) G.floatTexts.splice(i, 1);
    }
}
function drawFloatTexts() {
    ctx.textAlign = "center";
    for (const t of G.floatTexts) {
        ctx.globalAlpha = clamp(t.life / t.maxLife, 0, 1);
        ctx.font = "18px 'Press Start 2P', monospace";
        ctx.fillStyle = t.color;
        ctx.fillText(t.text, t.x, t.y);
    }
    ctx.globalAlpha = 1;
}
function hitBurst() {
    for (let i = 0; i < 26; i++) {
        G.particles.push({
            x: 320 + rand(-24, 24), y: 120 + rand(-16, 12),
            vx: rand(-190, 190), vy: rand(-260, -30),
            s: rand(2, 4), life: rand(0.35, 0.7), maxLife: 0.7,
            c: Math.random() < 0.5 ? "#ffd75e" : "#ffffff"
        });
    }
}
function drawGoldShatter(x, y) {
    for (let i = 0; i < 24; i++) {
        G.particles.push({
            x: x + rand(-8, 8), y: y + rand(-8, 8),
            vx: rand(-190, 190), vy: rand(-280, -40),
            s: rand(2, 5), life: rand(0.4, 0.9), maxLife: 0.9,
            c: Math.random() < 0.5 ? "#ffd75e" : "#b08b0f"
        });
    }
}
function crumbleBoss() {
    G.bossVisible = false;
    for (let i = 0; i < 320; i++) {
        G.particles.push({
            x: 320 + rand(-64, 64), y: 70 + rand(-40, 100),
            vx: rand(-150, 150), vy: rand(-280, -20),
            s: rand(3, 8), life: rand(1.2, 2.8), maxLife: 2.8,
            c: Math.random() < 0.5 ? "#ffffff" : "#b8b8b8"
        });
    }
}
function fireAppleDrop() {
    G.appleDrop = { x: rand(140, 500), y: -40, vy: 420, landed: false };
}
function updateAppleDrop(dt) {
    const a = G.appleDrop;
    if (!a) return;
    if (!a.landed) {
        a.vy += 1200 * dt;
        a.y += a.vy * dt;
        if (a.y >= 240) {
            a.y = 240;
            a.landed = true;
            G.appleDrop = null;
        }
    }
}
function drawAppleDrop() {
    const a = G.appleDrop;
    if (!a) return;
    ctx.save();
    ctx.fillStyle = "#ff3b3b";
    ctx.beginPath(); ctx.arc(a.x, a.y, 12, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#2f9a32";
    ctx.fillRect(a.x - 2, a.y - 14, 4, 6);
    ctx.restore();
}

/* ------------------------- ЗОЛОТАЯ МЕДАЛЬ ------------------------- */
function fireMedal() {
    G.medalAnim = { t: 0, x: 580, y: -40, vx: -520, vy: 780, rot: 0, rotV: 12, landed: false };
}
function updateMedal(dt) {
    const m = G.medalAnim;
    if (!m) return;
    m.t += dt;
    if (!m.landed) {
        m.vy += 1600 * dt;
        m.x += m.vx * dt; m.y += m.vy * dt;
        m.rot += m.rotV * dt;
        if (m.y >= 460) {
            m.landed = true;
            m.y = 460;
            drawGoldShatter(m.x, m.y);
            G.glitch = 0.6;
            const mb = $("boss").querySelector('[data-act="mercy"]');
            if (mb) { mb.disabled = true; mb.classList.add("broken"); }
        }
    } else {
        if (m.t > 1.8) G.medalAnim = null;
    }
}
function drawMedalCanvas() {
    const m = G.medalAnim;
    if (!m) return;
    ctx.save();
    ctx.translate(m.x, m.y);
    ctx.rotate(m.rot);
    ctx.fillStyle = "#b08b0f";
    ctx.beginPath(); ctx.arc(0, 0, 14, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#ffd75e"; ctx.lineWidth = 3; ctx.stroke();
    ctx.fillStyle = "#ffd75e";
    ctx.font = "bold 12px Courier New"; ctx.textAlign = "center";
    ctx.fillText("★", 0, 4);
    ctx.restore();
}

/* =================================================================
   ОРКЕСТР: игровой цикл (единый rAF)
   ================================================================= */
let lastTs = 0;
let loopRunning = false;
/* Гарантированный запуск игрового цикла. Если rAF-цепочка оборвалась
   (например, из-за исключения внутри кадра), startBossAttackPhase()
   перезапустит её — Canvas снова начнёт перерисовываться. */
function ensureGameLoop() {
    if (loopRunning) return;
    loopRunning = true;
    lastTs = 0;
    requestAnimationFrame(loop);
}
function loop(ts) {
    loopRunning = true;
    try {
        if (!lastTs) lastTs = ts;
        let dt = (ts - lastTs) / 1000;
        lastTs = ts;
        if (dt > 0.05) dt = 0.05;

        if (G.screen === "boss" || G.screen === "ending") {
            if (G.medalAnim) updateMedal(dt);
            if (G.appleDrop) updateAppleDrop(dt);
            if (G.attackActive) updateAttack(dt);
            if (G.aimActive) updateAim(dt);
            if (G.aimFlash > 0) G.aimFlash -= dt;
            updateParticles(dt);
            updateFloatTexts(dt);
            render(ts);
        }
    } catch (err) {
        /* Кадр не должен обрывать цикл: логируем и продолжаем. */
        console.error("[engine] loop error:", err);
    } finally {
        requestAnimationFrame(loop);         // цикл никогда не останавливается
    }
}
function render(ts) {
    ctx.clearRect(0, 0, CV_W, CV_H);
    rect(0, 0, CV_W, CV_H, "#000");

    drawBoss(ts);
    drawArena();
    drawBullets();

    if (G.aimActive) {
        const ay = 150, x0 = 190, x1 = 450;
        rect(x0, ay - 2, x1 - x0, 4, "#3d3d3d");
        glowRect(313, ay - 15, 14, 30, "#5aff5a", 10);
        rect(316, ay - 15, 8, 30, "#5aff5a");
        const mx = x0 + G.aimX * (x1 - x0);
        const inC = Math.abs(G.aimX - 0.5) < 0.08;
        glowRect(mx - 7, ay - 17, 14, 34, inC ? "#b4ff9c" : "#ffffff", inC ? 26 : 16);
        rect(mx - 3, ay - 17, 6, 34, inC ? "#e9ffe2" : "#ffffff");
    }
    if (G.aimFlash > 0) {
        const lx = 190 + G.aimLockX * 260;
        ctx.globalAlpha = Math.min(0.7, G.aimFlash);
        glowRect(lx - 1.5, 120, 3, 60, "#ff5656", 10);
        ctx.globalAlpha = 1;
    }

    if (G.bossVisible || G.attackActive || G.particles.length) {
        if (G.iframe <= 0 || Math.floor(ts / 70) % 2 === 0) {
            drawHeartSprite(heart.x, heart.y, 1.6, soulColor(ts));
        }
    }
    drawParticles();
    drawFloatTexts();
    drawMedalCanvas();
    drawAppleDrop();

    if (G.flash > 0) {
        ctx.globalAlpha = clamp(G.flash, 0, 0.5);
        rect(0, 0, CV_W, CV_H, "#ffffff");
        ctx.globalAlpha = 1;
    }
}
ensureGameLoop();
