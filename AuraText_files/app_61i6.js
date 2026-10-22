const API_BASE = location.protocol === "file:" ? "http://localhost:8000" : (location.port === "3000" ? `${location.protocol}//${location.hostname}:8000` : "");
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
// 本地测试临时开关：true 时 DashScope API-KEY 以明文提交到后端，仅保存在当前 Token 的内存会话中。公网部署前改回 false。
const ALLOW_PLAINTEXT_API_KEY = true;

const els = {
  loginOverlay: document.getElementById("loginOverlay"),
  loginForm: document.getElementById("loginForm"),
  passwordInput: document.getElementById("passwordInput"),
  loginError: document.getElementById("loginError"),
  themeToggle: document.getElementById("themeToggle"),
  retranslateBtn: document.getElementById("retranslateBtn"),
  historyToggle: document.getElementById("historyToggle"),
  themeIcon: document.getElementById("themeIcon"),
  uploadCard: document.getElementById("uploadCard"),
  localMode: document.getElementById("localMode"),
  cloudMode: document.getElementById("cloudMode"),
  apiConfig: document.getElementById("apiConfig"),
  providerSelect: document.getElementById("providerSelect"),
  dashScopeField: document.getElementById("dashScopeField"),
  groqField: document.getElementById("groqField"),
  dashScopeApiKey: document.getElementById("dashScopeApiKey"),
  groqApiKey: document.getElementById("groqApiKey"),
  toggleSecretDash: document.getElementById("toggleSecretDash"),
  toggleSecretGroq: document.getElementById("toggleSecretGroq"),
  saveApiKey: document.getElementById("saveApiKey"),
  serverKeyHint: document.getElementById("serverKeyHint"),
  uploadZone: document.getElementById("uploadZone"),
  uploadTitle: document.getElementById("uploadTitle"),
  uploadHint: document.getElementById("uploadHint"),
  fileInput: document.getElementById("fileInput"),
  progressBox: document.getElementById("progressBox"),
  progressText: document.getElementById("progressText"),
  progressPercent: document.getElementById("progressPercent"),
  progressBar: document.getElementById("progressBar"),
  progressHint: document.getElementById("progressHint"),
  historyPanel: document.getElementById("historyPanel"),
  historyList: document.getElementById("historyList"),
  clearHistory: document.getElementById("clearHistory"),
  workspace: document.getElementById("workspace"),
  mediaFrame: document.getElementById("mediaFrame"),
  playToggle: document.getElementById("playToggle"),
  timeLabel: document.getElementById("timeLabel"),
  seekBar: document.getElementById("seekBar"),
  lyricsScroll: document.getElementById("lyricsScroll"),
  languageLabel: document.getElementById("languageLabel"),
  lineCount: document.getElementById("lineCount"),
  exportLrc: document.getElementById("exportLrc"),
  exportSrt: document.getElementById("exportSrt"),
  copyText: document.getElementById("copyText"),
  newFile: document.getElementById("newFile"),
  toast: document.getElementById("toast"),
  lyricsList: document.getElementById("lyricsList"),
  followBtn: document.getElementById("followBtn"),
  fontSettingsBtn: document.getElementById("fontSettingsBtn"),
  fontSettingsPopover: document.getElementById("fontSettingsPopover"),
  mainFontSizeRange: document.getElementById("mainFontSizeRange"),
  mainFontSizeVal: document.getElementById("mainFontSizeVal"),
  transFontSizeRange: document.getElementById("transFontSizeRange"),
  transFontSizeVal: document.getElementById("transFontSizeVal"),
};

let token = localStorage.getItem("smartLyricsToken") || "";
let currentTaskId = "";
let currentRecordId = "";
let currentFileUrl = "";
let currentMedia = null;
let segments = [];
let activeIndex = -1;
let pollTimer = null;
let scrollTimer = null;
let userIsViewing = false;
let userSeeking = false;
let autoScrolling = false;
let selectedMode = "local";
let sessionApiKeyConfigured = false;
let failedPolls = 0;
let loadedHistory = null;
let scrollIntent = "idle";
let scrollReleaseTimer = null;
let activeWordKey = "";

function initTheme() {
  const isDark = localStorage.getItem("smartLyricsTheme") === "dark";
  document.body.classList.toggle("dark", isDark);
  els.themeIcon.textContent = isDark ? "☀" : "☾";
}

function initFontSettings() {
  const savedMainSize = localStorage.getItem('mainFontSize') || '24';
  const savedTransSize = localStorage.getItem('transFontSize') || '14';
  if(els.mainFontSizeRange) els.mainFontSizeRange.value = savedMainSize;
  if(els.mainFontSizeVal) els.mainFontSizeVal.textContent = savedMainSize;
  if(els.transFontSizeRange) els.transFontSizeRange.value = savedTransSize;
  if(els.transFontSizeVal) els.transFontSizeVal.textContent = savedTransSize;
  document.documentElement.style.setProperty('--main-lyric-size', `${savedMainSize}px`);
  document.documentElement.style.setProperty('--trans-lyric-size', `${savedTransSize}px`);
}

function toggleTheme() {
  const isDark = document.body.classList.toggle("dark");
  els.themeIcon.textContent = isDark ? "☀" : "☾";
  localStorage.setItem("smartLyricsTheme", isDark ? "dark" : "light");
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => els.toast.classList.remove("show"), 2600);
}

