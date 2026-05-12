const TRIGGERS = [
  { time: '07:30', reason: '早上好，该起床了，来点轻快的音乐开启新一天' },
  { time: '09:00', reason: '上午学习时间到了，需要专注背景音乐' },
  { time: '12:00', reason: '中午了，休息一下充个电' },
  { time: '14:00', reason: '下午学习时间，来点提神的音乐' },
  { time: '18:00', reason: '傍晚了，学习辛苦了，放松一下吧' },
  { time: '21:00', reason: '夜深了，来首安静的歌陪你' },
];

let interval = null;
let triggered = new Set();
let onTrigger = null;
let currentDate = null;

function tick() {
  const now = new Date();
  const today = now.toDateString();

  // New day — reset triggered set
  if (today !== currentDate) {
    triggered.clear();
    currentDate = today;
  }

  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  for (const t of TRIGGERS) {
    if (hhmm === t.time && !triggered.has(t.time)) {
      triggered.add(t.time);
      onTrigger?.(t.reason);
    }
  }
}

export function start(callback) {
  onTrigger = callback;
  triggered.clear();
  currentDate = new Date().toDateString();

  tick(); // run immediately on start
  interval = setInterval(tick, 60_000);
}

export function stop() {
  if (interval) {
    clearInterval(interval);
    interval = null;
  }
}

export function getSchedule() {
  return TRIGGERS.map((t) => ({
    time: t.time,
    reason: t.reason,
    triggered: triggered.has(t.time),
  }));
}
