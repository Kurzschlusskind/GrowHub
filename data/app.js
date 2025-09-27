const wsUrl = `ws://${location.host}/ws`;
let ws;
let currentState = {
  ch1: 0,
  ch2: 0,
  raw: [0, 0, 0, 0, 0],
  allowTx: false,
  heartbeatEnabled: false,
  heartbeatInterval: 2000,
  mapping: [],
  identityMode: false,
  presets: [],
  logs: []
};

const ch1Slider = document.getElementById('ch1Slider');
const ch2Slider = document.getElementById('ch2Slider');
const ch1Value = document.getElementById('ch1Value');
const ch2Value = document.getElementById('ch2Value');
const ch1Raw = document.getElementById('ch1Raw');
const ch2Raw = document.getElementById('ch2Raw');
const sendBtn = document.getElementById('sendBtn');
const allowTx = document.getElementById('allowTx');
const hbInterval = document.getElementById('hbInterval');
const toggleHeartbeat = document.getElementById('toggleHeartbeat');
const presetList = document.getElementById('presetList');
const presetName = document.getElementById('presetName');
const savePreset = document.getElementById('savePreset');
const identityMode = document.getElementById('identityMode');
const mappingTableBody = document.querySelector('#mappingTable tbody');
const addPoint = document.getElementById('addPoint');
const saveMapping = document.getElementById('saveMapping');
const logView = document.getElementById('log');
const lastFrame = document.getElementById('lastFrame');

function connectWs() {
  ws = new WebSocket(wsUrl);
  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'requestState' }));
  };
  ws.onmessage = event => {
    const data = JSON.parse(event.data);
    if (data.type === 'sent') {
      lastFrame.textContent = data.frame + (data.dryRun ? ' (dry)' : '');
    } else if (data.type === 'parsed') {
      appendLog(`RX ${data.rawHex} sum=${data.receivedSum} valid=${data.sumValid}`);
    } else if (data.type === 'log') {
      appendLog(data.message);
    } else if (data.type === 'logSnapshot') {
      logView.textContent = data.logs.join('\n');
    } else if (data.type === 'state') {
      currentState = data;
      updateUi();
      logView.textContent = (data.logs || []).join('\n');
    }
  };
  ws.onclose = () => {
    setTimeout(connectWs, 2000);
  };
}

function updateUi() {
  ch1Slider.value = Math.round(currentState.ch1 || 0);
  ch2Slider.value = Math.round(currentState.ch2 || 0);
  ch1Value.textContent = Number(currentState.ch1 || 0).toFixed(1);
  ch2Value.textContent = Number(currentState.ch2 || 0).toFixed(1);
  ch1Raw.textContent = currentState.raw ? currentState.raw[0] : 0;
  ch2Raw.textContent = currentState.raw ? currentState.raw[1] : 0;
  allowTx.checked = !!currentState.allowTx;
  hbInterval.value = currentState.heartbeatInterval || 2000;
  toggleHeartbeat.textContent = currentState.heartbeatEnabled ? 'Heartbeat stoppen' : 'Heartbeat starten';
  identityMode.checked = !!currentState.identityMode;
  renderPresets(currentState.presets || []);
  renderMapping(currentState.mapping || []);
}

function renderPresets(presets) {
  presetList.innerHTML = '';
  presets.forEach(preset => {
    const li = document.createElement('li');
    li.textContent = `${preset.name}: ${preset.ch1}% / ${preset.ch2}%`;
    const loadBtn = document.createElement('button');
    loadBtn.textContent = 'Laden';
    loadBtn.onclick = () => ws.send(JSON.stringify({ type: 'loadPreset', name: preset.name }));
    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = 'Löschen';
    deleteBtn.onclick = () => ws.send(JSON.stringify({ type: 'deletePreset', name: preset.name }));
    li.appendChild(loadBtn);
    li.appendChild(deleteBtn);
    presetList.appendChild(li);
  });
}