function authHeaders() {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function apiFetch(path, options = {}) {
  const headers = { ...(options.headers || {}), ...authHeaders() };
  const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (response.status === 401) {
    logout();
    throw new Error("登录已过期，请重新登录");
  }
  if (!response.ok) {
    let detail = "请求失败";
    try {
      const data = await response.json();
      detail = data.detail || detail;
    } catch (error) {
      detail = response.statusText || detail;
    }
    throw new Error(detail);
  }
  return response;
}

function logout() {
  token = "";
  localStorage.removeItem("smartLyricsToken");
  els.loginOverlay.classList.remove("hidden");
}

function enterApp() {
  els.loginOverlay.classList.add("hidden");
}

function updateProgress(percent, message, hint = "请保持页面打开", elapsed = null, eta = null) {
  const value = Math.max(0, Math.min(100, Math.round(percent)));
  els.progressBox.classList.remove("hidden");
  els.progressHint.classList.remove("error");
  els.progressText.textContent = message;
  els.progressPercent.textContent = `${value}%`;
  if (els.progressBar) els.progressBar.style.width = `${value}%`;
  const timing = elapsed !== null ? `耗时 ${elapsed} 秒，预计还需 ${eta ?? "--"} 秒` : hint;
  els.progressHint.textContent = timing;
}


function resetUploadText() {
  els.uploadTitle.textContent = "拖拽或点击上传音频/视频文件";
  els.uploadHint.textContent = "支持 MP3、WAV、FLAC、AAC、MP4、MKV、WebM，最大 100MB";
}

function resetUi(options = {}) {
  if (currentFileUrl && currentFileUrl.startsWith("blob:")) {
    URL.revokeObjectURL(currentFileUrl);
  }
  currentTaskId = "";
  currentFileUrl = "";
  currentMedia = null;
  if (!options.keepHistory) {
    loadedHistory = null;
    segments = [];
  }
  activeIndex = -1;
  activeWordKey = "";
  scrollIntent = "idle";
  autoScrolling = false;
  clearTimeout(pollTimer);
  clearTimeout(scrollTimer);
  clearTimeout(scrollReleaseTimer);
  els.fileInput.value = "";
  els.mediaFrame.innerHTML = "";
  els.lyricsScroll.innerHTML = "";
  els.uploadCard.classList.remove("hidden");
  els.progressBox.classList.add("hidden");
  els.workspace.classList.add("hidden");
  els.playToggle.classList.remove("is-playing");
  els.seekBar.value = "0";
  els.timeLabel.textContent = "00:00 / 00:00";
  els.exportLrc.disabled = false;
  els.exportSrt.disabled = false;
  if (!options.keepHistory) {
    resetUploadText();
  }
}

function formatClock(seconds) {
  if (!Number.isFinite(seconds)) {
    return "00:00";
  }
  const total = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function estimateRemaining(progress, duration) {
  const safeProgress = Math.max(progress, 5);
  const base = duration > 0 ? duration * 0.45 : 40;
  const remaining = Math.max(5, Math.round(base * (100 - safeProgress) / 100));
  return `预计还需 ${remaining} 秒`;
}

function isVideoFile(file) {
  if (!file) return false;
  const name = file.name.toLowerCase();
  return file.type.startsWith("video/") || [".mp4", ".mkv", ".webm"].some((ext) => name.endsWith(ext));
}

async function handleFile(file) {
  if (!file) {
    return;
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    showToast("文件超过 100MB 限制");
    return;
  }

  const historyForPlayback = loadedHistory;
  resetUi({ keepHistory: Boolean(historyForPlayback) });
  currentFileUrl = URL.createObjectURL(file);

  if (historyForPlayback?.segments?.length) {
    setupResult(file, historyForPlayback, { fromHistory: true });
    showToast("已加载历史歌词，请开始播放");
    return;
  }

  els.progressBox.classList.remove("hidden");
  updateProgress(1, "正在上传文件", "上传完成后会自动开始识别");

  const formData = new FormData();
  formData.append("file", file);
  formData.append("mode", selectedMode);
  formData.append("provider", els.providerSelect.value);

  try {
    const response = await apiFetch("/api/transcribe", {
      method: "POST",
      body: formData,
    });
    const data = await response.json();
    currentTaskId = data.task_id;
    updateProgress(5, "任务已提交", estimateRemaining(5, data.duration || 0));
    failedPolls = 0;
    pollTask(file, data.duration || 0);
  } catch (error) {
    showToast(error.message);
    updateProgress(0, "识别未开始", error.message);
  }
}

async function pollTask(file, duration) {
  try {
    const response = await apiFetch(`/api/status/${currentTaskId}`);
    const data = await response.json();
    const progress = data.progress || 0;
    const queueText = data.queue_position ? `排队中，第 ${data.queue_position} 位` : data.message;
    updateProgress(progress, queueText, estimateRemaining(progress, duration), data.elapsed ?? null, data.eta ?? null);

    if (data.status === "completed") {
      setupResult(file, data.result);
      return;
    }
    if (data.status === "failed") {
      updateProgress(progress, "识别失败", data.message || "请稍后重试");
      showToast(data.message || "识别失败");
      return;
    }
    failedPolls = 0;
    pollTimer = setTimeout(() => pollTask(file, duration), 1000);
  } catch (error) {
    failedPolls += 1;
    const currentProgress = Number.parseInt(els.progressPercent.textContent, 10) || 0;
    if (failedPolls >= 10) {
      updateProgress(currentProgress, "网络连接断开", "网络连接断开，已停止查询，请刷新页面重试");
      els.progressHint.classList.add("error");
      showToast("网络连接断开，已停止查询");
      return;
    }
    if (failedPolls >= 3) {
      updateProgress(currentProgress, "网络连接异常，正在重试...", error.message);
      pollTimer = setTimeout(() => pollTask(file, duration), 1000);
      return;
    }
    showToast(error.message);
    pollTimer = setTimeout(() => pollTask(file, duration), 1000);
  }
}

function setupResult(file, result, options = {}) {
  const isRetranslate = !file && !options.fromHistory;
  
  segments = result.segments || [];
  currentTaskId = options.fromHistory ? "" : (result.task_id || currentTaskId);
  currentRecordId = result.history_id || result.id || (options.fromHistory ? loadedHistory.id : null);
  loadedHistory = options.fromHistory ? result : null;
  els.uploadCard.classList.add("hidden");
  els.workspace.classList.remove("hidden");
  
  const isNonChinese = result.language && result.language.toLowerCase() !== "zh";
  if (els.retranslateBtn) {
    els.retranslateBtn.style.display = isNonChinese ? "inline-block" : "none";
  }
  
  els.languageLabel.textContent = `语言：${result.language || "自动检测"}`;
  els.lineCount.textContent = `${segments.length} 行`;
  els.exportLrc.disabled = false;
  els.exportSrt.disabled = false;

  if (isRetranslate) {
    renderLyrics();
    showToast("重新翻译完成");
    return;
  }

  const isVideo = isVideoFile(file);
  const media = document.createElement(isVideo ? "video" : "audio");
  if (options.mediaUrl) {
    currentFileUrl = options.mediaUrl;
  }
  media.src = currentFileUrl;
  media.controls = false;
  media.preload = "metadata";
  if (isVideo) {
    media.playsInline = true;
  }
  els.mediaFrame.innerHTML = "";
  els.mediaFrame.classList.toggle("audio-mode", !isVideo);
  els.mediaFrame.appendChild(media);
  if (!isVideo) {
    els.mediaFrame.appendChild(createVinylPlayer());
  }
  currentMedia = media;

  renderLyrics();
  bindMediaEvents();
  showToast(options.fromHistory ? "历史歌词已加载" : "识别完成");
  if (!options.fromHistory) {
    loadHistoryList(false);
  }
}

function createVinylPlayer() {
  const stage = document.createElement("div");
  stage.className = "vinyl-stage";

  const record = document.createElement("div");
  record.className = "vinyl-record";

  const cover = document.createElement("img");
  cover.className = "vinyl-cover";
  cover.alt = "唱片封面";
  cover.referrerPolicy = "no-referrer";
  cover.src = `https://t.alcy.cc/ycy?${Date.now()}`;

  const shine = document.createElement("span");
  shine.className = "vinyl-shine";

  record.appendChild(cover);
  record.appendChild(shine);
  stage.appendChild(record);
  return stage;
}

function splitFallbackWords(text) {
  const source = String(text || "").trim();
  if (!source) {
    return [];
  }
  if (/\s/.test(source)) {
    return source.split(/\s+/).filter(Boolean);
  }
  return Array.from(source);
}

function cleanWordLabel(value) {
  if (typeof value === "string" || typeof value === "number") {
    return String(value).trim();
  }
  if (Array.isArray(value)) {
    return value.map(cleanWordLabel).join("").trim();
  }
  if (value && typeof value === "object") {
    return cleanWordLabel(value.word ?? value.text ?? value.Word ?? value.Text ?? "");
  }
  return "";
}

function normalizeWordTime(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return NaN;
  }
  return number;
}

function wordsForSegment(segment) {
  if (Array.isArray(segment.words) && segment.words.length) {
    const timedWords = segment.words
      .map((item) => ({
        word: cleanWordLabel(item?.word ?? item?.text ?? item),
        start: normalizeWordTime(item?.start ?? item?.begin_time),
        end: normalizeWordTime(item?.end ?? item?.end_time),
        estimated: false,
      }))
      .filter((item) => item.word && Number.isFinite(item.start) && Number.isFinite(item.end));
    if (timedWords.length) {
      return timedWords;
    }
  }
  const tokens = splitFallbackWords(cleanWordLabel(segment.text));
  const span = Math.max(0.1, Number(segment.end) - Number(segment.start));
  return tokens.map((word, index) => {
    const start = Number(segment.start) + (span * index) / Math.max(1, tokens.length);
    const end = Number(segment.start) + (span * (index + 1)) / Math.max(1, tokens.length);
    return { word, start, end, estimated: true };
  });
}

function renderLyrics() {
  els.lyricsScroll.innerHTML = "";
  if (!segments.length) {
    const empty = document.createElement("div");
    empty.className = "lyric-line empty-line";
    empty.textContent = "未识别到可用文本";
    els.lyricsScroll.appendChild(empty);
    return;
  }
  segments.forEach((segment, index) => {
    const line = document.createElement("div");
    line.className = "lyric-line future";
    line.dataset.index = String(index);

    const wordsWrap = document.createElement("div");
    wordsWrap.className = "words-wrap";
    const words = wordsForSegment(segment);
    words.forEach((word, wordIndex) => {
      const block = document.createElement("span");
      block.className = "word-block";
      block.dataset.index = String(index);
      block.dataset.wordIndex = String(wordIndex);
      block.dataset.start = String(word.start);
      block.dataset.end = String(word.end);
      if (word.estimated) {
        block.dataset.estimated = "true";
      }

      const top = document.createElement("span");
      top.className = "ruby-top";
      top.textContent = " ";

      const ruby = document.createElement("ruby");
      ruby.className = "word-main";
      ruby.appendChild(document.createTextNode(word.word));
      const rt = document.createElement("rt");
      rt.textContent = " ";
      ruby.appendChild(rt);

      const bottom = document.createElement("span");
      bottom.className = "ruby-bottom";
      bottom.textContent = " ";

      const highlighter = document.createElement("span");
      highlighter.className = "highlighter";

      block.appendChild(top);
      block.appendChild(ruby);
      block.appendChild(bottom);
      block.appendChild(highlighter);
      wordsWrap.appendChild(block);
    });

    line.appendChild(wordsWrap);

    if (segment.translation) {
      const transWrap = document.createElement("div");
      transWrap.className = "lyric-translation";
      transWrap.textContent = segment.translation;
      line.appendChild(transWrap);
    }

    line.addEventListener("click", () => seekToSegment(index, true));
    els.lyricsScroll.appendChild(line);
  });
}

function setVinylPlaying(isPlaying) {
  const record = els.mediaFrame.querySelector(".vinyl-record");
  if (record) {
    record.style.animationPlayState = isPlaying ? "running" : "paused";
  }
}

function bindMediaEvents() {
  currentMedia.addEventListener("play", () => {
    els.playToggle.classList.add("is-playing");
    els.lyricsScroll.classList.add("playing");
    els.lyricsScroll.classList.remove("paused");
    setVinylPlaying(true);
  });
  currentMedia.addEventListener("pause", () => {
    els.playToggle.classList.remove("is-playing");
    els.lyricsScroll.classList.add("paused");
    els.lyricsScroll.classList.remove("playing");
    setVinylPlaying(false);
  });
  currentMedia.addEventListener("ended", () => setVinylPlaying(false));
  currentMedia.addEventListener("loadedmetadata", updateTimeUi);
  currentMedia.addEventListener("timeupdate", () => {
    updateTimeUi();
    const LOOKAHEAD_LINE = 0.2; // 提前 200ms 让整行先亮起准备
    const LOOKAHEAD_WORD = 0.05; // 单词只提前 50ms 补偿浏览器延迟，防止跳词
    syncActiveLine(currentMedia.currentTime + LOOKAHEAD_LINE);
    syncActiveWord(currentMedia.currentTime + LOOKAHEAD_WORD);
  });
}

function updateTimeUi() {
  if (!currentMedia) {
    return;
  }
  const duration = currentMedia.duration || 0;
  els.timeLabel.textContent = `${formatClock(currentMedia.currentTime)} / ${formatClock(duration)}`;
  if (!userSeeking && duration > 0) {
    els.seekBar.value = String(Math.round((currentMedia.currentTime / duration) * 1000));
  }
}

function findSegmentIndex(time) {
  if (!segments.length) {
    return -1;
  }
  let fallback = 0;
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (time >= segment.start && time < segment.end) {
      return index;
    }
    if (time >= segment.start) {
      fallback = index;
    }
  }
  return fallback;
}

