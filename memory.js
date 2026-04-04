(function() {
    'use strict';

    let sounds = [];
    let memoryActive = false;
    let cards = [];
    let flippedCards = [];
    let matchedCount = 0;
    let totalPairs = 0;
    let locked = false;
    let playerCount = 1;
    let currentPlayer = 1;
    let scores = [0, 0];

    const GRID_CONFIG = {
        1: { cols: 4, rows: 3, pairs: 6 },
        2: { cols: 4, rows: 4, pairs: 8 },
        3: { cols: 6, rows: 5, pairs: 15 },
    };
    const MISMATCH_DISPLAY_TIME = 2000;

    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
                     (navigator.maxTouchPoints && navigator.maxTouchPoints > 2);

    let escapeHeldStart = null;
    const ESCAPE_HOLD_TIME = 1500;

    async function loadSounds() {
        try {
            const response = await fetch('toddler_sounds.json');
            const data = await response.json();
            sounds = data.sounds;
        } catch (error) {
            console.error('Failed to load sounds:', error);
        }
    }

    function shuffle(arr) {
        const a = arr.slice();
        for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
    }

    function getDifficulty() {
        const slider = document.getElementById('difficulty-slider');
        return slider ? parseInt(slider.value) : 2;
    }

    function getPlayerCount() {
        const sel = document.querySelector('.player-btn.selected');
        return sel ? parseInt(sel.dataset.players) : 1;
    }

    function speakText(text) {
        const utter = new SpeechSynthesisUtterance(text);
        utter.rate = 1.0;
        utter.pitch = 1.3;
        utter.volume = 1;
        const voices = speechSynthesis.getVoices();
        const preferred = voices.find(v => v.lang.startsWith('en') && v.name.includes('Female')) ||
                          voices.find(v => v.lang.startsWith('en'));
        if (preferred) utter.voice = preferred;
        speechSynthesis.speak(utter);
    }

    function spawnConfetti(container) {
        const target = container || document.getElementById('memory-screen');
        // Use a temporary container
        const cont = document.createElement('div');
        cont.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;pointer-events:none;z-index:2000;overflow:hidden;';
        target.appendChild(cont);
        const colors = ['#ff6b9d', '#ffd93d', '#6bcb77', '#4d96ff', '#ff6b6b', '#c084fc', '#fb923c'];
        for (let i = 0; i < 50; i++) {
            const piece = document.createElement('div');
            piece.className = 'confetti-piece';
            piece.style.left = Math.random() * 100 + 'vw';
            piece.style.background = colors[Math.floor(Math.random() * colors.length)];
            piece.style.width = (6 + Math.random() * 8) + 'px';
            piece.style.height = (6 + Math.random() * 8) + 'px';
            piece.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
            piece.style.animationDuration = (1.5 + Math.random() * 2) + 's';
            piece.style.animationDelay = (Math.random() * 0.5) + 's';
            cont.appendChild(piece);
        }
        setTimeout(() => { if (cont.parentNode) cont.remove(); }, 4000);
    }

    function playCheer() {
        const cheerFiles = ['sounds/party', 'sounds/clapping'];
        for (const file of cheerFiles) {
            const audio = new Audio(`${file}.mp3`);
            audio.volume = 0.5;
            audio.play().catch(() => {});
        }
    }

    function updatePlayerDisplay() {
        const p1 = document.getElementById('memory-p1');
        const p2 = document.getElementById('memory-p2');
        p1.classList.toggle('active', currentPlayer === 1);
        if (playerCount === 2) {
            p2.style.display = '';
            p2.classList.toggle('active', currentPlayer === 2);
        } else {
            p2.style.display = 'none';
        }
    }

    function updateScoreDisplay() {
        document.querySelector('#memory-p1 .player-score').textContent = scores[0];
        document.querySelector('#memory-p2 .player-score').textContent = scores[1];
    }

    function buildGame() {
        const diff = Math.min(getDifficulty(), 3); // expert maps to hard for memory
        const config = GRID_CONFIG[diff];
        totalPairs = config.pairs;
        matchedCount = 0;
        currentPlayer = 1;
        scores = [0, 0];
        locked = false;
        flippedCards = [];

        playerCount = getPlayerCount();

        // Pick random sounds for pairs
        const picked = shuffle(sounds).slice(0, config.pairs);

        // Create pairs
        let cardData = [];
        picked.forEach((s, i) => {
            cardData.push({ pairIndex: i, emoji: s.emoji, name: s.name, filename: s.filename });
            cardData.push({ pairIndex: i, emoji: s.emoji, name: s.name, filename: s.filename });
        });
        cards = shuffle(cardData);

        const grid = document.getElementById('memory-grid');
        grid.innerHTML = '';
        grid.className = '';
        grid.style.gridTemplateColumns = `repeat(${config.cols}, 1fr)`;
        grid.style.gridTemplateRows = `repeat(${config.rows}, 1fr)`;

        if (config.pairs >= 15) {
            grid.classList.add('grid-small');
        }

        cards.forEach((card, idx) => {
            const el = document.createElement('div');
            el.className = 'memory-card';
            el.dataset.index = idx;
            el.dataset.pairIndex = card.pairIndex;
            el.innerHTML =
                '<div class="card-inner">' +
                    '<div class="card-front">?</div>' +
                    '<div class="card-back"><span class="emoji">' + card.emoji + '</span></div>' +
                '</div>';

            el.addEventListener('touchstart', (e) => {
                e.preventDefault();
                handleCardTap(el, idx);
            }, { passive: false });
            el.addEventListener('click', (e) => {
                e.preventDefault();
                handleCardTap(el, idx);
            });
            grid.appendChild(el);
        });

        updatePlayerDisplay();
        updateScoreDisplay();
    }

    function handleCardTap(el, idx) {
        if (locked) return;
        if (el.classList.contains('flipped')) return;
        if (el.classList.contains('matched')) return;

        el.classList.add('flipped');
        flippedCards.push({ el, idx, card: cards[idx] });

        if (flippedCards.length === 2) {
            locked = true;
            const [a, b] = flippedCards;

            if (a.card.pairIndex === b.card.pairIndex) {
                // Match!
                a.el.classList.add('matched');
                b.el.classList.add('matched');
                matchedCount++;
                scores[currentPlayer - 1]++;
                updateScoreDisplay();

                speakText(a.card.name);

                // Play the object sound
                const audio = new Audio(`${a.card.filename}.mp3`);
                audio.volume = 0.6;
                audio.play().catch(() => {});

                flippedCards = [];
                locked = false;

                if (matchedCount === totalPairs) {
                    setTimeout(celebrateWin, 1000);
                }
            } else {
                // No match — keep visible, then flip back and switch player
                setTimeout(() => {
                    a.el.classList.remove('flipped');
                    b.el.classList.remove('flipped');
                    flippedCards = [];

                    if (playerCount === 2) {
                        currentPlayer = currentPlayer === 1 ? 2 : 1;
                        updatePlayerDisplay();
                    }
                    locked = false;
                }, MISMATCH_DISPLAY_TIME);
            }
        }
    }

    function celebrateWin() {
        spawnConfetti();
        playCheer();

        let msg;
        if (playerCount === 1) {
            msg = 'You win!';
        } else if (scores[0] > scores[1]) {
            msg = 'Player 1 wins!';
        } else if (scores[1] > scores[0]) {
            msg = 'Player 2 wins!';
        } else {
            msg = "It's a tie!";
        }
        speakText(msg);

        setTimeout(() => {
            spawnConfetti();
            speakText('Great job!');
        }, 1500);

        setTimeout(() => {
            if (isMobile) exitFullscreen();
            stopMemory();
        }, 4500);
    }

    async function enterFullscreen() {
        const elem = document.documentElement;
        try {
            if (elem.requestFullscreen) await elem.requestFullscreen();
            else if (elem.webkitRequestFullscreen) await elem.webkitRequestFullscreen();
            return true;
        } catch (error) { return false; }
    }

    function exitFullscreen() {
        if (document.exitFullscreen) document.exitFullscreen();
        else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
    }

    async function startMemory() {
        if (isMobile) await enterFullscreen();

        document.getElementById('start-screen').style.display = 'none';
        document.getElementById('memory-screen').style.display = 'flex';
        memoryActive = true;

        speechSynthesis.getVoices();
        buildGame();
    }

    function stopMemory() {
        speechSynthesis.cancel();
        document.getElementById('start-screen').style.display = 'block';
        document.getElementById('memory-screen').style.display = 'none';
        memoryActive = false;
        escapeHeldStart = null;
    }

    function handleKeyDown(event) {
        if (!memoryActive) return;
        if (event.key === 'Escape') {
            if (!escapeHeldStart) escapeHeldStart = Date.now();
            event.preventDefault();
            return;
        }
        event.preventDefault();
    }

    function handleKeyUp(event) {
        if (!memoryActive) return;
        if (event.key === 'Escape') {
            if (escapeHeldStart && (Date.now() - escapeHeldStart) >= ESCAPE_HOLD_TIME) {
                if (isMobile) exitFullscreen();
                stopMemory();
            }
            escapeHeldStart = null;
        }
    }

    function checkEscapeHold() {
        if (!memoryActive) return;
        if (escapeHeldStart && (Date.now() - escapeHeldStart) >= ESCAPE_HOLD_TIME) {
            if (isMobile) exitFullscreen();
            stopMemory();
        }
    }

    function handleFullscreenChange() {
        if (!isMobile || !memoryActive) return;
        const isFullscreen = document.fullscreenElement || document.webkitFullscreenElement;
        if (!isFullscreen) stopMemory();
    }

    async function init() {
        await loadSounds();

        document.getElementById('memory-btn').addEventListener('click', startMemory);

        // Player count toggle
        document.querySelectorAll('.player-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelector('.player-btn.selected')?.classList.remove('selected');
                btn.classList.add('selected');
            });
        });

        document.addEventListener('keydown', handleKeyDown, true);
        document.addEventListener('keyup', handleKeyUp, true);
        setInterval(checkEscapeHold, 100);

        document.addEventListener('fullscreenchange', handleFullscreenChange);
        document.addEventListener('webkitfullscreenchange', handleFullscreenChange);

        document.addEventListener('contextmenu', (e) => {
            if (memoryActive) e.preventDefault();
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