function renderMapping(points) {
  mappingTableBody.innerHTML = '';
  points.forEach((point, index) => {
    const tr = document.createElement('tr');
    const percentTd = document.createElement('td');
    const percentInput = document.createElement('input');
    percentInput.type = 'number';
    percentInput.value = point.percent;
    percentInput.min = 0;
    percentInput.max = 100;
    percentTd.appendChild(percentInput);

    const rawTd = document.createElement('td');
    const rawInput = document.createElement('input');
    rawInput.type = 'number';
    rawInput.value = point.raw;
    rawInput.min = 0;
    rawInput.max = 255;
    rawTd.appendChild(rawInput);

    const actionTd = document.createElement('td');
    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = '✕';
    deleteBtn.onclick = () => {
      mappingTableBody.removeChild(tr);
    };
    actionTd.appendChild(deleteBtn);

    tr.appendChild(percentTd);
    tr.appendChild(rawTd);
    tr.appendChild(actionTd);
    mappingTableBody.appendChild(tr);
  });
}

function gatherMapping() {
  const rows = mappingTableBody.querySelectorAll('tr');
  const points = [];
  rows.forEach(row => {
    const percent = parseFloat(row.children[0].firstChild.value);
    const raw = parseInt(row.children[1].firstChild.value, 10);
    if (!isNaN(percent) && !isNaN(raw)) {
      points.push({ percent, raw });
    }
  });
  points.sort((a, b) => a.percent - b.percent);
  return points;
}

function appendLog(message) {
  const lines = logView.textContent.split('\n').filter(l => l);
  lines.push(message);
  while (lines.length > 1000) {
    lines.shift();
  }
  logView.textContent = lines.join('\n');
}

ch1Slider.addEventListener('input', () => {
  ws.send(JSON.stringify({ type: 'setChannels', ch1: Number(ch1Slider.value), ch2: Number(ch2Slider.value) }));
});
ch2Slider.addEventListener('input', () => {
  ws.send(JSON.stringify({ type: 'setChannels', ch1: Number(ch1Slider.value), ch2: Number(ch2Slider.value) }));
});

sendBtn.addEventListener('click', () => {
  ws.send(JSON.stringify({ type: 'sendOnce' }));
});

allowTx.addEventListener('change', () => {
  ws.send(JSON.stringify({ type: 'toggleTx', allow: allowTx.checked }));
});

hbInterval.addEventListener('change', () => {
  ws.send(JSON.stringify({ type: 'setHeartbeatInterval', interval: Number(hbInterval.value) }));
});

toggleHeartbeat.addEventListener('click', () => {
  ws.send(JSON.stringify({ type: 'toggleHeartbeat', enabled: !currentState.heartbeatEnabled }));
});

savePreset.addEventListener('click', () => {
  if (!presetName.value) return;
  ws.send(JSON.stringify({
    type: 'savePreset',
    name: presetName.value,
    ch1: Number(ch1Slider.value),
    ch2: Number(ch2Slider.value)
  }));
});

identityMode.addEventListener('change', () => {
  ws.send(JSON.stringify({ type: 'updateMapping', identity: identityMode.checked, points: gatherMapping() }));
});

addPoint.addEventListener('click', () => {
  const tr = document.createElement('tr');
  const percentTd = document.createElement('td');
  const percentInput = document.createElement('input');
  percentInput.type = 'number';
  percentInput.value = 50;
  percentInput.min = 0;
  percentInput.max = 100;
  percentTd.appendChild(percentInput);

  const rawTd = document.createElement('td');
  const rawInput = document.createElement('input');
  rawInput.type = 'number';
  rawInput.value = 128;
  rawInput.min = 0;
  rawInput.max = 255;
  rawTd.appendChild(rawInput);

  const actionTd = document.createElement('td');
  const deleteBtn = document.createElement('button');
  deleteBtn.textContent = '✕';
  deleteBtn.onclick = () => mappingTableBody.removeChild(tr);
  actionTd.appendChild(deleteBtn);

  tr.appendChild(percentTd);
  tr.appendChild(rawTd);
  tr.appendChild(actionTd);
  mappingTableBody.appendChild(tr);
});

saveMapping.addEventListener('click', () => {
  ws.send(JSON.stringify({ type: 'updateMapping', identity: identityMode.checked, points: gatherMapping() }));
});

connectWs();
