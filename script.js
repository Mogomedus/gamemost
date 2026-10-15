"use strict";
/* =================================================================
   GAME CONNECTOR — Minecraft × Undertale (HARDCORE EDITION)
   script.js — ЛОГИКА: ходы, диалоги, RPG-экипировка, таймлайны,
   три концовки + ТУРБО («Турбо Шик»).

   Загружается ПЕРЕД engine.js (см. index.html).
   Canvas-движок живёт в engine.js и работает с общей шиной (G, heart).
   ================================================================= */

const bossName = "Турбо Шик";                     // имя ТУРБО-босса (повторная агрессия)
const GITHUB_LINK = "https://github.com/";

/* Лимиты ходов по путям. ВАЖНО: эти константы обязаны быть объявлены —
   без них в strict-режиме чтение/запись бросает ReferenceError, из-за
   чего падал updateHUD() → startBattle() (пропадал монолог) и
   beginBossTurn() (игра зависала после любого действия). */
let MERCY_TURNS = 15;                             // путь милосердия: standoff после 14 щад (крыса → 25)
let AGGR_TURNS  = 12;                             // агрессивный путь: предел до принудительной расправы

/* =================================================================
   НИК ИГРОКА, ОБРАЩЕНИЕ БОССА И ЧИТ-РЕЖИМЫ (стартовое поле ввода)
   ================================================================= */
const CHAR_CHEAT = "/gamemode creative";          // секретная строка-чит «Творчество»
const NICK_RE = /^[A-Za-zА-Яа-яЁё0-9]+$/;          // только буквы и цифры (без пробелов/символов)
/* Строгая валидация ника. Исключение: точная строка /gamemode creative. */
function validateNick(value) {
    const raw = String(value == null ? "" : value);
    if (raw === CHAR_CHEAT) return { ok: true, name: "", creative: true, hardcore: false };
    if (raw.length === 0) return { ok: false, error: "ВВЕДИ НИК: только буквы и цифры!" };
    if (!NICK_RE.test(raw)) return { ok: false, error: "НИК: без пробелов и символов !\"№;%:?*()_+\\/|'~<>.,`" };
    return { ok: true, name: raw, creative: false, hardcore: raw.toLowerCase() === "steve" };
}
function setPlayerProfile(res) {
    G.playerName = res.name || "Стив";
    G.cheatCreative = !!res.creative;      // /gamemode creative: бессмертие + «...»
    G.cheatHardcore = !!res.hardcore;      // steve: 10 HP, фиксированный урон босса
}
/* Обращение босса к игроку: ник, либо строго «...» в режиме «Творчество». */
function bossAddress() {
    if (G.cheatCreative) return "...";
    return G.playerName || "Стив";
}
/* Динамическая подстановка ника вместо «Стив» (включая падежи). */
function applyName(text) {
    if (text == null) return text;
    const addr = bossAddress();
    return String(text).replace(/Стив(а|у|ом|е)?|СТИВ(А|У|ОМ|Е)?/g, addr);
}

/* ---------------------- RPG-ЭКИПИРОВКА (меню [ВЕЩИ]) ---------------------- */
/* 6 предметов в 3 слотах. Слоты: weapon | tool | armor. */
const ITEMS = [
    { id: "dsword",  slot: "weapon", name: "АЛМАЗНЫЙ МЕЧ",        desc: "+5 к урону игрока",           tag: "ОРУЖИЕ" },
    { id: "naxe",    slot: "weapon", name: "НЕЗЕРИТОВЫЙ ТОПОР",   desc: "урон x1.15",                  tag: "ОРУЖИЕ" },
    { id: "ipick",   slot: "tool",   name: "ЖЕЛЕЗНАЯ КИРКА",      desc: "еда восстанавливает +5 HP",   tag: "ИНСТРУМЕНТ" },
    { id: "dshovel", slot: "tool",   name: "АЛМАЗНАЯ ЛОПАТА",     desc: "+1 HP в конце каждого хода",  tag: "ИНСТРУМЕНТ" },
    { id: "ichest",  slot: "armor",  name: "ЖЕЛЕЗНЫЙ НАГРУДНИК",  desc: "-2 к входящему урону",       tag: "БРОНЯ" },
    { id: "dchest",  slot: "armor",  name: "АЛМАЗНЫЙ НАГРУДНИК",  desc: "входящий урон x0.90",         tag: "БРОНЯ" }
];
const findItem = id => ITEMS.find(i => i.id === id) || null;

/* Матрица реакций босса на экипировку предмета.
   Ключ — id предмета. Отдельные реплики для Херобрина и Турбо Шика. */
const HERO_EQUIP_LINES = {
    dsword:  "Хех, думаешь, эти пиксели тебя спасут?",
    naxe:    "Тяжелое орудие. Но я быстрее.",
    ipick:   "Собираешься копать себе могилу?",
    dshovel: "Интересный выбор для финала.",
    ichest:  "Железо не остановит то, что грядет.",
    dchest:  "Ты сияешь от решимости. Жаль, это ненадолго."
};
const TURBO_EQUIP_LINES = {
    dsword:  "Ого, блестяшка! Но против гоночной машины меч бесполезен!",
    naxe:    "Ты собрался рубить дрова или воевать с Королем?!",
    ipick:   "Этой жестянкой ты даже колесо мне не проткнешь!",
    dshovel: "Лопата? Ты хочешь закопать свой позор?",
    ichest:  "Тяжелая броня? Ты станешь только медленнее!",
    dchest:  "Ух ты, сколько алмазов! Жаль, они разобьются вместе с твоими надеждами!"
};
function bossEquipLine(item) {
    const who = G.turboMode ? bossName : "ХЕРОБРИН";
    const line = (G.turboMode ? TURBO_EQUIP_LINES : HERO_EQUIP_LINES)[item.id] || "...";
    return who + ": " + line;
}

/* Имя слота экипировки в G под предмет */
function equipSlot(item) {
    return item.slot === "weapon" ? "equippedWeapon" :
        item.slot === "tool" ? "equippedTool" : "equippedArmor";
}
/* Принудительный сброс инвентаря: все 6 предметов в наличии */
function grantAllEquipment() { G.inventory = ITEMS.slice(); }
/* Надеть/снять предмет. Новый предмет того же слота СНИМАЕТ старый,
   а старый ВОЗВРАЩАЕТСЯ в инвентарь (предметы безрасходуемые). */
function toggleEquip(item) {
    const slot = equipSlot(item);
    if (G[slot] === item) {
        G[slot] = null;                 // снять — предмет остаётся в инвентаре
    } else {
        G[slot] = item;                 // старый слот просто освобождается: набор ITEMS и есть инвентарь
    }
    renderItemList();
    updateHUD();
}

/* ---------------------- ИСТОРИЯ ПРОШЛЫХ ЗАПУСКОВ ---------------------- */
/* Херобрин ПОМНИТ, чем закончилась прошлая игра (localStorage).
   { last: "genocide"|"peace"|"rat", seq: [..2 последних..],
     genos: 0..N, turboActs: 0..N } */
