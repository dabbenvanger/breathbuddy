/* --- CONFIG & STATE --- */
const defaultCustom = { in: 5, hold: 0, out: 5, hold2: 0 };
let savedPersonal = localStorage.getItem('bb_personal');
let personalSettings = savedPersonal ? JSON.parse(savedPersonal) : { ...defaultCustom };

let savedPresetName = localStorage.getItem('bb_lastPreset') || 'personal';
let savedTheme = localStorage.getItem('bb_theme') || 'blue';

const presets = {
    'box':      { in: 4, hold: 4, out: 4, hold2: 4 },
    '478':      { in: 4, hold: 7, out: 8, hold2: 0 },
    'personal': personalSettings
};

const descriptions = {
    'box': "Four equal phases for calm focus.",
    '478': "Slows your heart, deepens calm and sleep",
    'personal': "Make it yours — I'll remember it."
};

let currentSettings = { ...presets[savedPresetName], duration: 5 };
let activePreset = savedPresetName;

let isRunning = false;
let wakeSentinel = null;
let sessionTimer = null;
let breathingTimeout = null;
let prepareInterval = null;
let phaseInterval = null;
let remainingSeconds = 0;
let completedCycles = 0;
let cycleDuration = 0;

// Base64 Audio for silent unlock
const iosUnlockAudioSrc = "data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//OEAAAAAAAAAAAAAAAAAAAAAAAASW5mbwAAAA8AAAAEAAABIADAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMD//////////////////////////////////////////////////////////////////wAAABFMYXZjNTguMTM0LjEwMAAAAAAAAAAAIAAELRAAAAAAAAAAAAAA//OECQAAAAAAIwAAAAASAAACABAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA//OECQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA//OECQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

/* --- DOM ELEMENTS --- */
const circle = document.getElementById('circle');
const circleWrapper = document.getElementById('circleWrapper');
const statusText = document.getElementById('statusText');
const phaseTimerEl = document.getElementById('phaseTimer');
const floatingStopBtn = document.getElementById('floatingStopBtn');
const body = document.body;
const descriptionEl = document.getElementById('preset-description');
const themeToggle = document.getElementById('themeToggle');

// Unlock audio element creation
const iosUnlockSound = new Audio(iosUnlockAudioSrc);
iosUnlockSound.loop = true;

/* --- AUDIO ENGINE --- */
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

function playTone(type) {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    
    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    
    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    
    if (type === 'gong') {
        // Completion Sound
        osc.frequency.setValueAtTime(200, now);
        gainNode.gain.setValueAtTime(0, now);
        gainNode.gain.linearRampToValueAtTime(0.3, now + 0.1);
        gainNode.gain.exponentialRampToValueAtTime(0.001, now + 4);
        osc.start(now);
        osc.stop(now + 4);
    } else {
        // Phase Change Sound
        osc.type = 'sine';
        let freq = 440; 
        if(type === 'inhale') freq = 440; 
        if(type === 'hold') freq = 554;   
        if(type === 'exhale') freq = 329; 

        osc.frequency.setValueAtTime(freq, now);
        
        gainNode.gain.setValueAtTime(0, now);
        gainNode.gain.linearRampToValueAtTime(0.05, now + 0.05); 
        gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.5); 

        osc.start(now);
        osc.stop(now + 0.6);
    }
}

/* --- LOGIC --- */

function init() {
    themeToggle.checked = (savedTheme === 'sunset');
    toggleTheme();
    applyPreset(savedPresetName);
    
    // Event Listeners for Preset Buttons
    document.getElementById('preset-box').onclick = () => applyPreset('box');
    document.getElementById('preset-478').onclick = () => applyPreset('478');
    document.getElementById('preset-personal').onclick = () => applyPreset('personal');
    
    // Event Listeners for Adjustments (Pills)
    document.querySelectorAll('.pill-btn').forEach(btn => {
        btn.onclick = () => adjustSetting(btn.dataset.type, parseInt(btn.dataset.val));
    });

    // Theme Toggle
    themeToggle.onchange = toggleTheme;

    // Circle Click
    circleWrapper.onclick = handleCircleClick;

    // Stop Button
    floatingStopBtn.onclick = () => stopExercise(false);
}

