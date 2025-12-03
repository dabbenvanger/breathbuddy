// --- CONFIG & STATE ---
const defaultCustom = { in: 5, hold: 0, out: 5, hold2: 0 };
let storedCustom = localStorage.getItem('breathBuddyCustom');
let customSettings = storedCustom ? JSON.parse(storedCustom) : { ...defaultCustom };

const presets = {
    'box':      { in: 4, hold: 4, out: 4, hold2: 4 },
    '478':      { in: 4, hold: 7, out: 8, hold2: 0 },
    'personal': customSettings // Mapped in UI as Personal, stored as personal
};

const descriptions = {
    'box': "Square breathing. Equal duration for all phases. Heightens performance and concentration.",
    '478': "The relaxing breath. 4:7:8 ratio. Acts as a natural tranquilizer for the nervous system.",
    'personal': "Your personal rhythm. Adjust the phases to your liking; settings are saved automatically."
};

let currentSettings = { ...presets['box'], duration: 5 };
let activePreset = 'box';

let isRunning = false;
let sessionTimer = null;
let breathingTimeout = null;
let prepareInterval = null;
let remainingSeconds = 0;

// --- DOM ELEMENTS ---
const circle = document.getElementById('circle');
const statusText = document.getElementById('statusText');
const floatingStopBtn = document.getElementById('floatingStopBtn');
const body = document.body;
const iosUnlockSound = document.getElementById('ios-unlock-sound');
const descriptionEl = document.getElementById('preset-description');

const btnBox = document.getElementById('preset-box');
const btn478 = document.getElementById('preset-478');
const btnPersonal = document.getElementById('preset-personal');

const ctrlIn = document.getElementById('ctrl-in');
const ctrlOut = document.getElementById('ctrl-out');
const ctrlHold = document.getElementById('ctrl-hold');
const ctrlHold2 = document.getElementById('ctrl-hold2');
const labelIn = document.getElementById('label-in');
const panel = document.getElementById('settingsPanel');

// --- AUDIO ENGINE ---
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

function playTone(type) {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    
    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    
    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    
    // Short, gentle chimes
    if (type === 'gong') {
        // Completion Sound
        osc.frequency.setValueAtTime(200, now);
        gainNode.gain.setValueAtTime(0, now);
        gainNode.gain.linearRampToValueAtTime(0.3, now + 0.1);
        gainNode.gain.exponentialRampToValueAtTime(0.001, now + 4);
        osc.start(now);
        osc.stop(now + 4);
    } else {
        // Phase Change Sound (Soft Blip)
        osc.type = 'sine';
        // Subtle pitch variation per phase
        let freq = 440; 
        if(type === 'inhale') freq = 440; // A4
        if(type === 'hold') freq = 554;   // C#5
        if(type === 'exhale') freq = 329; // E4

        osc.frequency.setValueAtTime(freq, now);
        
        gainNode.gain.setValueAtTime(0, now);
        gainNode.gain.linearRampToValueAtTime(0.05, now + 0.05); // Soft attack
        gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.5); // Short decay

        osc.start(now);
        osc.stop(now + 0.6);
    }
}

// --- UI LOGIC ---

function updateUI() {
    // Helper for formatting
    const fmt = (val, isFull) => isFull ? `${val} seconds` : `${val}s`;

    // Determine layout state for formatting
    const isBox = activePreset === 'box';
    const is478 = activePreset === '478';

    // Update Values & Formats based on width
    document.getElementById('display-in').textContent = isBox ? fmt(currentSettings.in, true) : fmt(currentSettings.in, false);
    document.getElementById('display-out').textContent = fmt(currentSettings.out, false);
    
    // Hold is full width in Box (hidden) and 4-7-8 (visible)
    document.getElementById('display-hold').textContent = is478 ? fmt(currentSettings.hold, true) : fmt(currentSettings.hold, false);
    
    document.getElementById('display-hold2').textContent = fmt(currentSettings.hold2, false);
    document.getElementById('display-duration').textContent = `${currentSettings.duration} minutes`;

    // Buttons Styling
    btnBox.classList.remove('active');
    btn478.classList.remove('active');
    btnPersonal.classList.remove('active');

    if(activePreset === 'box') btnBox.classList.add('active');
    else if(activePreset === '478') btn478.classList.add('active');
    else btnPersonal.classList.add('active');

    descriptionEl.textContent = descriptions[activePreset];
    configureControlsForPreset(activePreset);
}

function configureControlsForPreset(name) {
    // Reset Classes
    ctrlIn.classList.remove('hidden-control');
    ctrlOut.classList.remove('hidden-control');
    ctrlHold.classList.remove('hidden-control');
    ctrlHold2.classList.remove('hidden-control');
    
    panel.classList.remove('box-mode-active');
    panel.classList.remove('breath-478-active');
    
    labelIn.textContent = "Inhale";

    if (name === 'box') {
        ctrlOut.classList.add('hidden-control');
        ctrlHold.classList.add('hidden-control');
        ctrlHold2.classList.add('hidden-control');
        labelIn.textContent = "Phase Time";
        panel.classList.add('box-mode-active');
    
    } else if (name === '478') {
        ctrlHold2.classList.add('hidden-control');
        panel.classList.add('breath-478-active'); // Triggers full width on Hold
    } 
}

function applyPreset(name) {
    if (isRunning) return;
    activePreset = name;
    
    currentSettings.in = presets[name].in;
    currentSettings.hold = presets[name].hold;
    currentSettings.out = presets[name].out;
    currentSettings.hold2 = presets[name].hold2;
    
    updateUI();
}