const SAVE_KEY = "hb_run_history";
function loadRunHistory() {
    try {
        const h = JSON.parse(localStorage.getItem(SAVE_KEY) || "{}");
        if (!h) return { seq: [] };
        if (!Array.isArray(h.seq)) h.seq = [];
        if (h.last === undefined || h.last === null) h.last = "peace";
        if (h.genos === undefined) h.genos = 0;
        if (h.turboActs === undefined) h.turboActs = 0;
        return h;
    }
    catch (e) { return { seq: [] }; }
}
function saveRunHistory(h) {
    try {
        if (!h) h = {};
        if (!Array.isArray(h.seq)) h.seq = [];
        localStorage.setItem(SAVE_KEY, JSON.stringify(h));
    }
    catch (e) {}
}
/* Агрессивная концовка — «Убить» (genocide) либо «Скрысить» (rat). */
function isAggressiveEnding(e) { return e === "genocide" || e === "kill" || e === "rat"; }
/* Триггер повторной агрессии: ДВА агрессивных конца ПОДРЯД в любых сочетаниях. */
function isRepeatAggression(h) {
    const seq = Array.isArray(h.seq) ? h.seq.slice(-2) : [];
    return seq.length >= 2 && isAggressiveEnding(seq[0]) && isAggressiveEnding(seq[1]);
}

/* ------------------------- СОСТОЯНИЕ ------------------------- */
const G = {
    screen: "intro",        // intro | transition | boss | ending | final
    bossVisible: true,
    emotion: "resolved",    // resolved | angry | surprised | hope | despair | turbo | turbo_talk | turbo_mad | turbo_sad
    turboMode: false,       // ТУРБО-режим: вторая расправа -> гоночный босс
    mercyBlocked: false,    // блокировка пощады в ТУРБО медалью
    turboFoodGifts: 0,      // подарки яблок в ТУРБО (макс 2)
    medalAnim: null,        // анимация золотой медали
    appleDrop: null,        // падающее яблоко в ТУРБО
    bossHP: 500, bossMaxHP: 500,
    playerHP: 20, playerMaxHP: 20,
    bossBaseDamage: 1,      // базовый урон босса: +0.5 за раунд
    apples: 2,
    inventory: [],          // доступные предметы экипировки
    equippedWeapon: null,   // слоты: weapon | tool | armor
    equippedTool: null,
    equippedArmor: null,
    turnCount: 0,
    spareStreak: 0,
    isAggressive: false,
    mercyReady: false,
    busy: false,
    phase: "PLAYER_TURN",   // INTRO_DIALOGUE | PLAYER_TURN | BOSS_ATTACK
    equipping: false,       // защита от повторного клика по предмету
    playerName: "Стив",     // ник игрока (динамически подставляется в диалогах)
    cheatCreative: false,   // /gamemode creative: бессмертие сердца + «...» вместо имени
    cheatHardcore: false,   // steve: 10 HP и фиксированный урон босса 2
    iframe: 0,
    flash: 0,
    glitch: 0,
    attackActive: false,
    activePattern: null,
    onAttackEnd: null,
    bullets: [],
    particles: [],
    commandShuffle: false,
    moving: false,
    aimActive: false, aimX: 0, aimDir: 1, aimSpeed: 1.05,
    aimResolve: null, aimLockX: 0, aimHit: 0, aimFlash: 0,
    combo: 0,
    floatTexts: [],
    sweeps: 0,
    skipType: null,
    awaitConfirm: false,
    confirmResolve: null,
    typeTimer: null,
    hvx: 0, hvy: 0           // инерция сердца (атака «ТОПЛИВО!»)
};

/* Глобальная стейт-машина: gameState.phase и gameState.turnCount.
   Ссылается на тот же объект, что и G (единый источник истины),
   чтобы движок и вёрстка работали с одним состоянием. */
const gameState = G;

/* ------------------------- ДОМ-ХЕЛПЕРЫ ------------------------- */
const $ = id => document.getElementById(id);
const dialogEl = $("dialog");
const cursorEl = $("cursor");

const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
const rand = (a, b) => a + Math.random() * (b - a);
let wait = ms => new Promise(r => setTimeout(r, ms));

/* =================================================================
   UI-ВЕРСТАЛЬЩИК: переключение экранов
   ================================================================= */
function showScreen(name) {
    document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
    $(name).classList.add("active");
    G.screen = name;
}

/* =================================================================
   ДИАЛОГИ: печать текста, подтверждение, мгновенная установка
   ================================================================= */
function setDialogImmediate(text) {
    if (G.typeTimer) { clearTimeout(G.typeTimer); G.typeTimer = null; }
    G.skipType = null;
    if (G.awaitConfirm) {
        G.awaitConfirm = false;
        const r = G.confirmResolve; G.confirmResolve = null;
        if (r) r();
    }
    dialogEl.textContent = applyName(text);
    cursorEl.style.display = "none";
}
function typeText(text, speed = 22) {
    text = applyName(text);                 // подстановка ника боссом
    return new Promise(resolve => {
        let i = 0, finished = false;
        dialogEl.textContent = "";
        const finish = () => {
            if (finished) return;
            finished = true;
            clearTimeout(G.typeTimer);
            dialogEl.textContent = text;
            G.skipType = null;
            resolve();
        };
        const step = () => {
            if (i >= text.length) { finish(); return; }
            dialogEl.textContent += text[i++];
            G.typeTimer = setTimeout(step, speed);
        };
        G.typeTimer = setTimeout(step, speed);
        G.skipType = finish;
    });
}
function waitConfirm() {
    return new Promise(res => { G.awaitConfirm = true; G.confirmResolve = res; });
}
function confirm() {
    if (G.skipType) { G.skipType(); return; }
    if (G.awaitConfirm) {
        G.awaitConfirm = false;
        cursorEl.style.display = "none";
        const r = G.confirmResolve; G.confirmResolve = null;
        if (r) r();
    }
}
async function say(text, speed = 20) {
    await typeText(text, speed);
    cursorEl.style.display = "block";
    await waitConfirm();
}
async function saySpelled(text, speed = 90) {
    await typeText(text, speed);
    cursorEl.style.display = "block";
    await waitConfirm();
}

/* =================================================================
   СЦЕНАРИСТ: СКРИПТ МОНОЛОГОВ (привязан к номеру хода и пути)
   ================================================================= */
