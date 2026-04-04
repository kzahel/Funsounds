(function() {
    'use strict';

    let sounds = [];
    let isPlaying = false;
    let escapeHeldStart = null;
    const ESCAPE_HOLD_TIME = 1500;
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
                     (navigator.maxTouchPoints && navigator.maxTouchPoints > 2);

    const BUTTON_COUNTS = { 1: 4, 2: 6, 3: 12 };

    let buttonItems = [];
    let buttonCount = 4;

    // Alphabet items
    const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

    // Color items
    const COLORS = [
        { display: null, css: '#e74c3c', name: 'red' },
        { display: null, css: '#3498db', name: 'blue' },
        { display: null, css: '#2ecc71', name: 'green' },
        { display: null, css: '#f1c40f', name: 'yellow' },
        { display: null, css: '#e67e22', name: 'orange' },
        { display: null, css: '#9b59b6', name: 'purple' },
        { display: null, css: '#2c3e50', name: 'black' },
        { display: null, css: '#ecf0f1', name: 'white' },
        { display: null, css: '#8B4513', name: 'brown' },
        { display: null, css: '#ff69b4', name: 'pink' },
        { display: null, css: '#1abc9c', name: 'turquoise' },
        { display: null, css: '#ffd700', name: 'gold' },
    ];

    // Number items
    const NUMBERS_EASY = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const NUMBERS_HARD = [];
    for (let i = 1; i <= 20; i++) NUMBERS_HARD.push(i);

    function getDifficulty() {
        const slider = document.getElementById('difficulty-slider');
        return slider ? parseInt(slider.value) : 2;
    }

    function getMode() {
        const sel = document.querySelector('.mode-btn.selected');
        return sel ? sel.dataset.mode : 'objects';
    }

    function speakText(text) {
        const utter = new SpeechSynthesisUtterance(text);
        utter.rate = 0.9;
        utter.pitch = 1.1;
        utter.volume = 1;
        const voices = speechSynthesis.getVoices();
        const preferred = voices.find(v => v.lang.startsWith('en') && v.name.includes('Female')) ||
                          voices.find(v => v.lang.startsWith('en'));
        if (preferred) utter.voice = preferred;
        speechSynthesis.speak(utter);
    }

    async function loadSounds() {
        try {
            const response = await fetch('toddler_sounds.json');
            const data = await response.json();
            sounds = data.sounds;
        } catch (error) {
            console.error('Failed to load sounds:', error);
        }
    }

    function pickRandom(arr) {
        return arr[Math.floor(Math.random() * arr.length)];
    }

    // Generate a random item based on current mode
    function getRandomItem() {
        const mode = getMode();

        if (mode === 'objects') {
            const s = pickRandom(sounds);
            return { display: s.emoji, name: s.name, renderType: 'emoji', sound: s };
        }
        if (mode === 'alphabet') {
            const letter = pickRandom(ALPHABET);
            return { display: letter, name: letter, renderType: 'text' };
        }
        if (mode === 'colors') {
            const c = pickRandom(COLORS);
            return { display: null, css: c.css, name: c.name, renderType: 'color' };
        }
        if (mode === 'numbers') {
            const pool = getDifficulty() >= 3 ? NUMBERS_HARD : NUMBERS_EASY;
            const n = pickRandom(pool);
            return { display: String(n), name: String(n), renderType: 'text' };
        }
        // fallback
        const s = pickRandom(sounds);
        return { display: s.emoji, name: s.name, renderType: 'emoji', sound: s };
    }

    // Render an item into a button
    function renderItemIntoButton(btn, item) {
        // Clear existing content
        const existing = btn.querySelector('.emoji, .color-swatch');
        if (existing) existing.remove();

        if (item.renderType === 'color') {
            const swatch = document.createElement('div');
            swatch.className = 'color-swatch';
            swatch.style.background = item.css;
            btn.appendChild(swatch);
        } else {
            const span = document.createElement('span');
            span.className = 'emoji';
            span.textContent = item.display;
            if (item.renderType === 'text') span.classList.add('text-choice');
            btn.appendChild(span);
        }
    }

    function initTouchButton(index) {
        const btn = document.querySelector(`.touch-btn[data-index="${index}"]`);
        if (!btn) return;

        const item = getRandomItem();
        buttonItems[index] = item;
        renderItemIntoButton(btn, item);
    }

    function buildTouchGrid() {
        buttonCount = BUTTON_COUNTS[getDifficulty()] || 6;
        buttonItems = new Array(buttonCount).fill(null);

        const grid = document.getElementById('touch-grid');
        grid.innerHTML = '';
        grid.classList.remove('grid-large');

        // Set grid layout
        if (buttonCount <= 4) {
            grid.style.gridTemplateColumns = '1fr 1fr';
            grid.style.gridTemplateRows = buttonCount <= 2 ? '1fr' : '1fr 1fr';
        } else if (buttonCount <= 6) {
            grid.style.gridTemplateColumns = '1fr 1fr 1fr';
            grid.style.gridTemplateRows = '1fr 1fr';
        } else {
            // 12 buttons: 4x3
            grid.style.gridTemplateColumns = '1fr 1fr 1fr 1fr';
            grid.style.gridTemplateRows = '1fr 1fr 1fr';
            grid.classList.add('grid-large');
        }

        for (let i = 0; i < buttonCount; i++) {
            const btn = document.createElement('button');
            btn.className = 'touch-btn';
            btn.dataset.index = i;
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                handleTouchButton(i);
            });
            grid.appendChild(btn);
            initTouchButton(i);
        }
    }

    // Desktop: play sound and show item on screen
    function playSoundDesktop(item) {
        if (!item) return;

        speakText(item.name);

        // Create display element
        const el = document.createElement('div');
        el.className = 'emoji-display';

        if (item.renderType === 'color') {
            el.style.width = '120px';
            el.style.height = '120px';
            el.style.borderRadius = '50%';
            el.style.background = item.css;
            el.style.border = '4px solid rgba(255,255,255,0.3)';
            el.style.fontSize = '0';
        } else if (item.renderType === 'text') {
            el.textContent = item.display;
            el.style.color = 'white';
            el.style.fontWeight = '700';
        } else {
            el.textContent = item.display;
        }

        const padding = 100;
        const x = padding + Math.random() * (window.innerWidth - padding * 2 - 150);
        const y = padding + Math.random() * (window.innerHeight - padding * 2 - 150);
        el.style.left = `${x}px`;
        el.style.top = `${y}px`;

        document.getElementById('play-area').appendChild(el);

        // Play sound effect if it's an object with a sound file
        let duration = 3000;
        if (item.sound) {
            const audio = new Audio(`${item.sound.filename}.mp3`);
            audio.volume = 0.7;
            audio.play().catch(() => {});
            duration = (item.sound.duration || 3) * 1000;
            audio.addEventListener('ended', () => fadeOutEmoji(el));
        }

        setTimeout(() => fadeOutEmoji(el), duration + 500);
    }

    function fadeOutEmoji(emoji) {
        if (emoji.classList.contains('fading')) return;
        emoji.classList.add('fading');
        setTimeout(() => {
            if (emoji.parentNode) emoji.parentNode.removeChild(emoji);
        }, 500);
    }

    async function handleTouchButton(index) {
        const btn = document.querySelector(`.touch-btn[data-index="${index}"]`);
        const item = buttonItems[index];
        if (!btn || !item) return;

        if (btn.classList.contains('charging')) return;

        speakText(item.name);

        btn.classList.add('charging');

        // If object mode, play the sound file
        let audio = null;
        if (item.sound) {
            audio = new Audio();
            audio.volume = 0.7;
            audio.preload = 'auto';

            const audioReady = new Promise((resolve) => {
                audio.addEventListener('canplaythrough', resolve, { once: true });
                audio.addEventListener('error', resolve, { once: true });
                setTimeout(resolve, 500);
            });

            audio.src = `${item.sound.filename}.mp3`;
            await audioReady;

            try { await audio.play(); } catch (err) {}
            await new Promise(r => setTimeout(r, 30));
        } else {
            // For non-sound modes, brief pause for the TTS
            await new Promise(r => setTimeout(r, 400));
        }

        btn.classList.remove('charging');
        btn.classList.add('fading');

        const duration = item.sound ? (item.sound.duration || 3) * 1000 : 1500;

        let replaced = false;
        const replaceItem = () => {
            if (replaced) return;
            replaced = true;
            initTouchButton(index);
            requestAnimationFrame(() => { btn.classList.remove('fading'); });
        };

        if (audio) {
            audio.addEventListener('ended', replaceItem, { once: true });
        }
        setTimeout(replaceItem, duration + 500);
    }

    async function enterFullscreen() {
        const elem = document.documentElement;
        try {
            if (elem.requestFullscreen) await elem.requestFullscreen();
            else if (elem.webkitRequestFullscreen) await elem.webkitRequestFullscreen();
            else if (elem.msRequestFullscreen) await elem.msRequestFullscreen();
            return true;
        } catch (error) { return false; }
    }

    function exitFullscreen() {
        if (document.exitFullscreen) document.exitFullscreen();
        else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
        else if (document.msExitFullscreen) document.msExitFullscreen();
    }

    async function startPlaying() {
        if (isMobile) await enterFullscreen();

        document.getElementById('start-screen').style.display = 'none';

        if (isMobile) {
            buildTouchGrid();
            document.getElementById('touch-grid').style.display = 'grid';
        } else {
            document.getElementById('play-area').style.display = 'block';
        }

        isPlaying = true;
        document.body.focus();
    }

    function stopPlaying() {
        document.getElementById('start-screen').style.display = 'block';
        document.getElementById('play-area').style.display = 'none';
        document.getElementById('touch-grid').style.display = 'none';
        isPlaying = false;
        escapeHeldStart = null;
    }

    function handleKeyDown(event) {
        if (!isPlaying) return;

        if (event.key === 'Escape') {
            if (!escapeHeldStart) escapeHeldStart = Date.now();
            event.preventDefault();
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        const item = getRandomItem();
        playSoundDesktop(item);
    }

    function handleKeyUp(event) {
        if (event.key === 'Escape') {
            if (escapeHeldStart && (Date.now() - escapeHeldStart) >= ESCAPE_HOLD_TIME) {
                if (isMobile) exitFullscreen();
                stopPlaying();
            }
            escapeHeldStart = null;
        }
    }

    function checkEscapeHold() {
        if (escapeHeldStart && (Date.now() - escapeHeldStart) >= ESCAPE_HOLD_TIME) {
            if (isMobile) exitFullscreen();
            stopPlaying();
        }
    }

    function handleFullscreenChange() {
        if (!isMobile) return;
        const isFullscreen = document.fullscreenElement ||
                            document.webkitFullscreenElement ||
                            document.msFullscreenElement;
        if (!isFullscreen && isPlaying) stopPlaying();
    }

    async function init() {
        await loadSounds();

        document.getElementById('start-btn').addEventListener('click', startPlaying);

        document.addEventListener('keydown', (e) => {
            if (!isPlaying && e.key !== 'Escape' && document.getElementById('start-screen').style.display !== 'none') {
                startPlaying();
            }
        }, { once: false });

        document.addEventListener('keydown', handleKeyDown, true);
        document.addEventListener('keyup', handleKeyUp, true);
        setInterval(checkEscapeHold, 100);

        document.addEventListener('fullscreenchange', handleFullscreenChange);
        document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
        document.addEventListener('msfullscreenchange', handleFullscreenChange);

        document.addEventListener('contextmenu', (e) => {
            if (isPlaying) e.preventDefault();
        });

        document.addEventListener('keydown', (e) => {
            if (isPlaying && (e.ctrlKey || e.altKey || e.metaKey)) {
                e.preventDefault();
            }
        }, true);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
