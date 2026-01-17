(function() {
    'use strict';

    let sounds = [];
    let isPlaying = false;
    let escapeHeldStart = null;
    const ESCAPE_HOLD_TIME = 1500; // Hold escape for 1.5 seconds to exit
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
                     (navigator.maxTouchPoints && navigator.maxTouchPoints > 2);

    // Track which sounds are assigned to each button
    let buttonSounds = [null, null, null, null];

    // Load sounds data
    async function loadSounds() {
        try {
            const response = await fetch('toddler_sounds.json');
            const data = await response.json();
            sounds = data.sounds;
            console.log(`Loaded ${sounds.length} sounds`);
        } catch (error) {
            console.error('Failed to load sounds:', error);
            // Fallback: show error to user
            alert('Could not load sounds. Please make sure toddler_sounds.json is available.');
        }
    }

    // Get a sound based on the key pressed
    function getSoundForKey(key) {
        if (sounds.length === 0) return null;

        // Create a simple hash from the key to get consistent sound per key
        let hash = 0;
        const keyStr = key.toLowerCase();
        for (let i = 0; i < keyStr.length; i++) {
            hash = ((hash << 5) - hash) + keyStr.charCodeAt(i);
            hash = hash & hash; // Convert to 32bit integer
        }

        const index = Math.abs(hash) % sounds.length;
        return sounds[index];
    }

    // Play a sound and show emoji
    function playSound(soundData) {
        if (!soundData) return;

        // Create audio element
        const audio = new Audio(`${soundData.filename}.mp3`);
        audio.volume = 0.7;

        // Create emoji element
        const emoji = document.createElement('div');
        emoji.className = 'emoji-display';
        emoji.textContent = soundData.emoji;

        // Random position (with padding so it doesn't go off screen)
        const padding = 100;
        const x = padding + Math.random() * (window.innerWidth - padding * 2 - 150);
        const y = padding + Math.random() * (window.innerHeight - padding * 2 - 150);

        emoji.style.left = `${x}px`;
        emoji.style.top = `${y}px`;

        const playArea = document.getElementById('play-area');
        playArea.appendChild(emoji);

        // Play the audio
        audio.play().catch(err => {
            console.log('Audio play failed:', err);
        });

        // Remove emoji when audio ends (or after duration if audio fails)
        const duration = (soundData.duration || 3) * 1000;

        audio.addEventListener('ended', () => {
            fadeOutEmoji(emoji);
        });

        // Fallback timeout in case audio doesn't fire ended event
        setTimeout(() => {
            fadeOutEmoji(emoji);
        }, duration + 500);
    }

    function fadeOutEmoji(emoji) {
        if (emoji.classList.contains('fading')) return;
        emoji.classList.add('fading');
        setTimeout(() => {
            if (emoji.parentNode) {
                emoji.parentNode.removeChild(emoji);
            }
        }, 500);
    }

    // Get a random sound
    function getRandomSound() {
        if (sounds.length === 0) return null;
        return sounds[Math.floor(Math.random() * sounds.length)];
    }

    // Initialize a touch button with a random sound
    function initTouchButton(index) {
        const btn = document.querySelector(`.touch-btn[data-index="${index}"]`);
        if (!btn) return;

        const soundData = getRandomSound();
        buttonSounds[index] = soundData;

        const emojiSpan = btn.querySelector('.emoji');
        if (emojiSpan && soundData) {
            emojiSpan.textContent = soundData.emoji;
        }
    }

    // Initialize all touch buttons
    function initAllTouchButtons() {
        for (let i = 0; i < 4; i++) {
            initTouchButton(i);
        }
    }

    // Handle touch button tap
    async function handleTouchButton(index) {
        const btn = document.querySelector(`.touch-btn[data-index="${index}"]`);
        const soundData = buttonSounds[index];
        if (!btn || !soundData) return;

        // Prevent double-taps while loading
        if (btn.classList.contains('charging')) return;

        // Start charging animation immediately
        btn.classList.add('charging');

        // Preload the audio
        const audio = new Audio();
        audio.volume = 0.7;
        audio.preload = 'auto';

        // Wait for audio to be ready
        const audioReady = new Promise((resolve) => {
            audio.addEventListener('canplaythrough', resolve, { once: true });
            audio.addEventListener('error', resolve, { once: true }); // Don't block on error
            // Fallback timeout in case canplaythrough doesn't fire
            setTimeout(resolve, 500);
        });

        audio.src = `${soundData.filename}.mp3`;

        await audioReady;

        // Play the audio
        try {
            await audio.play();
        } catch (err) {
            console.log('Audio play failed:', err);
        }

        // Small delay after audio starts to sync visual
        await new Promise(r => setTimeout(r, 30));

        // Remove charging, trigger fade
        btn.classList.remove('charging');
        btn.classList.add('fading');

        const duration = (soundData.duration || 3) * 1000;

        // When audio ends, show new emoji
        const replaceEmoji = () => {
            btn.classList.remove('fading');
            initTouchButton(index);
        };

        audio.addEventListener('ended', replaceEmoji, { once: true });
        // Fallback timeout
        setTimeout(replaceEmoji, duration + 500);
    }

    // Enter fullscreen
    async function enterFullscreen() {
        const elem = document.documentElement;
        try {
            if (elem.requestFullscreen) {
                await elem.requestFullscreen();
            } else if (elem.webkitRequestFullscreen) {
                await elem.webkitRequestFullscreen();
            } else if (elem.msRequestFullscreen) {
                await elem.msRequestFullscreen();
            }
            return true;
        } catch (error) {
            console.log('Fullscreen request failed:', error);
            return false;
        }
    }

    // Exit fullscreen
    function exitFullscreen() {
        if (document.exitFullscreen) {
            document.exitFullscreen();
        } else if (document.webkitExitFullscreen) {
            document.webkitExitFullscreen();
        } else if (document.msExitFullscreen) {
            document.msExitFullscreen();
        }
    }

    // Start playing
    async function startPlaying() {
        const success = await enterFullscreen();

        document.getElementById('start-screen').style.display = 'none';

        if (isMobile) {
            document.getElementById('touch-grid').style.display = 'grid';
            initAllTouchButtons();
        } else {
            document.getElementById('play-area').style.display = 'block';
        }

        isPlaying = true;

        // Try to keep keyboard focus by focusing the document
        document.body.focus();
    }

    // Stop playing
    function stopPlaying() {
        document.getElementById('start-screen').style.display = 'block';
        document.getElementById('play-area').style.display = 'none';
        document.getElementById('touch-grid').style.display = 'none';
        isPlaying = false;
        escapeHeldStart = null;
    }

    // Handle key down
    function handleKeyDown(event) {
        if (!isPlaying) return;

        // Handle escape key - require holding it
        if (event.key === 'Escape') {
            if (!escapeHeldStart) {
                escapeHeldStart = Date.now();
            }
            event.preventDefault();
            return;
        }

        // Prevent default for all keys to stop browser shortcuts
        event.preventDefault();
        event.stopPropagation();

        // Play sound for this key
        const soundData = getSoundForKey(event.key || event.code);
        playSound(soundData);
    }

    // Handle key up
    function handleKeyUp(event) {
        if (event.key === 'Escape') {
            if (escapeHeldStart && (Date.now() - escapeHeldStart) >= ESCAPE_HOLD_TIME) {
                exitFullscreen();
                stopPlaying();
            }
            escapeHeldStart = null;
        }
    }

    // Check if escape is still being held
    function checkEscapeHold() {
        if (escapeHeldStart && (Date.now() - escapeHeldStart) >= ESCAPE_HOLD_TIME) {
            exitFullscreen();
            stopPlaying();
        }
    }

    // Handle fullscreen change
    function handleFullscreenChange() {
        const isFullscreen = document.fullscreenElement ||
                            document.webkitFullscreenElement ||
                            document.msFullscreenElement;

        if (!isFullscreen && isPlaying) {
            stopPlaying();
        }
    }

    // Initialize
    async function init() {
        await loadSounds();

        // Start button click
        document.getElementById('start-btn').addEventListener('click', startPlaying);

        // Also start on any key press from start screen
        document.addEventListener('keydown', (e) => {
            if (!isPlaying && e.key !== 'Escape') {
                startPlaying();
            }
        }, { once: false });

        // Key handlers
        document.addEventListener('keydown', handleKeyDown, true);
        document.addEventListener('keyup', handleKeyUp, true);

        // Check escape hold periodically
        setInterval(checkEscapeHold, 100);

        // Fullscreen change handler
        document.addEventListener('fullscreenchange', handleFullscreenChange);
        document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
        document.addEventListener('msfullscreenchange', handleFullscreenChange);

        // Prevent context menu
        document.addEventListener('contextmenu', (e) => {
            if (isPlaying) e.preventDefault();
        });

        // Prevent some keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (isPlaying) {
                // Block F keys, Ctrl combos, etc.
                if (e.ctrlKey || e.altKey || e.metaKey) {
                    e.preventDefault();
                }
            }
        }, true);

        // Touch button handlers
        document.querySelectorAll('.touch-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                const index = parseInt(btn.dataset.index, 10);
                handleTouchButton(index);
            });
        });
    }

    // Start when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