const PACIFIST_SCRIPT = [
    null,
    "Ты думал, что соединяешь игры ради веселья, Стив? Ты даже не понимаешь, какую силу пробуждаешь...",
    "Я здесь не как враг. Я — узел, который должен быть разорван, пока петля не замкнулась.",
    "Я видел конец мультивселенной. Я видел ТЕБЯ там. Самое сильное существо в истории... и самое разрушительное.",
    "Каждый мир, что ты соединишь, станет пеплом. Каждая вселенная — ступенью твоего восхождения.",
    "...Ты всё ещё щадишь. Странно. Я не помню, чтобы ты был таким.",
    "В моей памяти ты выжигал миры дотла. А сейчас просто стоишь и смотришь на меня.",
    "Почему ты не бьёшь? Это... не сходится с тем, что я помню. Моё прошлое... меняется?",
    "Если история меняется... значит, судьбу можно переписать? Нет. Я не смею надеяться.",
    "Девять шагов без крови. В моей памяти их никогда не было.",
    "Каждая твоя пощада ломает одну из петель, что я носил в себе. Я становлюсь легче.",
    "Ха... Может, я ошибался? Может, тебя можно... изменить?",
    "Неужели временная петля наконец-то разорвана? Неужели ты... другой?",
    "Я вижу, как линии вероятностей перестраиваются. Миры, что я считал погибшими, снова тянутся к свету.",
    "Ты устал, Стив? Я тоже. Но впервые за вечность мне не хочется останавливаться."
];
const AGGR_KEYED = {
    1:  "Ты думал, что соединяешь игры ради веселья, Стив? Ты даже не понимаешь, какую силу пробуждаешь...",
    2:  "Твой меч прожёг ткань времени. Я чувствую это. Отголосок того самого Стива.",
    3:  "Значит, пророчество не врёт! Ты — чудовище, Стив! Я уничтожу тебя здесь, в этой временной точке, чтобы спасти миллионы миров!",
    4:  "Я видел конец мультивселенной. Я видел ТЕБЯ там. Самое сильное существо в истории... и самое разрушительное.",
    5:  "Считаешь раны? Я их не считаю. Я считаю миры, которые ещё можно спасти.",
    7:  "Ты бьёшь так, как будто торопишься в свой кровавый рассвет.",
    10: "Половина времени позади. А ты всё ещё дышишь. Я начинаю верить, что достоин тебя.",
    13: "Твоя решимость только растёт. Как и моя — остановить тебя.",
    16: "Я чувствую предел. Но ты его не чувствуешь вовсе.",
    19: "Последнее, что ты получишь от меня — это страх, что я прав."
};
const AGGR_QUIPS = [
    "Твой удар разрезал не воздух — он разрезал будущее всех миров.",
    "Я чувствую каждый удар. И каждый раз ты становишься сильнее. Как и тот, из пророчества.",
    "Так вот как ты строишь свой восход — на осколках выжженных вселенных.",
    "Продолжай. Покажи мне ту версию себя, что я поклялся стереть.",
    "Сердце колотится. Твоё — тоже. Но моё знает, чем это закончится.",
    "Нет той грязи, в которую ты не готов встать ради силы."
];
const AGGR_SPARE_QUIPS = [
    "Ты бьёшь, но потом щадишь. Кто ты, Стив? Излом, ещё не выбравший форму?",
    "Жалость — это ловушка, которую ты строишь сам себе.",
    "Не думай, что спасительный ход сотрёт твою вину. Я всё помню.",
    "Ты льёшь мне кровь, а потом подставляешь ладонь. Это хуже, чем открытая жестокость."
];
let aggrQuipIdx = 0;
function pacifistMonologue(t) {
    const line = PACIFIST_SCRIPT[Math.min(t, PACIFIST_SCRIPT.length - 1)];
    return "ХЕРОБРИН: " + line;
}
function aggressiveMonologue(t) {
    if (AGGR_KEYED[t]) return "ХЕРОБРИН: " + AGGR_KEYED[t];
    const q = AGGR_QUIPS[aggrQuipIdx % AGGR_QUIPS.length];
    aggrQuipIdx++;
    return "ХЕРОБРИН: " + q;
}
function aggressiveSpareMonologue(n) {
    return "ХЕРОБРИН: " + AGGR_SPARE_QUIPS[n % AGGR_SPARE_QUIPS.length];
}

/* =================================================================
   ЧЕЛОВЕК-ОРКЕСТР: HUD
   ================================================================= */
function updateHUD() {
    const bp = Math.max(0, G.bossHP) / G.bossMaxHP * 100;
    const pp = Math.max(0, G.playerHP) / G.playerMaxHP * 100;
    $("bossHpBar").style.width = bp + "%";
    $("playerHpBar").style.width = pp + "%";
    $("bossHpTxt").textContent = Math.max(0, Math.round(G.bossHP)) + " / " + G.bossMaxHP;
    $("playerHpTxt").textContent = Math.max(0, Math.round(G.playerHP)) + " / " + G.playerMaxHP;
    const total = G.isAggressive ? AGGR_TURNS : MERCY_TURNS;
    const chain = G.combo >= 2 ? "  •  ПЫЛ x" + Math.min(G.combo, 5) : "";
    $("turnTxt").textContent = "ХОД " + gameState.turnCount + " / " + total + chain;
}

/* =================================================================
   UI: меню действий + навигация кнопок клавиатурой
   ================================================================= */
const menuEl = $("menu");
let uiFocus = 0;

/* Кнопки активного экрана, доступные для навигации */
function uiFocusEls() {
    const scr = document.querySelector(".screen.active");
    if (!scr) return [];
    const out = Array.from(scr.querySelectorAll(".btn"));
    if (scr.id === "final") out.push($("finalLink"));
    return out.filter(b => !b.disabled && b.offsetParent !== null);
}
function uiFocusApply() {
    const list = uiFocusEls();
    if (!list.length) return false;
    uiFocus = Math.max(0, Math.min(uiFocus, list.length - 1));
    try { list[uiFocus].focus({ preventScroll: true }); } catch (e) { list[uiFocus].focus(); }
    return true;
}
function uiStep(dir) {
    const list = uiFocusEls();
    if (!list.length) return;
    uiFocus = (uiFocus + dir + list.length) % list.length;
    uiFocusApply();
}
function uiPressFocused() {
    const list = uiFocusEls();
    if (!list.length) return false;
    uiFocus = Math.max(0, Math.min(uiFocus, list.length - 1));
    list[uiFocus].click();
    return true;
}
function showMenu() {
    menuEl.style.display = "flex";
    menuEl.querySelectorAll(".btn").forEach(b => b.disabled = !!G.busy);
    menuEl.querySelectorAll(".btn").forEach(b => b.classList.remove("shuffle"));
    const mb = menuEl.querySelector('[data-act="mercy"]');
    if (mb) {
        if (G.mercyBlocked) { mb.disabled = true; mb.classList.add("broken"); }
        else { mb.classList.remove("broken"); }
    }
    uiFocus = 0;
    uiFocusApply();
}
function hideMenu() { menuEl.style.display = "none"; }
function shuffleButtons() {
    const btns = Array.from(menuEl.children);
    for (let i = btns.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        menuEl.appendChild(btns[j]);
        [btns[i], btns[j]] = [btns[j], btns[i]];
    }
    btns.forEach(b => { b.classList.remove("shuffle"); void b.offsetWidth; b.classList.add("shuffle"); });
}

/* =================================================================
   ИНВЕНТАРЬ / RPG-ЭКИПИРОВКА: экран [ВЕЩИ]
   ================================================================= */
