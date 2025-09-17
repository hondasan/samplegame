// Canvas とゲームに必要な要素を取得
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const scoreLabel = document.getElementById('score');
const gameOverPanel = document.getElementById('gameOver');
const retryButton = document.getElementById('retryButton');
const versionLabel = document.getElementById('versionLabel');

const GAME_VERSION = 'v1.1.0'; // --- added for version display ---
if (versionLabel) {
    versionLabel.textContent = GAME_VERSION;
}

// プレイヤーとゲームの基本設定
const player = {
    x: 150,
    y: 0,
    width: 40,
    height: 40,
    vy: 0,
    onGround: false
};

const gravity = 1800;           // 重力加速度 (px/s^2)
const jumpVelocity = -750;      // ジャンプ初速度
const worldSpeed = 220;         // 背景スクロール速度
const segmentCleanupOffset = 600;   // 画面外のセグメントを捨てる範囲
const maxGroundHeight = 200;    // 地面の最大高さ
const minGroundHeight = 70;     // 地面の最小高さ

let lastTime = null;
let worldOffset = 0;
let score = 0;
let spacePressed = false;
let isGameOver = false;

// --- added for hazard management ---
let hazards = [];
let hazardTimer = 0;

// 地形データを保持する配列
let groundSegments = [];
let lastSegmentEnd = 0;

// 地形セグメントの初期化
function resetTerrain() {
    groundSegments = [];
    // スタート地点は長めの地面を用意
    const initialGround = {
        type: 'ground',
        start: -400,
        width: 1200,
        height: 120
    };
    groundSegments.push(initialGround);
    lastSegmentEnd = initialGround.start + initialGround.width;
}

// ランダムな数値を返すユーティリティ
function randRange(min, max) {
    return Math.random() * (max - min) + min;
}

// 次に必要な地形が生成されるように調整
function generateTerrain(targetX) {
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
        // ギャップを追加するかどうか
        if (Math.random() < 0.3) {
            const gapWidth = randRange(90, 180);
            groundSegments.push({
                type: 'gap',
                start: lastSegmentEnd,
                width: gapWidth
            });
            lastSegmentEnd += gapWidth;
        }

        // 次の地面セグメントを生成
        const groundWidth = randRange(160, 320);
        let newHeight = prevHeight + randRange(-70, 70);
        newHeight = Math.max(minGroundHeight, Math.min(maxGroundHeight, newHeight));

        groundSegments.push({
            type: 'ground',
            start: lastSegmentEnd,
            width: groundWidth,
            height: newHeight
        });
        lastSegmentEnd += groundWidth;
    }
}

// 指定したワールド座標にある地面の情報を取得
function getGroundInfo(worldX) {
    for (const segment of groundSegments) {
        if (worldX >= segment.start && worldX <= segment.start + segment.width) {
            return segment;
        }
    }
    return null;
}

function getGroundHeight(worldX) { // --- added for hazard placement ---
    const info = getGroundInfo(worldX);
    if (info && info.type === 'ground') {
        return info.height;
    }
    return 0;
}

// プレイヤーの位置と速度を更新
function updatePlayer(dt) {
    if (isGameOver) return;

    // 速度に重力を適用
    player.vy += gravity * dt;
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
        // 足場がない → 空中
        player.onGround = false;
    }

    // 画面外に落ちたらゲームオーバー
    if (player.y > canvas.height) {
        triggerGameOver();
    }
}

// 地形のスクロールやスコアを更新
function updateWorld(dt) {
    if (isGameOver) return;

    worldOffset += worldSpeed * dt;
    score = Math.floor(worldOffset);
    scoreLabel.textContent = `Score: ${score}`;

    // 必要な分だけ地形を生成
    generateTerrain(worldOffset + canvas.width * 2);

    // 画面外の不要なセグメントを削除
    while (groundSegments.length > 0) {
        const segment = groundSegments[0];
        if (segment.start + segment.width < worldOffset - segmentCleanupOffset) {
            groundSegments.shift();
        } else {
            break;
        }
    }
}

function spawnHazard(baseSpeed, difficultyProgress) { // --- added for hazard creation ---
    const spawnType = Math.random() < 0.55 ? 'enemy' : 'fireball';
    const spawnFromLeft = spawnType === 'fireball' && Math.random() < 0.35;
    const hazard = {
        type: spawnType,
        width: 36,
        height: 36,
        direction: spawnFromLeft ? 1 : -1,
        speed: baseSpeed + randRange(-20, 30)
    };

    if (spawnFromLeft) {
        hazard.x = worldOffset - randRange(220, 360);
        hazard.speed = Math.max(hazard.speed, worldSpeed + 60); // --- added for left spawn balance ---
    } else {
        hazard.x = worldOffset + canvas.width + randRange(120, 260);
    }

    if (spawnType === 'enemy') {
        hazard.width = 42;
        hazard.height = 42;
        const groundHeight = getGroundHeight(hazard.x + hazard.width / 2);
        const safeHeight = groundHeight > 0 ? groundHeight : 120;
        hazard.y = canvas.height - safeHeight - hazard.height;
    } else {
        hazard.width = 30;
        hazard.height = 30;
        hazard.baseY = canvas.height - randRange(140, 240);
        hazard.waveAmplitude = 20 + difficultyProgress * 18;
        hazard.waveSpeed = 2 + difficultyProgress * 2.5;
        hazard.phase = 0;
        hazard.y = hazard.baseY;
    }

    hazards.push(hazard);
}

function rectanglesOverlap(a, b) { // --- added for hazard collision ---
    return (
        a.x < b.x + b.width &&
        a.x + a.width > b.x &&
        a.y < b.y + b.height &&
        a.y + a.height > b.y
    );
}