function updateUI() {
    const fmt = (id, val) => document.getElementById(id).textContent = val + 's';
    
    fmt('display-in', currentSettings.in);
    fmt('display-hold', currentSettings.hold);
    fmt('display-out', currentSettings.out);
    fmt('display-hold2', currentSettings.hold2);
    
    document.getElementById('display-duration').textContent = currentSettings.duration + ' min';

    ['box', '478', 'personal'].forEach(p => {
        document.getElementById(`preset-${p}`).classList.toggle('active', activePreset === p);
    });

    descriptionEl.textContent = descriptions[activePreset];
    
    const pills = {
        in: document.getElementById('pill-in'),
        hold: document.getElementById('pill-hold'),
        out: document.getElementById('pill-out'),
        hold2: document.getElementById('pill-hold2')
    };

    Object.values(pills).forEach(p => p.classList.remove('disabled'));

    if (activePreset === 'box') {
        pills.hold.classList.add('disabled');
        pills.out.classList.add('disabled');
        pills.hold2.classList.add('disabled');
    } else if (activePreset === '478') {
        pills.hold2.classList.add('disabled');
    }
}

function applyPreset(name) {
    if (isRunning) return;
    
    activePreset = name;
    localStorage.setItem('bb_lastPreset', name);

    const src = presets[name];
    currentSettings.in = src.in;
    currentSettings.hold = src.hold;
    currentSettings.out = src.out;
    currentSettings.hold2 = src.hold2;

    updateUI();
}

function adjustSetting(type, amount) {
    if (isRunning) return;

    if (activePreset === 'box') {
        if (type === 'duration') {
             // Pass through
        } else if (type === 'in') {
            let newVal = currentSettings.in + amount;
            if (newVal < 2) newVal = 2;
            if (newVal > 10) newVal = 10;
            
            currentSettings.in = newVal;
            currentSettings.out = newVal;
            currentSettings.hold = newVal;
            currentSettings.hold2 = newVal;
        } else {
            return; 
        }
    } 
    else if (activePreset === '478') {
        if (type === 'hold2') return; 
        if (type !== 'duration') {
            let newVal = currentSettings[type] + amount;
            if (newVal < 0) newVal = 0;
            if ((type === 'in' || type === 'out') && newVal < 1) newVal = 1;
            currentSettings[type] = newVal;
        }
    }
    else {
        // Personal
        if (type !== 'duration') {
            let newVal = currentSettings[type] + amount;
            if (newVal < 0) newVal = 0;
            if ((type === 'in' || type === 'out') && newVal < 1) newVal = 1;
            currentSettings[type] = newVal;

            presets.personal[type] = currentSettings[type];
            localStorage.setItem('bb_personal', JSON.stringify(presets.personal));
        }
    }

    if (type === 'duration') {
        let d = currentSettings.duration + amount;
        if (d < 1) d = 1;
        if (d > 60) d = 60;
        currentSettings.duration = d;
    }

    const elId = `display-${type}`;
    const el = document.getElementById(elId);
    if(el) {
        el.classList.remove('pop');
        void el.offsetWidth;
        el.classList.add('pop');
    }

    updateUI();
}

function toggleTheme() {
    const isChecked = themeToggle.checked;
    const themeName = isChecked ? 'sunset' : 'blue';
    
    if (isChecked) body.classList.add('sunset-theme');
    else body.classList.remove('sunset-theme');
    
    localStorage.setItem('bb_theme', themeName);
}

/* --- WAKE LOCK --- */
async function requestWakeLock() {
    try {
        wakeSentinel = await navigator.wakeLock.request('screen');
    } catch (err) { console.log('Wake Lock error:', err); }
}

function releaseWakeLock() {
    if (wakeSentinel) {
        wakeSentinel.release().then(() => wakeSentinel = null);
    }
}

/* --- EXERCISE LOOP --- */

function handleCircleClick() {
    if (isRunning) return; 
    startExercise();
}