const itemsEl = $("items");
function renderItemList() {
    const eq = [G.equippedWeapon, G.equippedTool, G.equippedArmor];
    const rows = ITEMS.map(item => {
        const isEq = eq.indexOf(item) !== -1;
        const name = item.tag + " · " + item.name;
        const mark = isEq ? "[ЭКИПИРОВАНО]" : "ОДЕТЬ";
        return '<button class="item-row btn' + (isEq ? " equipped" : "") + '" data-item="' + item.id + '">' +
            '<span>' + name + '<small>' + item.desc + '</small></span>' +
            '<span class="act">' + mark + '</span></button>';
    }).join("");
    const apple = '<button class="item-row btn" data-eat="1">' +
        '<span>ЕДА · ЗОЛОТОЕ ЯБЛОКО<small>+8 HP, в запасе: ' + G.apples + '</small></span>' +
        '<span class="act">СЪЕСТЬ</span></button>';
    const ol = $("itemList");
    ol.innerHTML = rows + apple;
    uiFocus = 0;
    uiFocusApply();
}
async function openItemMenu() {
    if (G.busy || G.screen !== "boss") return;
    G.busy = true;
    hideMenu();
    cursorEl.style.display = "none";
    renderItemList();
    showScreen("items");
}
function closeItemMenu() {
    showScreen("boss");
    G.busy = false;
    showMenu();
}
/* Надеть предмет из инвентаря. Экипировка Оружия/Инструмента/Брони
   считается завершением хода: босс выдаёт реплику-реакцию, затем
   (через паузу 1.5–2 сек) инвентарь закрывается и запускается раунд
   атаки босса — beginBossTurn() → startBossAttackPhase(). Снятие предмета ход НЕ тратит. */
async function equipItemFromInventory(item) {
    if (!item || G.equipping) return;
    const slot = equipSlot(item);
    const wasEquipped = (G[slot] === item);
    toggleEquip(item);
    if (wasEquipped) return;            // снятие предмета — не действие хода

    G.equipping = true;
    updateHUD();
    showScreen("boss");                 // закрываем инвентарь, чтобы видеть реплику
    cursorEl.style.display = "none";
    /* 2) уникальная реплика-реакция босса */
    if (G.turboMode) G.emotion = "turbo_talk";
    await typeText(bossEquipLine(item), 22);
    /* 3) небольшая пауза 1.5–2 сек, затем раунд атаки босса */
    await wait(1600);
    G.equipping = false;
    await beginBossTurn();
}
async function eatApple() {
    if (G.apples <= 0) { await say("Сумка пуста..."); return; }
    G.apples--;
    let heal = 8;
    if (G.equippedTool === findItem("ipick")) heal += 5;    // Железная кирка: еда +5 HP
    heal = Math.min(heal, G.playerMaxHP - G.playerHP);
    G.playerHP += heal;
    showScreen("boss");
    updateHUD();
    addFloatText(318, 76, "+" + heal, "#7dff6a");
    await say("Золотое яблоко! +" + heal + " HP. Осталось: " + G.apples);
    await say((G.turboMode ? bossName : "ХЕРОБРИН") + ": Лечишься перед смертью? Это тебе не поможет.");
    // ТУРБО: гордость — подкрепка при полном истощении припасов (макс 2 раза за бой)
    if (G.turboMode && G.apples === 0 && G.turboFoodGifts < 2) {
        G.turboFoodGifts++;
        await say(bossName + ": Что, Стив, закончились припасы? Я не хочу побеждать слабака! На, подкрепись!");
        fireAppleDrop();
        await wait(400);
        G.apples += 1;
        updateHUD();
        addFloatText(318, 60, "+1 ЕДА", "#ffd75e");
    }
    await beginBossTurn();               // еда отнимает ход: босс контратакует
}
itemsEl.addEventListener("click", e => {
    const it = e.target.closest("[data-item]");
    if (it) { equipItemFromInventory(findItem(it.dataset.item)); return; }
    if (e.target.closest("[data-eat]")) { eatApple(); return; }
    if (e.target.closest("#itemsBack")) { closeItemMenu(); }
});

/* =================================================================
   ТУРБО-МУЗЫКА (WebAudio, быстрая)
   ================================================================= */
let turboAudioCtx = null, turboMusicIntv = null;
function startTurboMusic() {
    try {
        if (typeof window === "undefined") return;
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        if (!turboAudioCtx) turboAudioCtx = new AC();
        if (turboAudioCtx.state === "suspended") turboAudioCtx.resume();
        if (turboMusicIntv) return;
        const notes = [523, 587, 659, 698, 784, 880, 988, 1047, 880];
        let i = 0;
        const bpm = 240;
        const iv = Math.floor(60000 / bpm / 2);
        turboMusicIntv = setInterval(function () {
            const f = notes[i % notes.length];
            i++;
            if (!turboAudioCtx) return;
            const osc = turboAudioCtx.createOscillator();
            const gain = turboAudioCtx.createGain();
            osc.type = "square";
            osc.frequency.value = f * 0.7;
            gain.gain.value = 0.07;
            osc.connect(gain); gain.connect(turboAudioCtx.destination);
            const t = turboAudioCtx.currentTime;
            osc.start(t);
            osc.stop(t + Math.max(0.08, iv / 1000) * 0.85);
        }, iv);
    } catch (e) { /* без звука */ }
}
function stopTurboMusic() {
    if (turboMusicIntv) { clearInterval(turboMusicIntv); turboMusicIntv = null; }
}

/* =================================================================
   ДИРИЖЁР: сброс боя
   ================================================================= */
function resetBattle() {
    G.bossHP = G.bossMaxHP = 500;
    /* Хардкорный ник steve: 10 HP и фиксированный урон босса 2 (без роста). */
    G.playerMaxHP = G.cheatHardcore ? 10 : 20;
    G.playerHP = G.playerMaxHP;
    G.bossBaseDamage = G.cheatHardcore ? 2 : 1;
    G.apples = 2;
    grantAllEquipment();            // сброс инвентаря: все 6 предметов в наличии
    G.equippedWeapon = null;        // слоты экипировки снимаются
    G.equippedTool = null;
    G.equippedArmor = null;
    gameState.turnCount = 0;
    G.spareStreak = 0;
    G.isAggressive = false;
    G.mercyReady = false;
    gameState.phase = "PLAYER_TURN";    // до старта боя — нейтральное состояние
    G.emotion = "resolved";
    G.bossVisible = true;
    G.bullets = [];
    G.particles = [];
    G.glitch = 0;
    G.iframe = 0;
    G.commandShuffle = false;
    G.moving = false;
    G.turboMode = false;
    G.mercyBlocked = false;
    G.turboFoodGifts = 0;
    G.medalAnim = null;
    G.appleDrop = null;
    G.combo = 0;
    G.floatTexts = [];
    G.sweeps = 0;
    G.hvx = 0; G.hvy = 0;
    G.aimActive = false; G.aimResolve = null;
    aggrQuipIdx = 0;
    /* сброс кнопки пощады после «сломанного» состояния */
    const mb = menuEl.querySelector('[data-act="mercy"]');
    if (mb) { mb.disabled = false; mb.classList.remove("broken", "mercyGlow"); }
    resetPatternState();
    updateHUD();
}