function markAutoScrolling() {
  autoScrolling = true;
  scrollIntent = "auto";
  clearTimeout(scrollReleaseTimer);
  scrollReleaseTimer = setTimeout(() => {
    autoScrolling = false;
    if (scrollIntent === "auto") {
      scrollIntent = "idle";
    }
  }, 1000);
}

function syncActiveLine(time, options = {}) {
  const index = findSegmentIndex(time);
  if (index === activeIndex || index < 0) {
    if (options.forceScroll && activeIndex >= 0) {
      const active = els.lyricsScroll.querySelector(`[data-index="${activeIndex}"]`);
      if (active) {
        markAutoScrolling();
        const container = els.lyricsScroll;
        const targetScrollTop = active.offsetTop - container.clientHeight * 0.35;
        container.scrollTo({ top: targetScrollTop, behavior: "smooth" });
      }
    }
    return;
  }
  activeIndex = index;
  document.querySelectorAll(".lyric-line").forEach((line) => {
    const lineIndex = Number(line.dataset.index);
    line.classList.remove("active", "past", "future");
    if (Number.isFinite(lineIndex)) {
      line.classList.add(lineIndex < index ? "past" : lineIndex > index ? "future" : "active");
    }
  });
  const active = els.lyricsScroll.querySelector(`[data-index="${index}"]`);
  if (active && (!userIsViewing || options.forceScroll) && !options.skipScroll) {
    active.classList.add("active");
    markAutoScrolling();
    
    // Instead of active.scrollIntoView({ block: "center" }), we manually calculate the scroll top
    // so that the TOP of the element is near 35% of the container height, preventing tall elements from being blocked
    const container = els.lyricsScroll;
    const targetScrollTop = active.offsetTop - container.clientHeight * 0.35;
    container.scrollTo({ top: targetScrollTop, behavior: "smooth" });
  } else if (active) {
    active.classList.add("active");
  }
}

