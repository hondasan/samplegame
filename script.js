// Canvas とゲームに必要な要素を取得
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const scoreLabel = document.getElementById('score');
const gameOverPanel = document.getElementById('gameOver');
const retryButton = document.getElementById('retryButton');

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

// キャンバス上の描画処理
function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    drawBackground();
    drawTerrain();
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
    draw();

    requestAnimationFrame(gameLoop);
}

// ゲームオーバー処理
function triggerGameOver() {
    if (isGameOver) return;
    isGameOver = true;
    gameOverPanel.classList.remove('hidden');
}

// ゲーム開始時の初期化処理
function resetGame() {
    isGameOver = false;
    gameOverPanel.classList.add('hidden');
    worldOffset = 0;
    score = 0;
    player.y = canvas.height - 120 - player.height;
    player.vy = 0;
    player.onGround = true;
    lastTime = null;
    resetTerrain();
    generateTerrain(canvas.width * 2);
    scoreLabel.textContent = 'Score: 0';
}

// 入力イベント
function handleKeyDown(e) {
    if (e.code === 'Space') {
        e.preventDefault();
        if (!spacePressed) {
            spacePressed = true;
            if (player.onGround && !isGameOver) {
                player.vy = jumpVelocity;
                player.onGround = false;
            }
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

retryButton.addEventListener('click', () => {
    resetGame();
});

// 初期化してゲームループを開始
resetGame();
requestAnimationFrame(gameLoop);