/* =================================================================
   ДИРИЖЁР: ходы, действия, решения
   ================================================================= */
async function resolveAction(action) {
    const t = gameState.turnCount + 1;          // номер текущего хода

    /* ---- ФИНАЛЬНЫЙ ВЫБОР (14 пощад) ---- */
    if (G.mercyReady) {
        if (action === "fight") { await ratEnding(); return "ended"; }
        if (action === "mercy") { await pacifismEnding(); return "ended"; }
        await say("ХЕРОБРИН: Реши сейчас, Стив. Пощада... или удар.");
        return "standoff";
    }

    if (action === "fight") {
        const firstBlood = !G.isAggressive;
        G.isAggressive = true;
        if (firstBlood && G.emotion !== "angry") G.emotion = "angry";
        await say(aggressiveMonologue(t));      // монолог по ходу
        setDialogImmediate("Попади точно в центр!");
        const hit = await startFightAim();
        let dmg = hit.dmg;
        if (G.equippedWeapon === findItem("dsword")) dmg += 5;          // Алмазный меч: +5
        else if (G.equippedWeapon === findItem("naxe")) dmg *= 1.15;    // Незеритовый топор: +15%
        const perfect = hit.dist <= 0.12;
        if (perfect) G.combo++;
        else if (hit.dist > 0.32) G.combo = 0;
        dmg = Math.max(1, Math.round(dmg * (1 + 0.1 * Math.min(G.combo, 5))));   // ПЫЛ — серия точных ударов
        G.bossHP -= dmg;
        updateHUD();
        addFloatText(320 + rand(-20, 20), 120 + rand(-25, 5), (perfect ? "КРИТ " : "") + "-" + dmg, perfect ? "#ffd75e" : "#ff8a8a");
        if (perfect) { G.flash = 0.3; hitBurst(); }
        if (G.bossHP <= 0) {
            const h = loadRunHistory();
            /* ТУРБО («Турбо Шик») — при ДВУХ агрессивных концах ПОДРЯД. */
            if (!G.turboMode && isRepeatAggression(h)) {
                await triggerTurbo(h);
                return "normal";
            }
            if (G.turboMode) { await triggerTurboDeath(); return "ended"; }
            await triggerGenocide();
            return "ended";
        }
        await say("Вы нанесли " + dmg + " урона. Херобрин держится.");
        if (G.bossHP < 80) {                    // агония на пороге смерти
            await say("ХЕРОБРИН: Я... я не могу упасть. Ради этих миров...");
        }
        return "normal";
    }

    if (action === "act") {
        await say("СТИВ: ХЕРОБРИН. АТК 999 ЗЩ 999.");
        await say("СТИВ: Стив из будущего. Спасает вселенные... или сам запутывает петлю?");
        if (t >= 3 && !G.isAggressive) await say("ХЕРОБРИН: Ты изучаешь меня. Хоть что-то осталось от прежнего Стива.");
        return "normal";
    }

    if (action === "item") {
        /* [ВЕЩИ] перехватывается в doAction -> openItemMenu() и хода не тратит */
        return "normal";
    }

    if (action === "mercy") {
        /* ТУРБО: пощада заблокирована. Первая попытка — золотая медаль
           ломает кнопку [ПОЩАДА] прямо на глазах у игрока. */
        if (G.turboMode && !G.mercyBlocked) {
            G.mercyBlocked = true;
            await say(bossName + ": Ахаха! Пощада? Серьезно?!");
            fireMedal();
            await wait(650);
            const mb = $("boss").querySelector('[data-act="mercy"]');
            if (mb) { mb.disabled = true; mb.classList.add("broken"); }
            await say(bossName + ": Здесь останется только один из нас. Либо ты, либо я!");
            return "normal";
        }
        if (G.turboMode && G.mercyBlocked) {
            return "normal";
        }
        G.spareStreak++;

        if (!G.isAggressive) {
            // шкала эмоций: 5 пощад — удивление, 11+ — надежда
            if (G.spareStreak >= 11) G.emotion = "hope";
            else if (G.spareStreak >= 5) G.emotion = "surprised";
            else G.emotion = "resolved";

            await say(pacifistMonologue(t));    // монолог пацифизма по ходу

            if (G.spareStreak >= MERCY_TURNS - 1) {
                G.emotion = "hope";
                G.mercyReady = true;
                menuEl.querySelector('[data-act="mercy"]').classList.add("mercyGlow");
                await say("ХЕРОБРИН: ...Я устал.");
                await say("ХЕРОБРИН: Ха... может ты и есть та самая версия, что не разрушит мультивселенную.");
                await say("ХЕРОБРИН: Последний ход, Стив. Я опускаю кулаки. Решай.");
                return "standoff";
            }
        } else {
            await say(aggressiveSpareMonologue(G.spareStreak));
        }
        return "normal";
    }
    return "normal";
}

async function doAction(action) {
    if (G.busy || G.screen !== "boss") return;
    if (action === "item") { await openItemMenu(); return; }    // [ВЕЩИ] → инвентарь (без траты хода)
    G.busy = true;
    hideMenu();
    cursorEl.style.display = "none";
    G.awaitConfirm = false; G.skipType = null;

    try {
        const result = await resolveAction(action);
        if (result === "ended") return;              // экран концовки забрал управление

        if (result === "standoff") {
            gameState.turnCount = MERCY_TURNS - 1;   // показываем «ХОД 14 / 15»
            updateHUD();
            gameState.phase = "PLAYER_TURN";
            G.busy = false;
            showMenu();
            return;
        }

        /* обычный ход: босс контратакует */
        await beginBossTurn();
    } catch (err) {
        /* ЗАЩИТА ОТ ЗАВИСАНИЯ: ошибка в ходе не должна намертво
           блокировать интерфейс — гарантированно возвращаем ход игроку. */
        console.error("[script] doAction('" + action + "') error:", err);
        gameState.phase = "PLAYER_TURN";
        G.busy = false;
        showMenu();
    }
}

/* Конец хода игрока: пассивные бонусы экипировки */
function endTurn() {
    if (G.equippedTool === findItem("dshovel") && G.playerHP < G.playerMaxHP) {
        G.playerHP += 1;                        // Алмазная лопата: +1 HP в конце каждого хода
        updateHUD();
        addFloatText(318, 76, "+1", "#7dff6a");
    }
}
/* КОНЕЦ ХОДА ИГРОКА: пассивные бонусы экипировки, затем фаза атаки
   босса. Гарантированно возвращает управление игроку (showMenu) даже
   при срабатывании watchdog движка. */
