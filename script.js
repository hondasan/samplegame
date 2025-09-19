// Canvas とゲームに必要な要素を取得
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const scoreLabel = document.getElementById('score');
const effectsLabel = document.getElementById('effects');
const hudMessage = document.getElementById('hudMessage');
const titleScreen = document.getElementById('titleScreen');
const startButton = document.getElementById('startButton');
const gameOverPanel = document.getElementById('gameOver');
const retryButton = document.getElementById('retryButton');
const saveScoreButton = document.getElementById('saveScoreButton');
const nameInput = document.getElementById('playerNameInput');
const finalScoreLabel = document.getElementById('finalScore');
const leaderboardBody = document.getElementById('leaderboardBody');
const clearLeaderboardButton = document.getElementById('clearLeaderboardButton');
const versionLabel = document.getElementById('versionLabel');

const GAME_VERSION = 'v1.4.1'; // --- bump version to v1.4.1 ---
if (versionLabel) {
    versionLabel.textContent = GAME_VERSION;
}

const GameState = {
    TITLE: 'title',
    PLAYING: 'playing',
    GAMEOVER: 'gameover'
};
let gameState = GameState.TITLE;

const baseSettings = { // --- base settings start ---
    gravity: 1800,
    jumpVelocity: -750,
    baseWorldSpeed: 220,
    baseMissileInterval: 0.9,
    missileSpeed: 640,
    maxMissiles: 40,
    messageDuration: 2.4
};
const DISTANCE_PER_PIXEL = 0.1; // --- convert scroll speed to meters (fix distance update) ---
const effectCaps = {
    multiShot: 3,
    missileIntervalMin: 0.25,
    speedMultiplierMax: 1.45,
    shieldMax: 2
};
// --- base settings end ---

const player = {
    x: 150,
    y: 0,
    width: 40,
    height: 40,
    vy: 0,
    onGround: false
};

let lastTime = null;
let worldOffset = 0;
let distance = 0; // --- track travelled meters (fix distance staying at 0) ---
let currentWorldSpeed = baseSettings.baseWorldSpeed;
let score = 0;
let spacePressed = false;
let hudMessageTimer = 0;

// --- terrain start ---
let groundSegments = [];
let lastSegmentEnd = 0;
const maxGroundHeight = 200;
const minGroundHeight = 70;
// --- terrain end ---

// --- hazards start ---
let hazards = [];
let hazardTimer = 0;
// --- hazards end ---

// --- items start ---
let items = [];
let itemSpawnTimer = 4;
// --- items end ---

// --- missiles start ---
let missiles = [];
let missileCooldownTimer = baseSettings.baseMissileInterval;
// --- missiles end ---

// --- effects start ---
const effectState = {
    missileEnabled: false,
    shieldCharges: 0,
    multiShot: 1,
    missileInterval: baseSettings.baseMissileInterval,
    speedMultiplier: 1
};
let activeEffects = [];
// --- effects end ---

// --- difficulty start ---
let difficultyLevel = 0;
let difficultyProgress = 0;
const MAX_DIFFICULTY = 7;
// --- difficulty end ---

// --- leaderboard start ---
const storage = (() => {
    try {
        const testKey = '__bike_test__';
        window.localStorage.setItem(testKey, '1');
        window.localStorage.removeItem(testKey);
        return window.localStorage;
    } catch (error) {
        console.warn('LocalStorage is not available.', error);
        return null;
    }
})();

class Leaderboard {
    constructor(key, maxEntries = 10) {
        this.key = key;
        this.maxEntries = maxEntries;
        this.cache = null;
    }

    loadTop(limit = this.maxEntries) {
        const entries = this._load();
        return entries.slice(0, limit);
    }