function updateHazards(dt) { // --- added for hazard updates ---
    if (isGameOver) return;

    const difficultyProgress = Math.min(1, worldOffset / 5000);
    const intervalRange = 2.6 - difficultyProgress * 1.6;
    const spawnInterval = Math.max(0.7, intervalRange);
    const baseSpeed = 80 + difficultyProgress * 220;
    const maxHazards = Math.min(4, 1 + Math.floor(difficultyProgress * 4));

    hazardTimer -= dt;
    if (hazardTimer <= 0 && hazards.length < maxHazards) {
        spawnHazard(baseSpeed, difficultyProgress);
        hazardTimer = spawnInterval + randRange(0.25, 0.9);
    }

    const playerRect = {
        x: player.x + worldOffset,
        y: player.y,
        width: player.width,
        height: player.height
    };

    hazards = hazards.filter((hazard) => {
        if (hazard.type === 'fireball') {
            hazard.phase += dt;
            hazard.y = hazard.baseY + Math.sin(hazard.phase * hazard.waveSpeed) * hazard.waveAmplitude;
        }

        hazard.x += hazard.speed * hazard.direction * dt;

        if (rectanglesOverlap(playerRect, hazard)) {
            triggerGameOver();
        }

        const screenX = hazard.x - worldOffset;
        if (screenX + hazard.width < -220 || screenX > canvas.width + 220) {
            return false;
        }
        return true;
    });
}

// キャンバス上の描画処理
function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    drawBackground();
    drawTerrain();
    drawHazards();
    drawPlayer();
    drawForeground();
}

// 空や遠景の演出
function drawBackground() {
    ctx.fillStyle = '#bae6fd';
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

// 地面の描画
function drawTerrain() {
    ctx.fillStyle = '#1b4332';
    ctx.strokeStyle = '#40916c';
    ctx.lineWidth = 4;

    for (const segment of groundSegments) {
        const screenX = segment.start - worldOffset;
        if (screenX > canvas.width || screenX + segment.width < -200) {
            continue;
        }

        if (segment.type === 'ground') {
            const groundY = canvas.height - segment.height;
            ctx.fillStyle = '#2d6a4f';
            ctx.fillRect(screenX, groundY, segment.width, segment.height);

            // 地面の上面を描く
            ctx.beginPath();
            ctx.moveTo(screenX, groundY);
            ctx.lineTo(screenX + segment.width, groundY);
            ctx.stroke();
        }
    }
}

function drawHazards() { // --- added for hazard rendering ---
    for (const hazard of hazards) {
        const screenX = hazard.x - worldOffset;
        if (screenX + hazard.width < -200 || screenX > canvas.width + 200) {
            continue;
        }

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

// プレイヤー（自転車っぽい形）の描画
function drawPlayer() {
    const bikeX = player.x;
    const bikeY = player.y;

    // 車体
    ctx.fillStyle = '#ffb703';
    ctx.fillRect(bikeX + 8, bikeY + 10, 24, 12);

    ctx.fillStyle = '#fb8500';
    ctx.fillRect(bikeX + 14, bikeY - 2, 12, 18);

    // タイヤ
    ctx.fillStyle = '#023047';
    const wheelRadius = 12;
    drawWheel(bikeX + 10, bikeY + player.height - 4, wheelRadius);
    drawWheel(bikeX + player.width - 10, bikeY + player.height - 4, wheelRadius);

    // ライダー
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

// 前景の細かい演出
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

// ゲームループ本体
function gameLoop(timestamp) {
    if (!lastTime) lastTime = timestamp;
    const dt = Math.min((timestamp - lastTime) / 1000, 0.033);
    lastTime = timestamp;

    updateWorld(dt);
    updatePlayer(dt);
    updateHazards(dt);
    draw();

    requestAnimationFrame(gameLoop);
}

// ゲームオーバー処理
function triggerGameOver() {
    if (isGameOver) return;
    isGameOver = true;
    // hidden クラスを外してパネルとリトライボタンを表示する
    gameOverPanel.classList.remove('hidden');
    retryButton.style.display = 'inline-block'; // --- added for retry visibility ---
}

// ゲーム開始時の初期化処理
function resetGame() {
    isGameOver = false;
    // 再挑戦時はボタンを隠し、入力状態もリセットする
    gameOverPanel.classList.add('hidden');
    retryButton.style.display = 'none'; // --- added for retry visibility ---
    worldOffset = 0;
    score = 0;
    player.y = canvas.height - 120 - player.height;
    player.vy = 0;
    player.onGround = true;
    spacePressed = false;
    lastTime = null;
    hazards = []; // --- added for hazard reset ---
    hazardTimer = randRange(1.0, 1.8);
    resetTerrain();
    generateTerrain(canvas.width * 2);
    scoreLabel.textContent = 'Score: 0';
}

// 入力イベント
function attemptJump() { // --- added for mobile/touch jump ---
    if (player.onGround && !isGameOver) {
        player.vy = jumpVelocity;
        player.onGround = false;
    }
}

function handleKeyDown(e) {
    if (e.code === 'Space') {
        e.preventDefault();
        if (!spacePressed) {
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

canvas.addEventListener('touchstart', (e) => { // --- added for touch support ---
    e.preventDefault();
    attemptJump();
});

// ゲームオーバー後にリトライすると、初期状態から再開できる
retryButton.addEventListener('click', () => {
    resetGame();
});

// 初期化してゲームループを開始
resetGame();
requestAnimationFrame(gameLoop);