async function beginBossTurn() {
    endTurn();                                   // пассивные бонусы экипировки
    updateHUD();

    /* ФАЗА АТАКИ БОССА: запускается движок (engine.js) — он гарантирует
       игровой цикл Canvas, выбирает паттерн и снимает фазу по watchdog. */
    await startBossAttackPhase();                // gameState.phase = "BOSS_ATTACK"
    gameState.turnCount++;                       // раунд завершён (+1)
    if (!G.cheatHardcore) G.bossBaseDamage += 0.5;   // хардкор (steve): рост урона отключён
    updateHUD();

    if (G.playerHP <= 0) { await gameOver(); return; }
    if (G.commandShuffle) { shuffleButtons(); G.commandShuffle = false; }

    /* жёсткий предел ходов — последний рубеж */
    const cap = G.isAggressive ? AGGR_TURNS : MERCY_TURNS;
    if (gameState.turnCount >= cap && !G.mercyReady && G.bossHP > 0) {
        const who = G.turboMode ? bossName : "ХЕРОБРИН";
        await say(who + ": Времени больше нет, Стив.");
        await say(who + ": Если ты не способен на выбор — мне придётся спасать миры по-своему.");
        await triggerGenocide();
        return;
    }

    /* ВОЗВРАТ К ИГРОКУ: дефолтное описание раунда + разблокировка кнопок */
    gameState.phase = "PLAYER_TURN";
    setDialogImmediate((G.turboMode ? bossName : "Херобрин") + " смотрит сквозь тебя...");
    G.busy = false;
    showMenu();
    updateHUD();
}

menuEl.addEventListener("click", e => {
    const btn = e.target.closest("[data-act]");
    if (!btn || btn.disabled) return;
    doAction(btn.dataset.act);
});

/* =================================================================
   ТРИ КОНЦОВКИ + ТУРБО (вторая расправа)
   ================================================================= */
async function triggerTurbo(hHist) {
    const h = hHist || loadRunHistory();
    const seq = Array.isArray(h.seq) && h.seq.length >= 2 ? h.seq.slice(-2)
        : (Array.isArray(h.seq) && h.seq.length === 1 ? [h.seq[0], h.last || h.seq[0]]
        : [h.last || "peace", h.last || "peace"]);
    G.screen = "boss";
    G.busy = true;
    hideMenu();
    cursorEl.style.display = "none";
    G.glitch = 1;
    cv.classList.add("glitching");

    /* Канонические реплики ТУРБО ШИКА (см. wiki_guide.md). */
    const lineBetrayal =
        bossName + ": Ахаха! Этот наивный дурак Херобрин действительно поверил тебе?! " +
        "Он думал, что Стив может исправиться! Ну ты и грязный игрок, мне это нравится! Погнали!";
    const lineDoubleRat =
        "Оу... Вау. Два раза подряд ударить его в спину после пощады? Серьезно, Стив? " +
        "Да ты еще больший психопат и вирус, чем я! Даже мне от тебя не по себе... " +
        "Но тем веселее будет тебя стереть!";
    const lineClassic = "Вы так и не изменились...";

    const s0 = (seq[0] === "genocide" || seq[0] === "kill") ? "genocide" : (seq[0] === "rat" ? "rat" : (seq[0] === "peace" ? "peace" : seq[0]));
    const s1 = (seq[1] === "genocide" || seq[1] === "kill") ? "genocide" : (seq[1] === "rat" ? "rat" : (seq[1] === "peace" ? "peace" : seq[1]));

    const isBetrayal = (s0 === "genocide" && s1 === "rat") || (s0 === "rat" && s1 === "genocide");
    const isDoubleRat = (s0 === "rat" && s1 === "rat");

    if (isDoubleRat) {
        G.emotion = "turbo_sad";                // шок (Турбо_серьёзное_лицо)
        await saySpelled("Оу... Вау...");
        await wait(400);
        await saySpelled(lineDoubleRat);
        G.emotion = "turbo";
    } else if (isBetrayal) {
        G.emotion = "turbo_mad";                // злая гримаса (Турбо_зол)
        await saySpelled(bossName + ": Ахаха!");
        await wait(250);
        await saySpelled(lineBetrayal);
    } else {
        G.emotion = "turbo_mad";
        await saySpelled(lineClassic);
    }

    startTurboMusic();
    await wait(700);
    G.turboMode = true;
    G.emotion = "turbo";
    G.mercyBlocked = false;
    G.turboFoodGifts = 0;
    G.medalAnim = null;
    grantAllEquipment();
    G.bossHP = G.bossMaxHP = 600;
    G.bossBaseDamage = G.cheatHardcore ? 2 : 1;   // хардкор (steve): фиксированный урон
    G.glitch = 0;
    cv.classList.remove("glitching");
    updateHUD();
    G.emotion = "turbo_talk";                   // открытый рот (Турбо_говорит)
    await say(bossName + ": Эта трасса — моя! Жми газ, и погнали, детка!");
    G.emotion = "turbo";
    G.busy = false;
    showMenu();
}
async function triggerGenocide() {
    const h = loadRunHistory();
    h.genos = (h.genos || 0) + 1;
    if (G.turboMode) h.turboActs = (h.turboActs || 0) + 1;   // учёт турбо-зачистки
    h.last = "genocide";
    if (!Array.isArray(h.seq)) h.seq = [];
    h.seq.push("genocide");
    if (h.seq.length > 2) h.seq = h.seq.slice(h.seq.length - 2);
    saveRunHistory(h);
    stopTurboMusic();
    G.screen = "ending";
    G.busy = true;
    hideMenu();
    cursorEl.style.display = "none";
    G.emotion = "despair";
    G.glitch = 0.6;
    if (h.turboActs >= 1) {
        await say("ХЕРОБРИН: ...Я проиграл даже на моей скорости.");
        await say("ХЕРОБРИН: Игра окончена, Стив. Ты победил раунд.");
        await say("ХЕРОБРИН: Но я всё ещё помню, как ты ходил.");
    } else {
        await say("ХЕРОБРИН: Я... я не могу упасть. Ради этих миров...");
        await say("ХЕРОБРИН: Неужели мультивселенная закончится вот так?");
        await say("ХЕРОБРИН: Стив... ты... чудовище...");
    }
    crumbleBoss();
    await wait(700);
    cv.classList.remove("glitching");
    G.glitch = 0;
    showFinal("genocide");
}
async function triggerTurboDeath() {
    const h = loadRunHistory();
    h.genos = (h.genos || 0) + 1;
    h.turboActs = (h.turboActs || 0) + 1;
    h.last = "genocide";
    if (!Array.isArray(h.seq)) h.seq = [];
    h.seq.push("genocide");
    if (h.seq.length > 2) h.seq = h.seq.slice(h.seq.length - 2);
    saveRunHistory(h);

    stopTurboMusic();
    G.screen = "ending";
    G.busy = true;
    hideMenu();
    cursorEl.style.display = "none";
    G.bossVisible = true;                 // Турбо Шик ещё на сцене
    G.glitch = 0;

    /* 1) спрайт босса — строго Турбо_говорит.png (открытый рот) */
    G.emotion = "turbo_talk";
    /* 2) оборванная реплика возрождения */
    setDialogImmediate("Ха-ха! Я же возрож...");
    /* 3) ровно посреди слова игра замирает (пауза 1.5 сек) */
    await wait(1500);
    G.glitch = 0.6;                       // фиксация «замершего» кадра
    /* 4) спрайт мгновенно -> Турбо_серьёзное_лицо.png (точка вместо рта) */
    G.emotion = "turbo_sad";
    /* 5) текст продолжается */
    setDialogImmediate("... Я не в своей игре... НЕТ!");
    /* 6) ещё через 3 секунды экран гаснет: интерфейс боя стирается,
          по центру остаётся кликабельная ссылка на GitHub-репозиторий */
    await wait(3000);
    G.glitch = 0;
    showFinalTurbo();
}
async function pacifismEnding() {
    const h = loadRunHistory();
    h.last = "peace";
    if (!Array.isArray(h.seq)) h.seq = [];
    h.seq.push("peace");
    if (h.seq.length > 2) h.seq = h.seq.slice(h.seq.length - 2);
    saveRunHistory(h);
    G.screen = "ending";
    G.busy = true;
    hideMenu();
    cursorEl.style.display = "none";
    G.emotion = "hope";
    await say("ХЕРОБРИН: ...Я устал.");
    await say("ХЕРОБРИН: Ха... может ты и есть та самая версия,");
    await say("ХЕРОБРИН: что не разрушит мультивселенную.");
    await say("ХЕРОБРИН: Херобрин разжимает кулак.");
    await say("ХЕРОБРИН: Возьми. Может, ты найдёшь лучший путь.");
    await wait(700);
    showFinal("peace");
}
async function ratEnding() {
    const h = loadRunHistory();
    h.last = "rat";
    if (!Array.isArray(h.seq)) h.seq = [];
    h.seq.push("rat");
    if (h.seq.length > 2) h.seq = h.seq.slice(h.seq.length - 2);
    saveRunHistory(h);
    G.screen = "ending";
    G.busy = true;
    hideMenu();
    cursorEl.style.display = "none";
    G.glitch = 1;
    cv.classList.add("glitching");
    G.emotion = "despair";
    await say("ХЕРОБРИН: ...Ах...");
    await say("ХЕРОБРИН: Стив... ты предал меня... снова и снова...");
    await say("ХЕРОБРИН: Но я всё ещё верю, что ты сможешь измениться...");
    await say("ХЕРОБРИН: Крыса! Ты всегда будешь ползать... во мне!");
    await say("ХЕРОБРИН: ...");
    crumbleBoss();
    await wait(1000);
    cv.classList.remove("glitching");
    showFinal("rat");
}