function startExercise() {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    iosUnlockSound.play().catch(() => {});
    requestWakeLock();
    
    cycleDuration = currentSettings.in + currentSettings.hold + currentSettings.out + currentSettings.hold2;
    
    const exactBpm = 60 / cycleDuration;
    const displayBpm = Number.isInteger(exactBpm) ? exactBpm : exactBpm.toFixed(1);
    
    remainingSeconds = currentSettings.duration * 60;
    completedCycles = 0;
    
    document.getElementById('info-bpm').textContent = displayBpm;
    document.getElementById('info-cycles').textContent = '0';
    updateTimerDisplay();

    isRunning = true;
    body.classList.add('active');
    circle.classList.remove('idle');
    
    floatingStopBtn.textContent = "Stop Session";
    floatingStopBtn.classList.remove('completed-state');
    floatingStopBtn.classList.add('visible');
    
    let prepCount = 3; 
    statusText.textContent = "Ready...";
    phaseTimerEl.textContent = "";
    
    prepareInterval = setInterval(() => {
        if (prepCount > 0) {
            statusText.textContent = prepCount;
            playTone('hold'); 
            prepCount--;
        } else {
            clearInterval(prepareInterval);
            
            sessionTimer = setInterval(() => {
                remainingSeconds--;
                updateTimerDisplay(); 
                if(remainingSeconds <= 0) stopExercise(true);
            }, 1000);
            
            runPhase('in');
        }
    }, 1000);
}

function updateTimerDisplay() {
    const m = Math.floor(remainingSeconds / 60);
    const s = remainingSeconds % 60;
    const newStr = `${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`;
    document.getElementById('info-time').textContent = newStr;
}

function runPhase(phase) {
    if (!isRunning) return;

    let time = 0;
    let nextPhase = '';
    let scale = 1;
    let label = '';
    let sound = '';

    if (phase === 'in') {
        time = currentSettings.in;
        label = "Inhale";
        nextPhase = currentSettings.hold > 0 ? 'hold' : 'out';
        scale = 1.7; 
        sound = 'inhale';
    } else if (phase === 'hold') {
        time = currentSettings.hold;
        label = "Hold";
        nextPhase = 'out';
        scale = 1.7; 
        sound = 'hold';
    } else if (phase === 'out') {
        time = currentSettings.out;
        label = "Exhale";
        nextPhase = currentSettings.hold2 > 0 ? 'hold2' : 'finish_cycle';
        scale = 1.0; 
        sound = 'exhale';
    } else if (phase === 'hold2') {
        time = currentSettings.hold2;
        label = "Hold";
        nextPhase = 'finish_cycle';
        scale = 1.0; 
        sound = 'hold';
    } else if (phase === 'finish_cycle') {
        completedCycles++;
        const elCycles = document.getElementById('info-cycles');
        elCycles.textContent = completedCycles;
        elCycles.classList.remove('fade-num');
        void elCycles.offsetWidth;
        elCycles.classList.add('fade-num');

        runPhase('in'); 
        return;
    }

    statusText.textContent = label;
    playTone(sound);

    let phaseRemaining = time;
    phaseTimerEl.textContent = phaseRemaining;
    phaseTimerEl.classList.remove('fade-num');
    void phaseTimerEl.offsetWidth;
    phaseTimerEl.classList.add('fade-num');

    if (phaseInterval) clearInterval(phaseInterval);
    phaseInterval = setInterval(() => {
        phaseRemaining--;
        if (phaseRemaining >= 0) {
            phaseTimerEl.textContent = phaseRemaining;
            phaseTimerEl.classList.remove('fade-num');
            void phaseTimerEl.offsetWidth;
            phaseTimerEl.classList.add('fade-num');
        }
    }, 1000);

    if (time > 0) {
        circle.style.transition = (phase === 'hold' || phase === 'hold2') 
            ? `transform 0s` 
            : `transform ${time}s cubic-bezier(0.4, 0.0, 0.2, 1)`;
            
        circle.style.transform = `scale(${scale})`;
    }

    breathingTimeout = setTimeout(() => {
        runPhase(nextPhase);
    }, time * 1000);
}

function stopExercise(completed = false) {
    clearTimeout(breathingTimeout);
    clearInterval(sessionTimer);
    clearInterval(prepareInterval);
    clearInterval(phaseInterval);
    iosUnlockSound.pause();
    releaseWakeLock();

    isRunning = false;
    phaseTimerEl.textContent = "";

    if (completed) {
        statusText.textContent = "Well done"; // Text inside circle now
        playTone('gong');
        
        floatingStopBtn.textContent = "Complete";
        floatingStopBtn.classList.add('completed-state');
        
        circle.style.transition = "transform 1.5s ease-out";
        circle.style.transform = "scale(1)";
        
    } else {
        statusText.textContent = "Start";
        body.classList.remove('active');
        
        circle.style.transition = "transform 0.5s ease-out";
        circle.style.transform = "scale(1)";

        setTimeout(() => {
            if(!isRunning) {
                circle.classList.add('idle');
                floatingStopBtn.classList.remove('visible');
            }
        }, 500); 
    }
}

// Start
init();