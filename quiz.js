(function() {
    'use strict';

    let sounds = [];
    let quizActive = false;
    let currentAnswer = null;
    let roundLocked = false;
    let quizMode = 'objects';
    let difficulty = 2;
    let firstRound = true;
    let starsEarned = 0;
    let lostStarThisRound = false;
    const STARS_TO_WIN = 5;

    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
                     (navigator.maxTouchPoints && navigator.maxTouchPoints > 2);

    const DIFFICULTY = {
        1: { choiceCount: 2, label: 'Easy' },
        2: { choiceCount: 4, label: 'Normal' },
        3: { choiceCount: 6, label: 'Hard' },
        4: { choiceCount: 4, label: 'Expert' },
    };
    let expertUnlocked = false;

    // Object quiz: tiered by familiarity
    const OBJECTS_EASY = new Set([
        'dog', 'cat', 'cow', 'pig', 'duck', 'horse', 'bird', 'frog',
        'car', 'train', 'bus', 'bell', 'drum', 'phone', 'lion', 'bear'
    ]);
    const OBJECTS_NORMAL = new Set([
        ...OBJECTS_EASY,
        'elephant', 'rooster', 'bee', 'sheep', 'owl', 'monkey', 'whale',
        'dolphin', 'penguin', 'snake', 'fox', 'airplane', 'rocket',
        'firetruck', 'helicopter', 'motorcycle', 'tractor', 'bicycle',
        'ship', 'trumpet', 'piano', 'guitar', 'basketball', 'soccer'
    ]);
    const OBJECTS_HARD = new Set([
        ...OBJECTS_NORMAL,
        'wolf', 'parrot', 'bat', 'alligator', 'hippo', 'giraffe',
        'squirrel', 'chick', 'turkey', 'cricket', 'violin', 'saxophone',
        'trombone', 'bongo', 'hammer', 'scissors', 'ghost', 'dragon',
        'unicorn', 'fairy'
    ]);

    // Alphabet
    const ALPHA_EASY = 'A B C D O S X Z'.split(' ');
    const ALPHA_ALL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

    // Colors
    const COLORS_EASY = [
        { key: 'red',    name: 'red',    css: '#e74c3c' },
        { key: 'blue',   name: 'blue',   css: '#3498db' },
        { key: 'green',  name: 'green',  css: '#2ecc71' },
        { key: 'yellow', name: 'yellow', css: '#f1c40f' },
    ];
    const COLORS_NORMAL = [
        ...COLORS_EASY,
        { key: 'orange', name: 'orange', css: '#e67e22' },
        { key: 'purple', name: 'purple', css: '#9b59b6' },
        { key: 'black',  name: 'black',  css: '#2c3e50' },
        { key: 'white',  name: 'white',  css: '#ecf0f1' },
        { key: 'brown',  name: 'brown',  css: '#8B4513' },
        { key: 'pink',   name: 'pink',   css: '#ff69b4' },
    ];
    const COLORS_HARD = [
        ...COLORS_NORMAL,
        { key: 'turquoise',  name: 'turquoise',  css: '#1abc9c' },
        { key: 'magenta',    name: 'magenta',     css: '#ff00ff' },
        { key: 'gold',       name: 'gold',        css: '#ffd700' },
        { key: 'navy',       name: 'navy',        css: '#1a3a5c' },
        { key: 'lime',       name: 'lime',        css: '#32cd32' },
        { key: 'coral',      name: 'coral',       css: '#ff7f50' },
        { key: 'lavender',   name: 'lavender',    css: '#b57edc' },
        { key: 'teal',       name: 'teal',        css: '#008080' },
        { key: 'maroon',     name: 'maroon',      css: '#800000' },
        { key: 'peach',      name: 'peach',       css: '#ffb07c' },
        { key: 'olive',      name: 'olive',       css: '#808000' },
        { key: 'salmon',     name: 'salmon',      css: '#fa8072' },
        { key: 'crimson',    name: 'crimson',     css: '#dc143c' },
        { key: 'indigo',     name: 'indigo',      css: '#4b0082' },
        { key: 'beige',      name: 'beige',       css: '#f5f5dc' },
        { key: 'silver',     name: 'silver',      css: '#c0c0c0' },
    ];

    // Colors that look too similar — never show together
    const COLOR_CONFLICTS = [
        ['red', 'crimson', 'maroon'],
        ['yellow', 'gold'],
        ['white', 'beige', 'silver'],
        ['blue', 'navy', 'indigo'],
        ['green', 'lime', 'olive', 'teal'],
        ['purple', 'lavender', 'indigo', 'magenta'],
        ['pink', 'magenta', 'salmon', 'coral'],
        ['orange', 'coral', 'peach', 'salmon'],
        ['brown', 'maroon', 'olive'],
        ['turquoise', 'teal'],
    ];

    function getColorConflicts(key) {
        const conflicts = new Set();
        for (const group of COLOR_CONFLICTS) {
            if (group.includes(key)) {
                for (const k of group) conflicts.add(k);
            }
        }
        conflicts.delete(key);
        return conflicts;
    }

    // Numbers
    const NUMBERS_EASY = [1, 2, 3, 4, 5];
    const NUMBERS_NORMAL = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const NUMBERS_HARD = [];
    for (let i = 1; i <= 20; i++) NUMBERS_HARD.push(i);

    let escapeHeldStart = null;
    const ESCAPE_HOLD_TIME = 1500;

    async function loadQuizSounds() {
        try {
            const response = await fetch('toddler_sounds.json');
            const data = await response.json();
            sounds = data.sounds;
        } catch (error) {
            console.error('Failed to load quiz sounds:', error);
        }
    }

    function speak(text) {
        return new Promise((resolve) => {
            let resolved = false;
            const done = () => {
                if (resolved) return;
                resolved = true;
                btn.classList.remove('speaking');
                resolve();
            };

            speechSynthesis.cancel();
            const utter = new SpeechSynthesisUtterance(text);
            utter.rate = 0.85;
            utter.pitch = 1.1;
            utter.volume = 1;
            const voices = speechSynthesis.getVoices();
            const preferred = voices.find(v => v.lang.startsWith('en') && v.name.includes('Female')) ||
                              voices.find(v => v.lang.startsWith('en'));
            if (preferred) utter.voice = preferred;

            const btn = document.getElementById('quiz-speaker');
            btn.classList.add('speaking');

            utter.onend = done;
            utter.onerror = done;
            setTimeout(done, 3000);

            speechSynthesis.speak(utter);
        });
    }

    function shuffle(arr) {
        const a = arr.slice();
        for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
    }

    function pickRandom(arr) {
        return arr[Math.floor(Math.random() * arr.length)];
    }

    function getNameForChoice(c) {
        if (quizMode === 'objects') return c.name;
        if (quizMode === 'colors') return c.name;
        if (quizMode === 'alphabet') return c;
        if (quizMode === 'numbers') return String(c);
        return String(c);
    }

    function buildExpertSpeech(answer, choices) {
        const otherNames = choices
            .filter(c => c.key !== answer.key)
            .map(c => c.key);
        const listed = otherNames.join(', ');
        if (firstRound) {
            return `I see ${listed}. Which one is missing?`;
        }
        return `${listed}. What's missing?`;
    }

    function pickChoicesForMode() {
        const isExpert = difficulty === 4;
        const numChoices = DIFFICULTY[difficulty].choiceCount;

        if (quizMode === 'objects') {
            const nameSet = isExpert ? OBJECTS_NORMAL : difficulty === 1 ? OBJECTS_EASY : difficulty === 2 ? OBJECTS_NORMAL : OBJECTS_HARD;
            const pool = sounds.filter(s => nameSet.has(s.name));
            const answer = pickRandom(pool);
            const others = shuffle(pool.filter(s => s.name !== answer.name)).slice(0, numChoices - 1);
            const choices = shuffle([answer, ...others]);
            const mapped = choices.map(c => ({ key: c.name, display: c.emoji, renderType: 'emoji' }));
            const speech = isExpert
                ? buildExpertSpeech({ key: answer.name }, mapped)
                : firstRound ? `Where is the ${answer.name}?` : answer.name;
            return {
                answer: { key: answer.name, speech, filename: answer.filename, duration: answer.duration },
                choices: mapped,
            };
        }

        if (quizMode === 'alphabet') {
            const pool = isExpert ? ALPHA_ALL : difficulty === 1 ? ALPHA_EASY : ALPHA_ALL;
            const answer = pickRandom(pool);
            const others = shuffle(pool.filter(l => l !== answer)).slice(0, numChoices - 1);
            const choices = shuffle([answer, ...others]);
            const mapped = choices.map(c => ({ key: c, display: c, renderType: 'text' }));
            const speech = isExpert
                ? buildExpertSpeech({ key: answer }, mapped)
                : firstRound ? `Where is the letter ${answer}?` : answer;
            return {
                answer: { key: answer, speech },
                choices: mapped,
            };
        }

        if (quizMode === 'colors') {
            const pool = isExpert ? COLORS_NORMAL : difficulty === 1 ? COLORS_EASY : difficulty === 2 ? COLORS_NORMAL : COLORS_HARD;
            const answer = pickRandom(pool);
            const conflicts = getColorConflicts(answer.key);
            const others = shuffle(pool.filter(c => c.key !== answer.key && !conflicts.has(c.key))).slice(0, numChoices - 1);
            const choices = shuffle([answer, ...others]);
            const mapped = choices.map(c => ({ key: c.key, css: c.css, renderType: 'color' }));
            const speech = isExpert
                ? buildExpertSpeech({ key: answer.key }, mapped)
                : firstRound ? `Where is ${answer.name}?` : answer.name;
            return {
                answer: { key: answer.key, speech },
                choices: mapped,
            };
        }

        if (quizMode === 'numbers') {
            const pool = isExpert ? NUMBERS_NORMAL : difficulty === 1 ? NUMBERS_EASY : difficulty === 2 ? NUMBERS_NORMAL : NUMBERS_HARD;
            const answer = pickRandom(pool);
            const others = shuffle(pool.filter(n => n !== answer)).slice(0, numChoices - 1);
            const choices = shuffle([answer, ...others]);
            const mapped = choices.map(c => ({ key: String(c), display: String(c), renderType: 'text' }));
            const speech = isExpert
                ? buildExpertSpeech({ key: String(answer) }, mapped)
                : firstRound ? `Where is the number ${answer}?` : String(answer);
            return {
                answer: { key: String(answer), speech },
                choices: mapped,
            };
        }
    }

    function updateGridLayout(count) {
        const grid = document.getElementById('quiz-grid');
        if (count <= 2) {
            grid.style.gridTemplateColumns = '1fr 1fr';
            grid.style.gridTemplateRows = '1fr';
        } else if (count <= 4) {
            grid.style.gridTemplateColumns = '1fr 1fr';
            grid.style.gridTemplateRows = '1fr 1fr';
        } else {
            grid.style.gridTemplateColumns = '1fr 1fr 1fr';
            grid.style.gridTemplateRows = '1fr 1fr';
        }
    }

    function spawnConfetti() {
        const container = document.getElementById('confetti-container');
        const colors = ['#ff6b9d', '#ffd93d', '#6bcb77', '#4d96ff', '#ff6b6b', '#c084fc', '#fb923c'];
        for (let i = 0; i < 60; i++) {
            const piece = document.createElement('div');
            piece.className = 'confetti-piece';
            piece.style.left = Math.random() * 100 + 'vw';
            piece.style.background = colors[Math.floor(Math.random() * colors.length)];
            piece.style.width = (6 + Math.random() * 8) + 'px';
            piece.style.height = (6 + Math.random() * 8) + 'px';
            piece.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
            piece.style.animationDuration = (1.5 + Math.random() * 2) + 's';
            piece.style.animationDelay = (Math.random() * 0.5) + 's';
            container.appendChild(piece);
        }
        setTimeout(() => { container.innerHTML = ''; }, 4000);
    }

    function playCheer() {
        const cheerFiles = ['sounds/party', 'sounds/clapping'];
        for (const file of cheerFiles) {
            const audio = new Audio(`${file}.mp3`);
            audio.volume = 0.6;
            audio.play().catch(() => {});
        }
        const utter = new SpeechSynthesisUtterance('Yay!');
        utter.rate = 1.0;
        utter.pitch = 1.4;
        utter.volume = 1;
        speechSynthesis.speak(utter);
    }

    function initStarBar() {
        starsEarned = 0;
        const bar = document.getElementById('star-bar');
        bar.innerHTML = '';
        for (let i = 0; i < STARS_TO_WIN; i++) {
            const slot = document.createElement('span');
            slot.className = 'star-slot';
            slot.textContent = '\u2B50';
            bar.appendChild(slot);
        }
    }

    function awardStar() {
        const slots = document.querySelectorAll('.star-slot');
        if (starsEarned < slots.length) {
            slots[starsEarned].classList.add('earned');
        }
        starsEarned++;
    }

    function removeStar() {
        if (starsEarned <= 0) return;
        starsEarned--;
        const slots = document.querySelectorAll('.star-slot');
        if (starsEarned < slots.length) {
            slots[starsEarned].classList.remove('earned');
        }
    }

    function playFinale() {
        const overlay = document.getElementById('finale-overlay');
        overlay.innerHTML = '';
        overlay.classList.add('active');

        // Spawn stars that roam around
        const stars = [];
        for (let i = 0; i < STARS_TO_WIN; i++) {
            const star = document.createElement('div');
            star.className = 'finale-star roaming';
            star.textContent = '\u2B50';
            star.style.left = (15 + Math.random() * 70) + 'vw';
            star.style.top = (15 + Math.random() * 60) + 'vh';
            star.style.animationDuration = (2 + Math.random() * 2) + 's';
            star.style.animationDelay = (Math.random() * 0.5) + 's';
            overlay.appendChild(star);
            stars.push(star);
        }

        // Play big celebration sounds
        spawnConfetti();
        playCheer();
        setTimeout(spawnConfetti, 800);

        // After roaming, one star grows huge
        setTimeout(() => {
            stars.forEach(s => { s.classList.remove('roaming'); s.style.opacity = '0'; s.style.transition = 'opacity 0.5s'; });
            const big = document.createElement('div');
            big.className = 'finale-star grow';
            big.textContent = '\u2B50';
            big.style.left = '50%';
            big.style.top = '50%';
            big.style.fontSize = '4rem';
            overlay.appendChild(big);
        }, 3000);

        // Return to main screen
        setTimeout(() => {
            overlay.classList.remove('active');
            overlay.innerHTML = '';
            if (isMobile) exitFullscreen();
            stopQuiz();
        }, 5000);
    }

    async function startRound() {
        roundLocked = false;
        lostStarThisRound = false;
        const { answer, choices } = pickChoicesForMode();
        currentAnswer = answer;

        const grid = document.getElementById('quiz-grid');
        grid.innerHTML = '';
        updateGridLayout(choices.length);

        choices.forEach((c) => {
            const btn = document.createElement('button');
            btn.className = 'quiz-btn fade-in';
            btn.dataset.key = c.key;

            if (c.renderType === 'color') {
                const swatch = document.createElement('div');
                swatch.className = 'color-swatch';
                swatch.style.background = c.css;
                btn.appendChild(swatch);
            } else {
                const span = document.createElement('span');
                span.className = 'emoji';
                span.textContent = c.display;
                if (c.renderType === 'text') span.classList.add('text-choice');
                btn.appendChild(span);
            }

            btn.addEventListener('touchstart', (e) => {
                e.preventDefault();
                handleQuizTap(btn);
            }, { passive: false });
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                handleQuizTap(btn);
            });
            grid.appendChild(btn);
        });

        await new Promise(r => setTimeout(r, 400));
        await speak(answer.speech);
        firstRound = false;
    }

    function handleQuizTap(btn) {
        if (roundLocked) return;

        if (btn.dataset.key === currentAnswer.key) {
            roundLocked = true;
            btn.classList.add('correct');
            awardStar();

            const isLastStar = starsEarned >= STARS_TO_WIN;

            // After object sound + cheer, either next round or finale
            const afterCheer = () => {
                if (isLastStar) {
                    setTimeout(playFinale, 500);
                } else {
                    startRound();
                }
            };

            // Play the object's sound first (if it has one), then cheer
            // Cap wait so cheer isn't too delayed on long sounds
            if (currentAnswer.filename) {
                const objAudio = new Audio(`${currentAnswer.filename}.mp3`);
                objAudio.volume = 0.7;
                objAudio.play().catch(() => {});

                let cheered = false;
                const doCheer = () => {
                    if (cheered) return;
                    cheered = true;
                    spawnConfetti();
                    playCheer();
                    setTimeout(afterCheer, 2500);
                };
                objAudio.addEventListener('ended', doCheer, { once: true });
                setTimeout(doCheer, 1500);
            } else {
                spawnConfetti();
                playCheer();
                setTimeout(afterCheer, 2500);
            }
        } else {
            // Lose one star per round on wrong answer
            if (!lostStarThisRound) {
                lostStarThisRound = true;
                removeStar();
            }
            // Brief X overlay
            if (btn.querySelector('.wrong-x')) return;
            const x = document.createElement('div');
            x.className = 'wrong-x';
            x.textContent = '\u2717';
            btn.appendChild(x);
            setTimeout(() => { if (x.parentNode) x.remove(); }, 600);
        }
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

    async function startQuiz() {
        if (isMobile) await enterFullscreen();

        document.getElementById('start-screen').style.display = 'none';
        document.getElementById('quiz-screen').style.display = 'flex';
        quizActive = true;

        speechSynthesis.getVoices();
        firstRound = true;
        initStarBar();
        await startRound();
    }

    function stopQuiz() {
        speechSynthesis.cancel();
        document.getElementById('start-screen').style.display = 'block';
        document.getElementById('quiz-screen').style.display = 'none';
        document.getElementById('confetti-container').innerHTML = '';
        const overlay = document.getElementById('finale-overlay');
        overlay.classList.remove('active');
        overlay.innerHTML = '';
        quizActive = false;
        escapeHeldStart = null;
    }

    function handleKeyDown(event) {
        if (!quizActive) return;
        if (event.key === 'Escape') {
            if (!escapeHeldStart) escapeHeldStart = Date.now();
            event.preventDefault();
            return;
        }
        event.preventDefault();
    }

    function handleKeyUp(event) {
        if (!quizActive) return;
        if (event.key === 'Escape') {
            if (escapeHeldStart && (Date.now() - escapeHeldStart) >= ESCAPE_HOLD_TIME) {
                if (isMobile) exitFullscreen();
                stopQuiz();
            }
            escapeHeldStart = null;
        }
    }

    function checkEscapeHold() {
        if (!quizActive) return;
        if (escapeHeldStart && (Date.now() - escapeHeldStart) >= ESCAPE_HOLD_TIME) {
            if (isMobile) exitFullscreen();
            stopQuiz();
        }
    }

    function handleFullscreenChange() {
        if (!isMobile || !quizActive) return;
        const isFullscreen = document.fullscreenElement || document.webkitFullscreenElement;
        if (!isFullscreen) stopQuiz();
    }

    function unlockExpert() {
        if (expertUnlocked) return;
        expertUnlocked = true;
        const slider = document.getElementById('difficulty-slider');
        slider.max = '4';
        const label = document.getElementById('difficulty-label');
        label.textContent = DIFFICULTY[parseInt(slider.value)].label;
        // Flash the label to hint something happened
        label.style.color = '#ffd93d';
        setTimeout(() => { label.style.color = ''; }, 1500);
    }

    async function init() {
        await loadQuizSounds();

        // Secret expert unlock: tap title 5 times
        let titleTaps = 0;
        let titleTapTimer = null;
        const title = document.querySelector('#start-screen h1');
        title.addEventListener('click', () => {
            titleTaps++;
            clearTimeout(titleTapTimer);
            titleTapTimer = setTimeout(() => { titleTaps = 0; }, 2000);
            if (titleTaps >= 5) {
                titleTaps = 0;
                unlockExpert();
            }
        });

        // Mode selector
        document.querySelectorAll('.mode-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelector('.mode-btn.selected')?.classList.remove('selected');
                btn.classList.add('selected');
                quizMode = btn.dataset.mode;
            });
        });

        // Difficulty slider
        const slider = document.getElementById('difficulty-slider');
        const label = document.getElementById('difficulty-label');
        slider.addEventListener('input', () => {
            difficulty = parseInt(slider.value);
            label.textContent = DIFFICULTY[difficulty].label;
        });

        document.getElementById('quiz-btn').addEventListener('click', startQuiz);

        const speakerHandler = () => {
            if (currentAnswer && !roundLocked) {
                speak(currentAnswer.speech);
            }
        };
        document.getElementById('quiz-speaker').addEventListener('touchstart', (e) => { e.preventDefault(); speakerHandler(); }, { passive: false });
        document.getElementById('quiz-speaker').addEventListener('click', speakerHandler);

        document.addEventListener('keydown', handleKeyDown, true);
        document.addEventListener('keyup', handleKeyUp, true);
        setInterval(checkEscapeHold, 100);

        document.addEventListener('fullscreenchange', handleFullscreenChange);
        document.addEventListener('webkitfullscreenchange', handleFullscreenChange);

        document.addEventListener('contextmenu', (e) => {
            if (quizActive) e.preventDefault();
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