/* ------------------------- ЭКРАН ФИНАЛА ------------------------- */
/* Победа над Турбо Шиком: экран полностью гаснет (чернеет), боевой
   интерфейс стирается, а по центру остаётся прямая кликабельная
   ссылка на GitHub-репозиторий. */
function showFinalTurbo() {
    G.screen = "final";
    G.glitch = 0;
    G.bossVisible = false;
    stopTurboMusic();
    cv.classList.remove("glitching");
    document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
    $("gameover").classList.remove("active");

    const f = $("final");
    f.className = "screen active";
    f.style.background = "#000";
    /* стираем боевой интерфейс — остаётся только ссылка по центру */
    $("finalTitle").style.display = "none";
    $("finalText").style.display = "none";
    $("restart").style.display = "none";
    const foot = f.querySelector(".foot");
    if (foot) foot.style.display = "none";

    const link = $("finalLink");
    link.href = GITHUB_LINK;
    link.textContent = GITHUB_LINK;
    link.style.animation = "none";
    link.style.boxShadow = "0 0 26px rgba(255,255,255,0.85)";

    /* плавное затемнение -> проявление ссылки по центру */
    f.style.opacity = "0";
    f.style.transition = "opacity 1.2s ease-out";
    requestAnimationFrame(() => requestAnimationFrame(() => { f.style.opacity = "1"; }));
}
function showFinal(kind) {
    G.screen = "final";
    G.glitch = 0;
    stopTurboMusic();
    cv.classList.remove("glitching");
    document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
    $("gameover").classList.remove("active");
    const f = $("final");
    const link = $("finalLink");
    if (kind === "peace") {
        f.className = "screen active final-peace";
        $("finalTitle").textContent = "ПОЩАДА";
        $("finalText").textContent =
            "Херобрин разжал кулак. Временная петля разорвана. Ты выбрал милосердие.";
    } else if (kind === "rat") {
        f.className = "screen active final-rat";
        $("finalTitle").textContent = "ПРЕДАТЕЛЬСТВО";
        $("finalText").textContent =
            "Ты дал ему надежду... и ударил в спину. Крыса внутри тебя победила.";
    } else {
        f.className = "screen active final-genocide";
        $("finalTitle").textContent = "ГЕНОЦИД";
        $("finalText").textContent =
            "Ты стёр Херобрина. Мультивселенная обречена.";
    }
    link.href = GITHUB_LINK;
    link.textContent = GITHUB_LINK;
}

$("restart").addEventListener("click", () => location.reload());

/* =================================================================
   СМЕРТЬ: предсмертный монолог + переход к ссылке на GitHub
   ================================================================= */
async function gameOver() {
    stopTurboMusic();
    G.busy = true;
    hideMenu();
    cursorEl.style.display = "none";
    cv.classList.remove("glitching");
    /* предсмертный монолог */
    await say("ХЕРОБРИН: Вот и всё, Стив. Твоё время истекло.");
    await say("ХЕРОБРИН: Но я не дам тебе просто так уйти. Запомни этот урок.");
    await say("ХЕРОБРИН: Оставайся решительным... или узнай, что ждёт тебя за гранью.");
    setDialogImmediate("...");
    const ov = $("gameover");
    $("goText").textContent = "Ты не должен сдаваться... Оставайся решительным.";
    $("goMono").textContent = "Херобрин помнит каждую твою смерть. Но и ты помнишь путь.";
    const gl = $("goLink");
    gl.href = GITHUB_LINK;
    gl.textContent = "Последняя тропа -> " + GITHUB_LINK;
    ov.classList.add("active");
}
$("retry").addEventListener("click", () => {
    $("gameover").classList.remove("active");
    resetBattle();
    G.busy = false;
    showMenu();
});

/* =================================================================
   ЭКРАН 1: вступление и кнопка-уклонистка [НЕТ]
   ================================================================= */
const noBtn = $("noBtn");
function dodgeNo(px, py) {
    noBtn.style.position = "fixed";
    const w = noBtn.offsetWidth || 160;
    const h = noBtn.offsetHeight || 52;
    let nx, ny, tries = 0;
    do {
        nx = rand(20, Math.max(30, window.innerWidth - w - 20));
        ny = rand(20, Math.max(30, window.innerHeight - h - 20));
        tries++;
    } while (px != null && Math.hypot(px - (nx + w / 2), py - (ny + h / 2)) < 220 && tries < 40);
    noBtn.style.left = nx + "px";
    noBtn.style.top = ny + "px";
}
window.addEventListener("mousemove", e => {
    if (G.screen !== "intro") return;
    const r = noBtn.getBoundingClientRect();
    if (r.left === 0 && r.top === 0) return;
    const d = Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
    if (d < 140) dodgeNo(e.clientX, e.clientY);
});
noBtn.addEventListener("pointerenter", e => { if (G.screen === "intro") dodgeNo(e.clientX, e.clientY); });
noBtn.addEventListener("click", e => { if (G.screen === "intro") dodgeNo(e.clientX, e.clientY); });

