const socket = io();

const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const roomUrlInput = document.getElementById('roomUrl');
const authDataInput = document.getElementById('authData');
const botNameInput = document.getElementById('botName');
const consoleDiv = document.getElementById('console');
const statusBadge = document.getElementById('statusBadge');
const statusText = document.getElementById('statusText');
const songTitle = document.getElementById('songTitle');
const songStatus = document.getElementById('songStatus');
const volumeRange = document.getElementById('volumeRange');
const cmdInput = document.getElementById('cmdInput');
const sendCmdBtn = document.getElementById('sendCmdBtn');
const skipBtn = document.getElementById('skipBtn');
const stopMusicBtn = document.getElementById('stopMusicBtn');

// Load saved config
const savedAuth = localStorage.getItem('authData');
const savedBotName = localStorage.getItem('botName');
if (savedAuth) authDataInput.value = savedAuth;
if (savedBotName) botNameInput.value = savedBotName;

function addLog(msg, type = 'info', time = new Date().toLocaleTimeString()) {
    const line = document.createElement('div');
    line.className = 'console-line';

    let color = '#10b981';
    if (type === 'error') color = '#f43f5e';
    if (type === 'warn') color = '#fbbf24';
    if (type === 'cmd') color = '#6366f1';

    line.innerHTML = `<span class="console-time">[${time}]</span> <span style="color: ${color}">${msg}</span>`;
    consoleDiv.appendChild(line);
    consoleDiv.scrollTop = consoleDiv.scrollHeight;
}

startBtn.addEventListener('click', () => {
    const config = {
        roomUrl: roomUrlInput.value,
        authData: authDataInput.value,
        botName: botNameInput.value
    };

    if (!config.roomUrl || !config.authData) {
        alert('Room URL and Auth Data are required!');
        return;
    }

    localStorage.setItem('authData', config.authData);
    localStorage.setItem('botName', config.botName);

    socket.emit('start-bot', config);
});

stopBtn.addEventListener('click', () => {
    socket.emit('stop-bot');
});

sendCmdBtn.addEventListener('click', () => {
    const cmd = cmdInput.value;
    if (!cmd) return;
    socket.emit('send-command', cmd);
    cmdInput.value = '';
});

cmdInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendCmdBtn.click();
});

volumeRange.addEventListener('input', (e) => {
    socket.emit('set-volume', e.target.value);
});

skipBtn.addEventListener('click', () => {
    socket.emit('send-command', '!skip');
});

stopMusicBtn.addEventListener('click', () => {
    socket.emit('send-command', '!stop');
});

socket.on('bot-log', (data) => {
    addLog(data.msg, data.type, data.time);
});

socket.on('bot-status', (state) => {
    statusText.innerText = state.status;
    statusBadge.className = 'status-badge ' + state.status.toLowerCase();

    if (state.status === 'ONLINE') {
        startBtn.classList.add('hidden');
        stopBtn.classList.remove('hidden');
    } else if (state.status === 'OFFLINE') {
        startBtn.classList.remove('hidden');
        stopBtn.classList.add('hidden');
    }

    if (state.currentSong) {
        songTitle.innerText = state.currentSong.title;
        songStatus.innerText = state.isPlaying ? 'Playing' : 'Paused';
    } else {
        songTitle.innerText = 'Nothing playing';
        songStatus.innerText = 'Idle';
    }

    volumeRange.value = state.volume;
});