function syncActiveWord(time) {
  if (activeIndex < 0) {
    return;
  }
  const line = els.lyricsScroll.querySelector(`.lyric-line[data-index="${activeIndex}"]`);
  if (!line) {
    return;
  }
  let current = null;
  line.querySelectorAll(".word-block").forEach((block) => {
    const start = Number(block.dataset.start);
    const end = Number(block.dataset.end);
    if (!current && Number.isFinite(start) && Number.isFinite(end) && time >= start && time < end) {
      current = block;
    }
  });
  const key = current ? `${activeIndex}:${current.dataset.wordIndex}` : "";
  if (key === activeWordKey) {
    return;
  }
  activeWordKey = key;
  els.lyricsScroll.querySelectorAll(".word-block.playing").forEach((block) => block.classList.remove("playing"));
  if (current) {
    current.classList.add("playing");
    
    if (!userIsViewing) {
      const container = els.lyricsScroll;
      // Follow the word down if it wraps!
      const targetScrollTop = line.offsetTop + current.offsetTop - container.clientHeight * 0.35;
      markAutoScrolling();
      container.scrollTo({ top: targetScrollTop, behavior: "smooth" });
    }
  }
}

function seekToSegment(index, shouldPlay) {
  if (!currentMedia || !segments[index]) {
    return;
  }
  userIsViewing = false;
  if (els.followBtn) els.followBtn.classList.add("hidden");
  
  currentMedia.currentTime = Math.max(0, segments[index].start);
  syncActiveLine(currentMedia.currentTime, { forceScroll: true });
  if (shouldPlay) {
    currentMedia.play().catch(() => showToast("浏览器阻止了自动播放，请手动点击播放"));
  }
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.round(seconds || 0));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value || "--";
  }
  return date.toLocaleString();
}