function adjustSetting(type, amount) {
    if (isRunning) return;

    // BOX LOGIC: Master Control
    if (activePreset === 'box' && type === 'in') {
        let newVal = currentSettings.in + amount;
        if (newVal < 2) newVal = 2;
        if (newVal > 10) newVal = 10;

        currentSettings.in = newVal;
        currentSettings.out = newVal;
        currentSettings.hold = newVal;
        currentSettings.hold2 = newVal;

        triggerAnimation('in');
        updateUI();
        return;
    }

    // Normal Logic
    currentSettings[type] += amount;

    // Limits
    if (type === 'duration') {
        if (currentSettings[type] < 1) currentSettings[type] = 1;
        if (currentSettings[type] > 60) currentSettings[type] = 60;
    } else {
        if (currentSettings[type] < 0) currentSettings[type] = 0; 
        if ((type === 'in' || type === 'out') && currentSettings[type] < 1) currentSettings[type] = 1; 
        if (currentSettings[type] > 30) currentSettings[type] = 30; 
    }

    // Save Personal
    if (activePreset === 'personal' && type !== 'duration') {
        presets['personal'][type] = currentSettings[type];
        localStorage.setItem('breathBuddyCustom', JSON.stringify(presets['personal']));
    }

    triggerAnimation(type);
    updateUI();
}

function triggerAnimation(type) {
    const idMap = { 'in': 'display-in', 'out': 'display-out', 'hold': 'display-hold', 'hold2': 'display-hold2', 'duration': 'display-duration' };
    const el = document.getElementById(idMap[type]);
    if(el) {
        el.classList.remove('pop');
        void el.offsetWidth;
        el.classList.add('pop');
    }
}

function toggleTheme() {
    const isChecked = document.getElementById('themeToggle').checked;
    if (isChecked) body.classList.add('sunset-theme');
    else body.classList.remove('sunset-theme');
}

// --- START/STOP ---

function handleCircleClick() {
    if (isRunning) return; 
    startExercise();
}

function startExercise() {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    iosUnlockSound.play().catch(e => {});
    
    remainingSeconds = currentSettings.duration * 60;
    isRunning = true;
    
    body.classList.add('active');
    circle.classList.remove('idle');
    floatingStopBtn.classList.add('visible');
    
    let prepCount = 3; 
    statusText.textContent = "Ready...";
    
    prepareInterval = setInterval(() => {
        if (prepCount > 0) {
            statusText.textContent = prepCount;
            playTone('hold'); 
            prepCount--;
        } else {
            clearInterval(prepareInterval);
            statusText.textContent = "Go";
            
            sessionTimer = setInterval(() => {
                remainingSeconds--;
                if(remainingSeconds <= 0) completeExercise();
            }, 1000);
            
            runBreathingCycle(currentSettings.in, currentSettings.hold, currentSettings.out, currentSettings.hold2);
        }
    }, 1000);
}

function stopExercise(completed = false) {
    isRunning = false;
    clearTimeout(breathingTimeout);
    clearInterval(sessionTimer);
    clearInterval(prepareInterval);
    iosUnlockSound.pause();

    if (completed) {
        playTone('gong');
        statusText.textContent = "Complete";
    } else {
        statusText.textContent = "Start";
    }

    body.classList.remove('active');
    floatingStopBtn.classList.remove('visible');
    circle.style.transition = "transform 1s ease";
    circle.style.transform = "scale(1)";
    
    setTimeout(() => {
        if(!isRunning) {
            circle.classList.add('idle');
            if(completed) statusText.textContent = "Start";
        }
    }, 4000);
}

// --- BREATHING CYCLE ---

function runBreathingCycle(inTime, holdTime, outTime, hold2Time) {
    if (!isRunning) return;

    statusText.textContent = "Inhale";
    playTone('inhale');
    
    circle.style.transition = `transform ${inTime}s cubic-bezier(0.4, 0.0, 0.2, 1)`;
    circle.style.transform = "scale(1.6)"; 
    
    breathingTimeout = setTimeout(() => {
        if (!isRunning) return;

        if (holdTime > 0) {
            statusText.textContent = "Hold";
            playTone('hold');
            circle.style.transition = `transform 0s`; 
            circle.style.transform = "scale(1.6)";

            breathingTimeout = setTimeout(() => {
                if (!isRunning) return;
                startExhale(inTime, holdTime, outTime, hold2Time);
            }, holdTime * 1000);
        } else {
            startExhale(inTime, holdTime, outTime, hold2Time);
        }
    }, inTime * 1000);
}

function startExhale(inTime, holdTime, outTime, hold2Time) {
    if (!isRunning) return;

    statusText.textContent = "Exhale";
    playTone('exhale');
    
    circle.style.transition = `transform ${outTime}s cubic-bezier(0.4, 0.0, 0.2, 1)`;
    circle.style.transform = "scale(1)"; 

    breathingTimeout = setTimeout(() => {
        if (!isRunning) return;

        if (hold2Time > 0) {
            statusText.textContent = "Hold";
            playTone('hold');
            circle.style.transition = `transform 0s`; 
            circle.style.transform = "scale(1)";

            breathingTimeout = setTimeout(() => {
                if (!isRunning) return;
                runBreathingCycle(inTime, holdTime, outTime, hold2Time);
            }, hold2Time * 1000);
        } else {
            runBreathingCycle(inTime, holdTime, outTime, hold2Time);
        }

    }, outTime * 1000);
}

updateUI();