    addEntry(entry) {
        const entries = this._load();
        const safeEntry = {
            id: entry.id,
            name: entry.name,
            score: entry.score,
            date: entry.date
        };
        entries.push(safeEntry);
        entries.sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            return new Date(b.date).getTime() - new Date(a.date).getTime();
        });
        while (entries.length > this.maxEntries) {
            entries.pop();
        }
        return this._save(entries);
    }

    clearAll() {
        this.cache = [];
        if (!storage) return false;
        try {
            storage.removeItem(this.key);
            return true;
        } catch (error) {
            console.warn('Failed to clear leaderboard.', error);
            return false;
        }
    }

    _load() {
        if (this.cache) {
            return [...this.cache];
        }
        if (!storage) {
            this.cache = [];
            return [];
        }
        try {
            const raw = storage.getItem(this.key);
            if (!raw) {
                this.cache = [];
                return [];
            }
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) {
                this.cache = [];
                return [];
            }
            this.cache = parsed.map((entry) => ({
                id: entry.id,
                name: entry.name,
                score: entry.score,
                date: entry.date
            }));
            return [...this.cache];
        } catch (error) {
            console.warn('Failed to parse leaderboard data.', error);
            this.cache = [];
            return [];
        }
    }

    _save(entries) {
        this.cache = [...entries];
        if (!storage) return false;
        try {
            storage.setItem(this.key, JSON.stringify(entries));
            return true;
        } catch (error) {
            console.warn('Failed to save leaderboard data.', error);
            return false;
        }
    }
}

const leaderboard = new Leaderboard('bikeGame.leaderboard.v1', 10);
const LAST_NAME_KEY = 'bikeGame.playerName';
let latestEntryId = null;
let lastKnownName = storage ? storage.getItem(LAST_NAME_KEY) || '' : '';
// --- leaderboard end ---