async function loadHistoryList(showPanel = true) {
  try {
    const response = await apiFetch("/api/history?page=1&page_size=20");
    const data = await response.json();
    renderHistoryList(data.items || []);
    if (showPanel) {
      els.historyPanel.classList.toggle("hidden");
    }
  } catch (error) {
    showToast(error.message);
  }
}

function renderHistoryList(items) {
  els.historyList.innerHTML = "";
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "history-empty";
    empty.textContent = "暂无历史记录";
    els.historyList.appendChild(empty);
    return;
  }
  items.forEach((item) => {
    const row = document.createElement("div");
    row.className = "history-item";

    const main = document.createElement("button");
    main.className = "history-main";
    main.type = "button";
    main.innerHTML = `
      <strong></strong>
      <span>${formatDuration(item.duration)} · ${item.language || "auto"} · ${item.engine || "local"} · ${formatDateTime(item.created_at)}</span>
    `;
    main.querySelector("strong").textContent = item.filename || "未命名文件";
    main.addEventListener("click", () => loadHistoryRecord(item.id));

    const del = document.createElement("button");
    del.className = "history-delete";
    del.type = "button";
    del.textContent = "删除";
    del.addEventListener("click", () => deleteHistoryRecord(item.id));

    row.appendChild(main);
    row.appendChild(del);
    els.historyList.appendChild(row);
  });
}

async function loadHistoryRecord(id) {
  try {
    const response = await apiFetch(`/api/history/${id}`);
    loadedHistory = await response.json();
    segments = loadedHistory.segments || [];
    
    if (loadedHistory.media_filename) {
      // Direct playback from server
      els.historyPanel.classList.add("hidden");
      const mediaUrl = `${API_BASE}/api/media/${loadedHistory.media_filename}`;
      const fakeFile = { 
        name: loadedHistory.media_filename,
        type: loadedHistory.media_filename.endsWith(".mp4") || loadedHistory.media_filename.endsWith(".webm") ? "video/mp4" : "audio/mpeg" 
      };
      setupResult(fakeFile, loadedHistory, { fromHistory: true, mediaUrl: mediaUrl });
      showToast("已自动加载媒体，可直接播放");
    } else {
      resetUi({ keepHistory: true });
      els.historyPanel.classList.add("hidden");
      els.uploadCard.classList.remove("hidden");
      els.progressBox.classList.add("hidden");
      els.uploadTitle.textContent = "请上传对应的音频/视频文件以播放";
      els.uploadHint.textContent = `已加载历史歌词：${loadedHistory.filename || "未命名文件"}，上传媒体后无需重新识别`;
      showToast("历史歌词已载入，媒体文件已被清理，需重新上传");
    }
  } catch (error) {
    showToast(error.message);
  }
}

async function deleteHistoryRecord(id) {
  if (!confirm("确定删除这条历史记录？")) {
    return;
  }
  try {
    await apiFetch(`/api/history/${id}`, { method: "DELETE" });
    showToast("历史记录已删除");
    loadHistoryList(false);
  } catch (error) {
    showToast(error.message);
  }
}

async function clearAllHistory() {
  if (!confirm("确定清空全部历史记录？")) {
    return;
  }
  if (!confirm("二次确认：此操作不可恢复，确定继续？")) {
    return;
  }
  try {
    await apiFetch("/api/history", { method: "DELETE" });
    loadedHistory = null;
    showToast("历史记录已清空");
    loadHistoryList(false);
  } catch (error) {
    showToast(error.message);
  }
}

function formatLrcTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const rest = seconds - mins * 60;
  return `${String(mins).padStart(2, "0")}:${rest.toFixed(2).padStart(5, "0")}`;
}