$("yesBtn").addEventListener("click", async () => {
    if (G.screen !== "intro") return;
    /* Строгая валидация ника (с исключением для чита). */
    const res = validateNick($("nickInput").value);
    if (!res.ok) { $("nickErr").textContent = res.error; return; }
    setPlayerProfile(res);
    $("nickErr").textContent = "";
    G.screen = "transition";
    $("intro").classList.add("glitchout");
    await wait(1000);
    showScreen("boss");
    await startBattle();
});
/* Ввод ника: сброс ошибки при наборе, Enter — начать игру. */
$("nickInput").addEventListener("input", () => { $("nickErr").textContent = ""; });
$("nickInput").addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); $("yesBtn").click(); }
});

/* СТАРТОВЫЙ МОНОЛОГ ХЕРОБРИНА (фаза INTRO_DIALOGUE).
   Первое сообщение всегда обращается к игроку по нику. «Стив»
   подставляется через applyName(): обычный ник — как есть, чит
   /gamemode creative → строго «...». Пока идёт монолог, кнопки
   действий игрока заблокированы (busy + hideMenu в startBattle). */
async function playIntroDialogue() {
    const h = loadRunHistory();
    const seen = h.last;
    await say("ХЕРОБРИН: Ну привет, Стив, я ждал тебя...");
    if (seen === "genocide") {
        MERCY_TURNS = 15;
        await say("ХЕРОБРИН: ...Это снова ты?!");
        await say("ХЕРОБРИН: Я не позволю тебе... Это же уже было!");
        await say("ХЕРОБРИН: Что ты выбираешь — передумал, или решил повеселиться?");
        await say("ХЕРОБРИН: В прошлый раз ты меня убил. В этот раз — я тебя убью.");
    } else if (seen === "peace") {
        MERCY_TURNS = 15;
        await say("ХЕРОБРИН: ...Ты вернулся?");
        await say("ХЕРОБРИН: Зачем тебе перезапуск, если ты пощадил меня?");
        await say("ХЕРОБРИН: Держи себя в руках, Стив. Я буду за тобой следить.");
    } else if (seen === "rat") {
        MERCY_TURNS = 25;                       // крыса усложнила путь милосердия
        await say("ХЕРОБРИН: ...Снова.");
        await say("ХЕРОБРИН: В прошлый раз ты притворился святым и ударил в спину.");
        await say("ХЕРОБРИН: Такой как ты не должен ждать пощады. Путь к прощению стал вдвое длиннее.");
    } else {
        await say("ХЕРОБРИН: Итак, ты нажал «ДА».");
        await say("ХЕРОБРИН: Я — Стив. Твоё будущее.");
        await say("ХЕРОБРИН: Я пришёл из времени, где ты соединил миры... и они рухнули.");
        await say("ХЕРОБРИН: Ты — сильнейший в мультивселенной. И самое разрушительное существо.");
        await say("ХЕРОБРИН: Я не позволю этому случиться. Приготовься.");
    }
}

async function startBattle() {
    resetBattle();
    gameState.phase = "INTRO_DIALOGUE";     // стартовый монолог: кнопки игрока заблокированы
    G.busy = true;
    hideMenu();
    /* Игрок прокликивает/дочитывает вступление. Любая ошибка не должна
       оставлять игру в зависшем состоянии без монолога и без меню. */
    try { await playIntroDialogue(); }
    catch (err) { console.error("[script] intro error:", err); }
    /* Монолог дочитан — только теперь открываем ход игрока и 4 кнопки. */
    gameState.phase = "PLAYER_TURN";
    G.busy = false;
    showMenu();
    updateHUD();
}

/* =================================================================
   УПРАВЛЕНИЕ КЛАВИАТУРОЙ
   • Движение сердца во время атак: стрелки + WASD.
   • Кнопки: стрелки / WASD — выбор, Enter / Пробел / Z — нажать.
   • Z / Enter / Пробел также пропускают текст и подтверждают диалог.
   ================================================================= */
window.addEventListener("keydown", e => {
    /* Не перехватываем клавиши при вводе текста в полях (ник игрока). */
    const tag = e.target && e.target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    const k = e.key.toLowerCase();
    const isUI = k === "z" || k === "enter" || k === " ";
    const isNavL = k === "arrowleft" || k === "a" || k === "arrowup" || k === "w";
    const isNavR = k === "arrowright" || k === "d" || k === "arrowdown" || k === "s";

    /* 0) Прицеливание атаки: Enter / Пробел / Z — нанести удар */
    if (isUI && G.aimActive) {
        e.preventDefault();
        if (!e.repeat) fireAim();
        return;
    }

    /* 1) Диалог: пропуск печати или подтверждение реплики */
    if (isUI && (G.skipType || G.awaitConfirm)) {
        e.preventDefault();
        if (!e.repeat) confirm();
        return;
    }

    /* 2) Меню действий открыто (экран боя, игрок свободен) — кнопки */
    if (G.screen === "boss" && !G.busy && !G.attackActive && menuEl.offsetParent !== null) {
        if (isNavL) { e.preventDefault(); if (!e.repeat) uiStep(-1); return; }
        if (isNavR) { e.preventDefault(); if (!e.repeat) uiStep(1);  return; }
        if (isUI)   { e.preventDefault(); if (!e.repeat) uiPressFocused(); return; }
        return;
    }

    /* 2б) Инвентарь открыт — навигация стрелками/WASD и выбор предметов */
    if (G.screen === "items") {
        if (isNavL) { e.preventDefault(); if (!e.repeat) uiStep(-1); return; }
        if (isNavR) { e.preventDefault(); if (!e.repeat) uiStep(1);  return; }
        if (isUI)   { e.preventDefault(); if (!e.repeat) uiPressFocused(); return; }
        return;
    }

    /* 3) Остальные экраны: Enter / Пробел / Z «жмёт» активную кнопку */
    if (isUI) {
        e.preventDefault();
        if (e.repeat) return;
        if ($("gameover").classList.contains("active")) { $("retry").click(); return; }
        uiPressFocused();
        return;
    }

    /* 4) Движение сердца во время атак: стрелки + WASD */
    const dir = KEYMAP[k];
    if (dir) {
        keys[dir] = true;
        if (k.startsWith("arrow")) e.preventDefault();
    }
});
window.addEventListener("keyup", e => {
    const dir = KEYMAP[e.key.toLowerCase()];
    if (dir) keys[dir] = false;
});
window.addEventListener("blur", () => {
    keys.up = keys.down = keys.left = keys.right = false;
});
$("textbox").addEventListener("click", () => { if (G.aimActive) fireAim(); else confirm(); });

/* стартовая фокусировка (экран вступления) */
uiFocusApply();