function generateId() {
    return `id-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

// --- utility start ---
function randRange(min, max) {
    return Math.random() * (max - min) + min;
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function rectanglesOverlap(a, b) {
    return (
        a.x < b.x + b.width &&
        a.x + a.width > b.x &&
        a.y < b.y + b.height &&
        a.y + a.height > b.y
    );
}
// --- utility end ---

function updateScoreDisplay() {
    scoreLabel.textContent = `Score: ${score} m`;
}

function updateEffectsDisplay() {
    const segments = [];
    if (effectState.missileEnabled) {
        segments.push(`Msl x${effectState.multiShot}`);
        if (effectState.missileInterval < baseSettings.baseMissileInterval - 0.05) {
            segments.push('Rapid');
        }
    }
    if (effectState.shieldCharges > 0) {
        segments.push(`Shield x${effectState.shieldCharges}`);
    }
    if (effectState.speedMultiplier > 1.01) {
        segments.push('Speed');
    }
    effectsLabel.textContent = `Effects: ${segments.length > 0 ? segments.join(' / ') : 'None'}`;
}

function showHudMessage(message) {
    hudMessage.textContent = message;
    hudMessage.classList.remove('hidden');
    hudMessageTimer = baseSettings.messageDuration;
}

function updateHudMessage(dt) {
    if (hudMessageTimer > 0) {
        hudMessageTimer -= dt;
        if (hudMessageTimer <= 0) {
            hudMessageTimer = 0;
            hudMessage.classList.add('hidden');
        }
    }
}

function recalcTimedEffects() {
    let multiBonus = 0;
    let rapidBonus = 0;
    let speedBonus = 0;
    activeEffects.forEach((effect) => {
        if (effect.remaining <= 0) return;
        if (effect.type === 'multi') multiBonus += effect.value;
        if (effect.type === 'rapid') rapidBonus += effect.value;
        if (effect.type === 'speed') speedBonus += effect.value;
    });
    effectState.multiShot = clamp(1 + multiBonus, 1, effectCaps.multiShot);
    effectState.missileInterval = clamp(baseSettings.baseMissileInterval + rapidBonus, effectCaps.missileIntervalMin, baseSettings.baseMissileInterval);
    effectState.speedMultiplier = clamp(1 + speedBonus, 1, effectCaps.speedMultiplierMax);
    updateEffectsDisplay();
}

function addTimedEffect(type, value, duration) {
    activeEffects.push({ type, value, remaining: duration });
    recalcTimedEffects();
}

function updateActiveEffects(dt) {
    if (gameState !== GameState.PLAYING) return;
    if (activeEffects.length === 0) return;
    let changed = false;
    for (const effect of activeEffects) {
        effect.remaining -= dt;
        if (effect.remaining <= 0) {
            changed = true;
        }
    }
    if (changed) {
        activeEffects = activeEffects.filter((effect) => effect.remaining > 0);
        recalcTimedEffects();
    }
}

// --- terrain generation start ---
function resetTerrain() {
    groundSegments = [];
    const initialGround = {
        type: 'ground',
        start: -400,
        width: 1200,
        height: 120
    };
    groundSegments.push(initialGround);
    lastSegmentEnd = initialGround.start + initialGround.width;
}

function getTerrainConfig() {
    const progress = difficultyProgress;
    const gapChance = clamp(0.22 + progress * 0.3, 0.22, 0.55);
    const gapMin = 90 + progress * 50;
    const gapMax = 180 + progress * 110;
    const groundMin = clamp(160 - progress * 40, 110, 200);
    const groundMax = clamp(320 - progress * 90, 180, 320);
    const heightVariance = 60 + progress * 40;
    return {
        gapChance,
        gapMin,
        gapMax,
        groundMin,
        groundMax,
        heightVariance
    };
}

function generateTerrain(targetX) {
    const config = getTerrainConfig();
    const lastHeight = () => {
        for (let i = groundSegments.length - 1; i >= 0; i -= 1) {
            if (groundSegments[i].type === 'ground') {
                return groundSegments[i].height;
            }
        }
        return 120;
    };

    while (lastSegmentEnd < targetX) {
        const prevHeight = lastHeight();
        if (Math.random() < config.gapChance) {
            const gapWidth = randRange(config.gapMin, config.gapMax);
            groundSegments.push({
                type: 'gap',
                start: lastSegmentEnd,
                width: gapWidth
            });
            lastSegmentEnd += gapWidth;
        }

        const groundWidth = randRange(config.groundMin, config.groundMax);
        let newHeight = prevHeight + randRange(-config.heightVariance, config.heightVariance);
        newHeight = clamp(newHeight, minGroundHeight, maxGroundHeight);

        groundSegments.push({
            type: 'ground',
            start: lastSegmentEnd,
            width: groundWidth,
            height: newHeight
        });
        lastSegmentEnd += groundWidth;
    }
}

function getGroundInfo(worldX) {
    for (const segment of groundSegments) {
        if (worldX >= segment.start && worldX <= segment.start + segment.width) {
            return segment;
        }
    }
    return null;
}

function getGroundHeight(worldX) {
    const info = getGroundInfo(worldX);
    if (info && info.type === 'ground') {
        return info.height;
    }
    return 0;
}
// --- terrain generation end ---

// --- difficulty update start ---
function updateDifficulty() {
    difficultyLevel = clamp(Math.floor(worldOffset / 1000), 0, MAX_DIFFICULTY);
    difficultyProgress = clamp(worldOffset / 8000, 0, 1);
}

function getHazardParameters() {
    const interval = clamp(2.2 - difficultyProgress * 1.6, 0.7, 2.2);
    const baseSpeed = 140 + difficultyProgress * 260;
    const maxHazards = clamp(2 + Math.floor(difficultyProgress * 5), 2, 6);
    return { interval, baseSpeed, maxHazards };
}

function getItemInterval() {
    return clamp(4.5 - difficultyProgress * 2.2, 1.8, 4.5);
}

function computeWorldSpeed() {
    const difficultyBoost = difficultyLevel * 18;
    return (baseSettings.baseWorldSpeed + difficultyBoost) * effectState.speedMultiplier;
}
// --- difficulty update end ---

// --- items start ---
const itemDefinitions = {
    missile: {
        id: 'missile',
        label: 'Missile Core',
        color: '#3b82f6',
        apply() {
            if (!effectState.missileEnabled) {
                effectState.missileEnabled = true;
                showHudMessage('Missile Core Online!');
            } else {
                addTimedEffect('rapid', -0.08, 8);
                showHudMessage('Auto Missiles Boost!');
            }
            updateEffectsDisplay();
        }
    },
    multi: {
        id: 'multi',
        label: 'Multi Shot',
        color: '#f97316',
        apply() {
            addTimedEffect('multi', 1, 12);
            showHudMessage('Multi Shot Up!');
        }
    },
    rapid: {
        id: 'rapid',
        label: 'Rapid Fire',
        color: '#ec4899',
        apply() {
            addTimedEffect('rapid', -0.12, 10);
            showHudMessage('Rapid Fire!');
        }
    },
    shield: {
        id: 'shield',
        label: 'Shield',
        color: '#22d3ee',
        apply() {
            effectState.shieldCharges = clamp(effectState.shieldCharges + 1, 0, effectCaps.shieldMax);
            showHudMessage('Shield +1');
            updateEffectsDisplay();
        }
    },
    speed: {
        id: 'speed',
        label: 'Speed Up',
        color: '#a3e635',
        apply() {
            addTimedEffect('speed', 0.18, 6);
            showHudMessage('Speed Boost!');
        }
    }
};

function chooseItemDefinition() {
    const available = Object.values(itemDefinitions).filter((item) => item.id !== 'missile' || !effectState.missileEnabled);
    const pool = available.length > 0 ? available : Object.values(itemDefinitions);
    const index = Math.floor(Math.random() * pool.length);
    return pool[index];
}

function spawnItem() {
    const safeSegments = groundSegments.filter((segment) => {
        if (segment.type !== 'ground') return false;
        const screenStart = segment.start - worldOffset;
        const screenEnd = screenStart + segment.width;
        return screenEnd > 120 && screenStart < canvas.width * 1.3; // --- widen spawn window so items actually appear ---
    });
    if (safeSegments.length === 0) return;

    const segment = safeSegments[Math.floor(Math.random() * safeSegments.length)];
    const groundY = canvas.height - segment.height;
    const spawnX = clamp(randRange(segment.start + 30, segment.start + segment.width - 30), segment.start + 30, segment.start + segment.width - 30);
    const definition = chooseItemDefinition();
    const item = {
        id: generateId(),
        type: definition.id,
        label: definition.label,
        color: definition.color,
        x: spawnX,
        baseY: groundY - 36,
        y: groundY - 36,
        width: 28,
        height: 28,
        phase: Math.random() * Math.PI * 2
    };
    items.push(item);
}

function updateItems(dt) {
    if (gameState !== GameState.PLAYING) return;
    itemSpawnTimer -= dt;
    if (itemSpawnTimer <= 0 && items.length < 3) {
        spawnItem();
        itemSpawnTimer = getItemInterval() + randRange(1.2, 2.4);
    }

    const playerRect = {
        x: player.x + worldOffset,
        y: player.y,
        width: player.width,
        height: player.height
    };

    items = items.filter((item) => {
        item.phase += dt * 2.2;
        item.y = item.baseY + Math.sin(item.phase) * 6;
        const screenX = item.x - worldOffset;
        if (screenX + item.width < -80) {
            return false;
        }
        if (rectanglesOverlap(playerRect, item)) {
            const definition = itemDefinitions[item.type];
            if (definition) {
                definition.apply();
            }
            return false;
        }
        return screenX < canvas.width + 80;
    });
}
// --- items end ---

// --- missiles start ---
function fireMissiles() {
    missileCooldownTimer = effectState.missileInterval;
    const shots = Math.max(1, Math.floor(effectState.multiShot));
    const spread = 14;
    for (let i = 0; i < shots; i += 1) {
        const offset = (i - (shots - 1) / 2) * spread;
        missiles.push({
            x: player.x + worldOffset + player.width,
            y: player.y + player.height / 2 + offset,
            width: 18,
            height: 6,
            speed: baseSettings.missileSpeed,
            life: 0
        });
    }
    if (missiles.length > baseSettings.maxMissiles) {
        missiles.splice(0, missiles.length - baseSettings.maxMissiles);
    }
}

function updateMissiles(dt) {
    if (gameState !== GameState.PLAYING) return;
    if (!effectState.missileEnabled) return;

    missileCooldownTimer -= dt;
    if (missileCooldownTimer <= 0) {
        fireMissiles();
    }

    missiles = missiles.filter((missile) => {
        missile.x += missile.speed * dt;
        missile.life += dt;
        const missileRect = {
            x: missile.x,
            y: missile.y - missile.height / 2,
            width: missile.width,
            height: missile.height
        };

        for (let i = hazards.length - 1; i >= 0; i -= 1) {
            const hazard = hazards[i];
            const hazardRect = {
                x: hazard.x,
                y: hazard.y,
                width: hazard.width,
                height: hazard.height
            };
            if (rectanglesOverlap(missileRect, hazardRect)) {
                hazards.splice(i, 1);
                return false;
            }
        }

        if (missile.x - worldOffset > canvas.width + 120) {
            return false;
        }
        return missile.life < 5;
    });
}
// --- missiles end ---

// --- hazards start ---
function spawnHazard(params) {
    const spawnType = Math.random() < 0.6 ? 'enemy' : 'fireball';
    const hazard = {
        type: spawnType,
        width: 36,
        height: 36,
        direction: -1,
        speed: params.baseSpeed + randRange(-20, 40)
    };

    if (spawnType === 'enemy') {
        hazard.width = 42;
        hazard.height = 42;
        hazard.x = worldOffset + canvas.width + randRange(160, 320);
        const groundHeight = getGroundHeight(hazard.x + hazard.width / 2);
        const safeHeight = groundHeight > 0 ? groundHeight : 120;
        hazard.y = canvas.height - safeHeight - hazard.height;
    } else {
        hazard.width = 32;
        hazard.height = 32;
        const spawnFromLeft = Math.random() < clamp(difficultyProgress, 0.2, 0.5);
        hazard.direction = spawnFromLeft ? 1 : -1;
        hazard.speed = clamp(hazard.speed, 160, params.baseSpeed + 120);
        if (spawnFromLeft) {
            hazard.x = worldOffset - randRange(260, 360);
        } else {
            hazard.x = worldOffset + canvas.width + randRange(140, 280);
        }
        hazard.baseY = canvas.height - randRange(150, 240);
        hazard.waveAmplitude = 22 + difficultyProgress * 22;
        hazard.waveSpeed = 2 + difficultyProgress * 2.6;
        hazard.phase = Math.random() * Math.PI * 2;
        hazard.y = hazard.baseY;
    }

    if (hazard.direction === 1 && hazard.x + hazard.width > player.x + worldOffset - 140) {
        hazard.x = player.x + worldOffset - 200 - hazard.width;
    }

    hazards.push(hazard);
}

function updateHazards(dt) {
    if (gameState !== GameState.PLAYING) return;

    const params = getHazardParameters();
    hazardTimer -= dt;
    if (hazardTimer <= 0 && hazards.length < params.maxHazards) {
        spawnHazard(params);
        hazardTimer = params.interval + randRange(0.2, 0.9);
    }

    const playerRect = {
        x: player.x + worldOffset,
        y: player.y,
        width: player.width,
        height: player.height
    };

    hazards = hazards.filter((hazard) => {
        if (hazard.type === 'fireball') {
            hazard.phase += dt * hazard.waveSpeed;
            hazard.y = hazard.baseY + Math.sin(hazard.phase) * hazard.waveAmplitude;
        }

        hazard.x += hazard.speed * hazard.direction * dt;

        if (rectanglesOverlap(playerRect, hazard)) {
            if (effectState.shieldCharges > 0) {
                effectState.shieldCharges -= 1;
                updateEffectsDisplay();
                showHudMessage('Shield Protected!');
                return false;
            }
            triggerGameOver();
            return false;
        }

        const screenX = hazard.x - worldOffset;
        return !(screenX + hazard.width < -260 || screenX > canvas.width + 260);
    });
}
// --- hazards end ---

// --- player update start ---
function updatePlayer(dt) {
    if (gameState !== GameState.PLAYING) return;

    player.vy += baseSettings.gravity * dt;
    player.y += player.vy * dt;

    const playerWorldX = player.x + worldOffset + player.width / 2;
    const groundInfo = getGroundInfo(playerWorldX);
    if (groundInfo && groundInfo.type === 'ground') {
        const groundY = canvas.height - groundInfo.height;
        if (player.y + player.height >= groundY) {
            player.y = groundY - player.height;
            player.vy = 0;
            player.onGround = true;
        } else {
            player.onGround = false;
        }
    } else {
        player.onGround = false;
    }

    if (player.y > canvas.height) {
        triggerGameOver();
    }
}
// --- player update end ---

// --- world update start ---
function updateWorld(dt) {
    if (gameState !== GameState.PLAYING) return;

    currentWorldSpeed = computeWorldSpeed();
    worldOffset += currentWorldSpeed * dt;
    distance += currentWorldSpeed * dt * DISTANCE_PER_PIXEL; // --- fix distance update (was stuck at 0) ---
    distance = Math.max(0, distance);
    score = Math.floor(distance);
    updateScoreDisplay();

    updateDifficulty();

    generateTerrain(worldOffset + canvas.width * 2);
    while (groundSegments.length > 0) {
        const segment = groundSegments[0];
        if (segment.start + segment.width < worldOffset - 600) {
            groundSegments.shift();
        } else {
            break;
        }
    }
}
// --- world update end ---

// --- drawing start ---
function drawBackground() {
    ctx.fillStyle = '#bae6fd';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = '#8ecae6';
    ctx.fillRect(0, canvas.height - 80, canvas.width, 80);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 2;
    const parallax = (worldOffset * 0.2) % 60;
    for (let x = -parallax; x < canvas.width; x += 60) {
        ctx.beginPath();
        ctx.moveTo(x, canvas.height - 80);
        ctx.lineTo(x + 20, canvas.height - 120);
        ctx.lineTo(x + 40, canvas.height - 80);
        ctx.stroke();
    }
}

function drawTerrain() {
    ctx.fillStyle = '#2d6a4f';
    ctx.strokeStyle = '#40916c';
    ctx.lineWidth = 4;

    for (const segment of groundSegments) {
        if (segment.type !== 'ground') continue;
        const screenX = segment.start - worldOffset;
        if (screenX > canvas.width || screenX + segment.width < -200) continue;
        const groundY = canvas.height - segment.height;
        ctx.fillStyle = '#2d6a4f';
        ctx.fillRect(screenX, groundY, segment.width, segment.height);
        ctx.beginPath();
        ctx.moveTo(screenX, groundY);
        ctx.lineTo(screenX + segment.width, groundY);
        ctx.stroke();
    }
}

function drawItems() {
    for (const item of items) {
        const screenX = item.x - worldOffset;
        if (screenX + item.width < -80 || screenX > canvas.width + 80) continue;
        ctx.fillStyle = item.color;
        ctx.globalAlpha = 0.92;
        ctx.fillRect(screenX, item.y, item.width, item.height);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = 'rgba(255,255,255,0.65)';
        ctx.strokeRect(screenX, item.y, item.width, item.height);
        ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
        ctx.font = '12px sans-serif';
        ctx.fillText(item.label.split(' ')[0], screenX + 4, item.y + item.height / 2 + 4);
    }
}

function drawHazards() {
    for (const hazard of hazards) {
        const screenX = hazard.x - worldOffset;
        if (screenX + hazard.width < -200 || screenX > canvas.width + 200) continue;
        if (hazard.type === 'enemy') {
            ctx.fillStyle = '#ef233c';
            ctx.fillRect(screenX, hazard.y, hazard.width, hazard.height);
            ctx.fillStyle = '#ffd166';
            ctx.fillRect(screenX + 6, hazard.y + 6, hazard.width - 12, hazard.height - 12);
            ctx.fillStyle = '#1d3557';
            ctx.fillRect(screenX + hazard.width * 0.2, hazard.y + hazard.height - 8, hazard.width * 0.6, 6);
        } else {
            const centerX = screenX + hazard.width / 2;
            const centerY = hazard.y + hazard.height / 2;
            const gradient = ctx.createRadialGradient(centerX, centerY, 4, centerX, centerY, hazard.width / 1.2);
            gradient.addColorStop(0, '#ffe066');
            gradient.addColorStop(0.5, '#ff922b');
            gradient.addColorStop(1, '#d00000');
            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.arc(centerX, centerY, hazard.width / 2, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(centerX, centerY, hazard.width / 2, 0, Math.PI * 2);
            ctx.stroke();
        }
    }
}

function drawMissiles() {
    ctx.fillStyle = '#38bdf8';
    for (const missile of missiles) {
        const screenX = missile.x - worldOffset;
        if (screenX > canvas.width + 120) continue;
        ctx.fillRect(screenX, missile.y - missile.height / 2, missile.width, missile.height);
        ctx.fillStyle = '#f1f5f9';
        ctx.fillRect(screenX + missile.width - 6, missile.y - missile.height / 2 + 2, 4, missile.height - 4);
        ctx.fillStyle = '#38bdf8';
    }
}

function drawPlayer() {
    const bikeX = player.x;
    const bikeY = player.y;

    ctx.fillStyle = '#ffb703';
    ctx.fillRect(bikeX + 8, bikeY + 10, 24, 12);
    ctx.fillStyle = '#fb8500';
    ctx.fillRect(bikeX + 14, bikeY - 2, 12, 18);

    ctx.fillStyle = '#023047';
    const wheelRadius = 12;
    drawWheel(bikeX + 10, bikeY + player.height - 4, wheelRadius);
    drawWheel(bikeX + player.width - 10, bikeY + player.height - 4, wheelRadius);

    ctx.fillStyle = '#ff006e';
    ctx.fillRect(bikeX + 16, bikeY - 12, 12, 12);
    ctx.beginPath();
    ctx.arc(bikeX + 22, bikeY - 18, 8, 0, Math.PI * 2);
    ctx.fillStyle = '#f7ede2';
    ctx.fill();
}

function drawWheel(cx, cy, r) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#8ecae6';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.6, 0, Math.PI * 2);
    ctx.stroke();
}

function drawForeground() {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.lineWidth = 1;
    const pattern = (worldOffset * 0.4) % 20;
    for (let x = -pattern; x < canvas.width; x += 20) {
        ctx.beginPath();
        ctx.moveTo(x, canvas.height - 20);
        ctx.lineTo(x + 10, canvas.height - 10);
        ctx.stroke();
    }
}

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawBackground();
    drawTerrain();
    drawItems();
    drawHazards();
    drawMissiles();
    drawPlayer();
    drawForeground();
}
// --- drawing end ---

// --- leaderboard ui start ---
function updateLeaderboardDisplay(highlightId = latestEntryId) {
    if (!leaderboardBody) return;
    const entries = leaderboard.loadTop(10);
    leaderboardBody.innerHTML = '';
    if (entries.length === 0) {
        const row = document.createElement('tr');
        const cell = document.createElement('td');
        cell.colSpan = 4;
        cell.textContent = '記録がありません';
        cell.className = 'empty';
        row.appendChild(cell);
        leaderboardBody.appendChild(row);
        return;
    }

    entries.forEach((entry, index) => {
        const row = document.createElement('tr');
        if (highlightId && entry.id === highlightId) {
            row.classList.add('highlight');
        }
        const rankCell = document.createElement('td');
        rankCell.textContent = index + 1;
        const nameCell = document.createElement('td');
        nameCell.textContent = entry.name || 'PLAYER';
        const scoreCell = document.createElement('td');
        scoreCell.textContent = entry.score;
        const dateCell = document.createElement('td');
        const date = new Date(entry.date);
        dateCell.textContent = Number.isNaN(date.getTime()) ? entry.date : date.toLocaleString('ja-JP');
        row.append(rankCell, nameCell, scoreCell, dateCell);
        leaderboardBody.appendChild(row);
    });
}
// --- leaderboard ui end ---

// --- game state start ---
let hasSavedScore = false;

function prepareNewRun() {
    worldOffset = 0;
    distance = 0; // --- reset tracked distance only when starting a new run ---
    spacePressed = false;
    score = 0;
    lastTime = null;
    player.y = canvas.height - 120 - player.height;
    player.vy = 0;
    player.onGround = true;
    hazards = [];
    items = [];
    missiles = [];
    activeEffects = [];
    effectState.missileEnabled = false;
    effectState.shieldCharges = 0;
    recalcTimedEffects();
    difficultyLevel = 0;
    difficultyProgress = 0;
    currentWorldSpeed = baseSettings.baseWorldSpeed;
    hazardTimer = randRange(1.0, 1.8);
    missileCooldownTimer = baseSettings.baseMissileInterval;
    itemSpawnTimer = getItemInterval() + randRange(0.5, 1.5);
    hudMessageTimer = 0;
    hudMessage.classList.add('hidden');
    gameOverPanel.classList.add('hidden');
    retryButton.style.display = 'none';
    hasSavedScore = false;
    if (saveScoreButton) {
        saveScoreButton.disabled = false;
    }
    if (nameInput) {
        nameInput.value = lastKnownName || '';
    }
    resetTerrain();
    generateTerrain(canvas.width * 2);
    updateScoreDisplay();
    updateEffectsDisplay();
}

function beginRun() {
    prepareNewRun();
    gameState = GameState.PLAYING;
}

function triggerGameOver() {
    if (gameState === GameState.GAMEOVER) return;
    gameState = GameState.GAMEOVER;
    gameOverPanel.classList.remove('hidden');
    retryButton.style.display = 'inline-block';
    score = Math.floor(distance); // --- lock in the travelled distance for results ---
    finalScoreLabel.textContent = score;
    hasSavedScore = false;
    if (saveScoreButton) {
        saveScoreButton.disabled = false;
    }
    if (nameInput) {
        nameInput.value = lastKnownName || '';
    }
}
// --- game state end ---

// --- input start ---
function attemptJump() {
    if (gameState !== GameState.PLAYING) return;
    if (player.onGround) {
        player.vy = baseSettings.jumpVelocity;
        player.onGround = false;
    }
}

function handleKeyDown(e) {
    if (e.code === 'Space') {
        e.preventDefault();
        if (gameState === GameState.TITLE) {
            titleScreen.classList.add('hidden');
            beginRun();
            return;
        }
        if (gameState === GameState.PLAYING && !spacePressed) {
            spacePressed = true;
            attemptJump();
        }
    }
}

function handleKeyUp(e) {
    if (e.code === 'Space') {
        spacePressed = false;
    }
}

document.addEventListener('keydown', handleKeyDown);
document.addEventListener('keyup', handleKeyUp);

canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (gameState === GameState.TITLE) {
        titleScreen.classList.add('hidden');
        beginRun();
        return;
    }
    attemptJump();
});
// --- input end ---

// --- event bindings start ---
if (startButton) {
    startButton.addEventListener('click', () => {
        titleScreen.classList.add('hidden');
        beginRun();
    });
}

retryButton.addEventListener('click', () => {
    titleScreen.classList.add('hidden');
    beginRun();
});

if (saveScoreButton) {
    saveScoreButton.addEventListener('click', () => {
        if (gameState !== GameState.GAMEOVER || hasSavedScore) return;
        const name = (nameInput?.value || '').trim() || 'PLAYER';
        const finalScoreValue = Math.floor(distance); // --- ensure saved score reflects actual distance ---
        score = finalScoreValue;
        finalScoreLabel.textContent = finalScoreValue;
        const entry = {
            id: generateId(),
            name,
            score: finalScoreValue,
            date: new Date().toISOString()
        };
        const success = leaderboard.addEntry(entry);
        if (success) {
            hasSavedScore = true;
            latestEntryId = entry.id;
            if (saveScoreButton) saveScoreButton.disabled = true;
            if (storage) storage.setItem(LAST_NAME_KEY, name);
            lastKnownName = name;
            updateLeaderboardDisplay(latestEntryId);
            showHudMessage('スコアを保存しました');
        } else {
            showHudMessage('保存に失敗しました');
        }
    });
}

if (clearLeaderboardButton) {
    clearLeaderboardButton.addEventListener('click', () => {
        if (confirm('ランキングを全て削除しますか？')) {
            const cleared = leaderboard.clearAll();
            if (cleared) {
                latestEntryId = null;
                updateLeaderboardDisplay();
                showHudMessage('ランキングをリセットしました');
            } else {
                showHudMessage('リセットに失敗しました');
            }
        }
    });
}
// --- event bindings end ---

// --- game loop start ---
function gameLoop(timestamp) {
    if (!lastTime) lastTime = timestamp;
    const dt = Math.min((timestamp - lastTime) / 1000, 0.033);
    lastTime = timestamp;

    updateWorld(dt);
    updatePlayer(dt);
    updateActiveEffects(dt);
    updateItems(dt);
    updateHazards(dt);
    updateMissiles(dt);
    updateHudMessage(dt);
    draw();

    requestAnimationFrame(gameLoop);
}
// --- game loop end ---

// --- initialization start ---
updateLeaderboardDisplay();
prepareNewRun();
requestAnimationFrame(gameLoop);
// --- initialization end ---