function formatSrtTime(seconds) {
  const totalMs = Math.round(seconds * 1000);
  const hours = Math.floor(totalMs / 3600000);
  const mins = Math.floor((totalMs % 3600000) / 60000);
  const secs = Math.floor((totalMs % 60000) / 1000);
  const ms = totalMs % 1000;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

function buildLocalExport(ext) {
  if (ext === "lrc") {
    return `${segments.map((seg) => `[${formatLrcTime(seg.start)}]${seg.text}${seg.translation ? '\\n[' + formatLrcTime(seg.start) + ']' + seg.translation : ''}`).join("\n")}\n`;
  }
  if (ext === "srt") {
    return `${segments.map((seg, index) => `${index + 1}\n${formatSrtTime(seg.start)} --> ${formatSrtTime(seg.end)}\n${seg.text}${seg.translation ? '\\n' + seg.translation : ''}`).join("\n\n")}\n`;
  }
  return `${segments.map((seg) => seg.text + (seg.translation ? '\n' + seg.translation : '')).join("\n")}\n`;
}

function saveTextFile(text, ext) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `lyrics.${ext}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function downloadExport(ext) {
  if (!segments.length) {
    showToast("暂无可导出的歌词");
    return;
  }
  if (!currentTaskId) {
    saveTextFile(buildLocalExport(ext), ext);
    return;
  }
  try {
    const response = await apiFetch(`/api/export/${currentTaskId}.${ext}`);
    const text = await response.text();
    saveTextFile(text, ext);
  } catch (error) {
    showToast(error.message);
  }
}

async function copyPlainText() {
  const text = segments.map((segment) => segment.text).join("\n");
  if (!text) {
    showToast("暂无可复制文本");
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    showToast("已复制纯文本");
  } catch (error) {
    showToast("复制失败，请检查浏览器权限");
  }
}


function setMode(mode) {
  selectedMode = mode;
  els.localMode.classList.toggle("active", mode === "local");
  els.cloudMode.classList.toggle("active", mode === "cloud");
  els.apiConfig.classList.toggle("hidden", mode !== "cloud");
  if (mode === "cloud") {
    loadHealthHint();
  }
}

async function loadHealthHint() {
  try {
    const response = token
      ? await apiFetch("/api/config/apikey/status")
      : await fetch(`${API_BASE}/api/health`);
    const data = await response.json();
    const serverConfigured = data.server_configured ?? data.engines?.cloud?.status === "configured";
    sessionApiKeyConfigured = Boolean(data.session_configured || sessionApiKeyConfigured);
    if (sessionApiKeyConfigured) {
      els.serverKeyHint.textContent = "本次会话已保存 DashScope API-KEY，可直接使用云端识别";
    } else if (serverConfigured) {
      els.serverKeyHint.textContent = "服务器已配置 DashScope API-KEY，可直接使用。如需覆盖，请在下方填入";
    } else {
      els.serverKeyHint.textContent = "服务器未配置 DashScope API-KEY，请在下方填写并保存到本次会话";
    }
  } catch (error) {
    els.serverKeyHint.textContent = "暂时无法检查服务器密钥配置";
  }
}

function pemToArrayBuffer(pem) {
  const base64 = pem.replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s/g, "");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

async function saveSessionApiKey() {
  const provider = els.providerSelect.value;
  const inputEl = provider === "groq" ? els.groqApiKey : els.dashScopeApiKey;
  const apiKey = inputEl.value.trim();
  if (!apiKey) {
    showToast(`请填写 ${provider} API-KEY`);
    return;
  }
  if (!ALLOW_PLAINTEXT_API_KEY && !window.crypto?.subtle) {
    showToast("当前页面不支持安全加密保存，请使用 HTTPS 或 localhost 访问");
    return;
  }

  const originalText = els.saveApiKey.textContent;
  els.saveApiKey.disabled = true;
  els.saveApiKey.textContent = ALLOW_PLAINTEXT_API_KEY ? "正在保存..." : "正在加密...";
  try {
    let payload;
    if (ALLOW_PLAINTEXT_API_KEY) {
      payload = {
        provider: els.providerSelect.value,
        api_key: apiKey,
      };
    } else {
      const keyResponse = await apiFetch("/api/crypto/pubkey");
      const keyData = await keyResponse.json();
      const publicKey = await crypto.subtle.importKey(
        "spki",
        pemToArrayBuffer(keyData.public_key),
        { name: "RSA-OAEP", hash: "SHA-256" },
        false,
        ["encrypt"],
      );
      const encrypted = await crypto.subtle.encrypt(
        { name: "RSA-OAEP" },
        publicKey,
        new TextEncoder().encode(apiKey),
      );
      payload = {
        provider: els.providerSelect.value,
        encrypted_secret: arrayBufferToBase64(encrypted),
      };
      els.saveApiKey.textContent = "正在保存...";
    }
    const response = await apiFetch("/api/config/apikey", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    sessionApiKeyConfigured = Boolean(data.session_configured || data.ok);
    inputEl.value = "";
    els.serverKeyHint.textContent = `本次会话已保存 ${provider} 密钥，可直接使用云端识别`;
    showToast(`${provider} API-KEY 已保存到本次会话`);
  } catch (error) {
    showToast(error.message);
  } finally {
    els.saveApiKey.disabled = false;
    els.saveApiKey.textContent = originalText;
  }
}

els.loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  els.loginError.textContent = "";
  const password = els.passwordInput.value;
  const formData = new FormData();
  formData.append("password", password);
  try {
    const response = await fetch(`${API_BASE}/api/auth`, { method: "POST", body: formData });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.detail || "验证失败");
    }
    token = data.token;
    localStorage.setItem("smartLyricsToken", token);
    localStorage.setItem("smartLyricsRole", data.role || "user");
    els.passwordInput.value = "";
    enterApp();
    loadHistoryList(false);
    checkAdmin();
  } catch (error) {
    els.loginError.textContent = error.message;
  }
});

function checkAdmin() {
  const urlParams = new URLSearchParams(window.location.search);
  const isAdminUrl = urlParams.get('admin') === '1';
  const role = localStorage.getItem("smartLyricsRole");
  
  if (isAdminUrl && role === 'admin') {
    document.getElementById("adminOverlay").classList.remove("hidden");
    loadAdminUsers();
  }
}

async function loadAdminUsers() {
  try {
    const response = await apiFetch("/api/admin/users");
    const data = await response.json();
    const listHtml = data.users.map(u => `
      <div style="border-bottom: 1px solid var(--border); padding: 8px 0; display: flex; justify-content: space-between; align-items: center;">
        <div>
          <strong>${u.id}</strong> <span style="font-size: 12px; color: var(--text-light)">(${u.role})</span><br>
          <span style="font-size: 12px; color: var(--text-light)">限制: ${u.max_upload_mb}MB / 每月 ${u.max_tasks_per_month} 次 (本月已用 ${u.used_tasks_this_month} 次)</span>
        </div>
        <div style="display: flex; gap: 8px;">
          ${u.role !== 'admin' ? `<button onclick="editAdminUser('${u.id}', ${u.max_upload_mb}, ${u.max_tasks_per_month})" style="background: var(--surface-soft); color: var(--text); padding: 4px 8px; font-size: 12px;">编辑</button>` : ''}
          ${u.role !== 'admin' ? `<button onclick="deleteAdminUser('${u.id}')" style="background: var(--error); padding: 4px 8px; font-size: 12px;">删除</button>` : ''}
        </div>
      </div>
    `).join('');
    document.getElementById("adminUserList").innerHTML = listHtml;
  } catch(e) {
    showToast("加载用户列表失败: " + e.message);
  }
}

window.deleteAdminUser = async function(userId) {
  if (!confirm(`确定要删除用户 ${userId} 吗？`)) return;
  try {
    await apiFetch(`/api/admin/users/${userId}`, { method: "DELETE" });
    showToast("已删除用户");
    loadAdminUsers();
  } catch(e) {
    showToast(e.message);
  }
}

window.editAdminUser = function(userId, mb, tasks) {
  const idEl = document.getElementById("newUserId");
  idEl.value = userId;
  idEl.readOnly = true;
  idEl.style.opacity = "0.7";
  document.getElementById("newUserMb").value = mb;
  document.getElementById("newUserTasks").value = tasks;
  const btn = document.querySelector("#adminAddUserForm button[type='submit']");
  btn.textContent = "保存修改";
  btn.style.background = "var(--highlight-blue, #3498db)";
}

document.getElementById("adminAddUserForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const idEl = document.getElementById("newUserId");
  const mb = document.getElementById("newUserMb").value;
  const tasks = document.getElementById("newUserTasks").value;
  try {
    if (idEl.readOnly) {
      await apiFetch(`/api/admin/users/${idEl.value}`, {
        method: "PUT",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({max_upload_mb: Number(mb), max_tasks_per_month: Number(tasks)})
      });
      showToast("修改成功");
    } else {
      await apiFetch("/api/admin/users", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({id: idEl.value, max_upload_mb: Number(mb), max_tasks_per_month: Number(tasks)})
      });
      showToast("添加成功");
    }
    document.getElementById("adminAddUserForm").reset();
    idEl.readOnly = false;
    idEl.style.opacity = "1";
    document.getElementById("newUserMb").value = 50;
    document.getElementById("newUserTasks").value = 10;
    const btn = document.querySelector("#adminAddUserForm button[type='submit']");
    btn.textContent = "添加用户";
    btn.style.background = "var(--surface)";
    loadAdminUsers();
  } catch(e) {
    showToast(e.message);
  }
});

document.getElementById("adminCloseBtn")?.addEventListener("click", () => {
  document.getElementById("adminOverlay").classList.add("hidden");
});


els.localMode.addEventListener("click", () => setMode("local"));
els.cloudMode.addEventListener("click", () => setMode("cloud"));

if (els.toggleSecretDash) {
  els.toggleSecretDash.addEventListener("click", () => {
    els.dashScopeApiKey.type = els.dashScopeApiKey.type === "password" ? "text" : "password";
  });
}
if (els.toggleSecretGroq) {
  els.toggleSecretGroq.addEventListener("click", () => {
    els.groqApiKey.type = els.groqApiKey.type === "password" ? "text" : "password";
  });
}

if (els.providerSelect) {
  els.providerSelect.addEventListener("change", () => {
    if (els.providerSelect.value === "groq") {
      els.dashScopeField.classList.add("hidden");
      els.groqField.classList.remove("hidden");
    } else {
      els.dashScopeField.classList.remove("hidden");
      els.groqField.classList.add("hidden");
    }
  });
}

els.saveApiKey.addEventListener("click", saveSessionApiKey);

els.historyToggle.addEventListener("click", () => loadHistoryList(true));
els.clearHistory.addEventListener("click", clearAllHistory);

els.themeToggle.addEventListener("click", toggleTheme);

if(els.fontSettingsBtn) {
  els.fontSettingsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    els.fontSettingsPopover.classList.toggle('hidden');
  });
  document.addEventListener('click', (e) => {
    if (!els.fontSettingsPopover.contains(e.target) && e.target !== els.fontSettingsBtn) {
      els.fontSettingsPopover.classList.add('hidden');
    }
  });
  els.mainFontSizeRange.addEventListener('input', (e) => {
    const v = e.target.value;
    els.mainFontSizeVal.textContent = v;
    document.documentElement.style.setProperty('--main-lyric-size', `${v}px`);
    localStorage.setItem('mainFontSize', v);
  });
  els.transFontSizeRange.addEventListener('input', (e) => {
    const v = e.target.value;
    els.transFontSizeVal.textContent = v;
    document.documentElement.style.setProperty('--trans-lyric-size', `${v}px`);
    localStorage.setItem('transFontSize', v);
  });
}

if(els.retranslateBtn) {
  els.retranslateBtn.addEventListener("click", async () => {
    if (!currentRecordId) {
      showToast("没有找到可用的历史记录 ID");
      return;
    }
    
    // Switch to progress view temporarily without resetting everything
    els.workspace.classList.add("hidden");
    els.uploadCard.classList.remove("hidden");
    els.uploadZone.classList.add("hidden");
    els.progressBox.classList.remove("hidden");
    updateProgress(5, "正在启动重译...", "请稍候");
    
    try {
      const response = await apiFetch(`/api/history/${currentRecordId}/translate`, {
        method: "POST"
      });
      const data = await response.json();
      currentTaskId = data.task_id;
      failedPolls = 0;
      pollTask(null, 0); // Start polling
    } catch (e) {
      showToast(e.message);
      els.progressBox.classList.add("hidden");
      els.uploadZone.classList.remove("hidden");
      els.uploadCard.classList.add("hidden");
      els.workspace.classList.remove("hidden");
    }
  });
}

els.uploadZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  els.uploadZone.classList.add("dragover");
});

els.uploadZone.addEventListener("dragleave", () => {
  els.uploadZone.classList.remove("dragover");
});

els.uploadZone.addEventListener("drop", (event) => {
  event.preventDefault();
  els.uploadZone.classList.remove("dragover");
  handleFile(event.dataTransfer.files[0]);
});

els.fileInput.addEventListener("change", () => handleFile(els.fileInput.files[0]));

els.playToggle.addEventListener("click", () => {
  if (!currentMedia) {
    return;
  }
  if (currentMedia.paused) {
    currentMedia.play().catch(() => showToast("播放失败，请再次点击播放器"));
  } else {
    currentMedia.pause();
  }
});

els.seekBar.addEventListener("input", () => {
  userSeeking = true;
  if (!currentMedia || !currentMedia.duration) {
    return;
  }
  const time = (Number(els.seekBar.value) / 1000) * currentMedia.duration;
  syncActiveLine(time);
});

els.seekBar.addEventListener("change", () => {
  if (currentMedia && currentMedia.duration) {
    currentMedia.currentTime = (Number(els.seekBar.value) / 1000) * currentMedia.duration;
  }
  userSeeking = false;
});

function markUserLyricScroll() {
  scrollIntent = "user";
  userIsViewing = true;
  autoScrolling = false;
  clearTimeout(scrollReleaseTimer);
  if (els.followBtn) {
    els.followBtn.classList.remove("hidden");
  }
}

els.lyricsScroll.addEventListener("wheel", markUserLyricScroll, { passive: true });
els.lyricsScroll.addEventListener("touchstart", markUserLyricScroll, { passive: true });
els.lyricsScroll.addEventListener("pointerdown", markUserLyricScroll);

els.lyricsScroll.addEventListener("scroll", () => {
  if (autoScrolling) {
    return;
  }
  scrollIntent = "user";
  userIsViewing = true;
  if (els.followBtn) {
    els.followBtn.classList.remove("hidden");
  }
});

if (els.followBtn) {
  els.followBtn.addEventListener("click", () => {
    userIsViewing = false;
    els.followBtn.classList.add("hidden");
    if (currentMedia) {
      syncActiveLine(currentMedia.currentTime, { forceScroll: true });
    }
  });
}

els.exportLrc.addEventListener("click", () => downloadExport("lrc"));
els.exportSrt.addEventListener("click", () => downloadExport("srt"));
els.copyText.addEventListener("click", copyPlainText);
els.newFile.addEventListener("click", resetUi);

document.addEventListener("keydown", (event) => {
  if (els.loginOverlay.classList.contains("hidden") === false) {
    return;
  }
  if (!currentMedia || ["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) {
    return;
  }
  if (event.code === "Space") {
    event.preventDefault();
    els.playToggle.click();
  }
  if (event.key === "ArrowLeft") {
    currentMedia.currentTime = Math.max(0, currentMedia.currentTime - 5);
  }
  if (event.key === "ArrowRight") {
    currentMedia.currentTime = Math.min(currentMedia.duration || Infinity, currentMedia.currentTime + 5);
  }
});

setTheme(localStorage.getItem("smartLyricsTheme") || "light");
initFontSettings();
setMode("local");
if (token) {
  enterApp();
  loadHistoryList(false);
  checkAdmin();
} else {
  els.loginOverlay.classList.remove("hidden");
}
