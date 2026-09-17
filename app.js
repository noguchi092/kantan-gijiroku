(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const els = {
    title: $('meetingTitle'), record: $('recordBtn'), recordText: $('recordBtnText'), pause: $('pauseBtn'), stop: $('stopBtn'),
    timer: $('timer'), pulse: $('pulse'), status: $('record-title'), note: $('supportNote'), speech: $('speechState'),
    transcript: $('transcript'), count: $('charCount'), summary: $('summary'), summarize: $('summarizeBtn'),
    copyTranscript: $('copyTranscript'), copySummary: $('copySummary'), downloadMinutes: $('downloadMinutes'),
    downloadAudio: $('downloadAudio'), clear: $('clearAll'), dialog: $('clearDialog'), confirmClear: $('confirmClear'), toast: $('toast')
  };

  let mediaRecorder = null;
  let mediaStream = null;
  let audioChunks = [];
  let audioBlob = null;
  let recognition = null;
  let timerId = null;
  let elapsed = 0;
  let baseTranscript = '';
  let isRecording = false;
  let isPaused = false;
  let toastTimer = null;

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  function showToast(message) {
    els.toast.textContent = message;
    els.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2200);
  }

  function formatTime(seconds) {
    const h = String(Math.floor(seconds / 3600)).padStart(2, '0');
    const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
    const s = String(seconds % 60).padStart(2, '0');
    return `${h}:${m}:${s}`;
  }

  function startTimer() {
    clearInterval(timerId);
    timerId = setInterval(() => { if (!isPaused) { elapsed += 1; els.timer.textContent = formatTime(elapsed); } }, 1000);
  }

  function setupRecognition() {
    if (!SpeechRecognition) {
      els.note.textContent = 'このブラウザは自動文字起こしに対応していません。録音後、文字を直接入力できます。';
      return;
    }
    recognition = new SpeechRecognition();
    recognition.lang = 'ja-JP';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      let finalText = '';
      let interimText = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const part = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalText += part + '。';
        else interimText += part;
      }
      if (finalText) baseTranscript += finalText;
      els.transcript.value = baseTranscript + interimText;
      updateCount();
    };
    recognition.onerror = (event) => {
      if (!['aborted', 'no-speech'].includes(event.error)) {
        els.speech.textContent = '手入力できます';
        els.speech.classList.remove('live');
      }
    };
    recognition.onend = () => {
      if (isRecording && !isPaused) {
        try { recognition.start(); } catch (_) {}
      }
    };
  }

  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      showToast('この端末では録音機能を利用できません');
      return;
    }
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunks = [];
      audioBlob = null;
      const preferred = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '';
      mediaRecorder = preferred ? new MediaRecorder(mediaStream, { mimeType: preferred }) : new MediaRecorder(mediaStream);
      mediaRecorder.ondataavailable = (e) => { if (e.data.size) audioChunks.push(e.data); };
      mediaRecorder.onstop = () => {
        audioBlob = new Blob(audioChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
        els.downloadAudio.disabled = !audioBlob.size;
        mediaStream?.getTracks().forEach((track) => track.stop());
      };
      mediaRecorder.start(1000);
      isRecording = true;
      isPaused = false;
      baseTranscript = els.transcript.value;
      try { recognition?.start(); } catch (_) {}
      startTimer();
      updateRecordingUI();
    } catch (_) {
      showToast('マイクを使用できません。端末の設定をご確認ください');
    }
  }

  function togglePause() {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') return;
    if (mediaRecorder.state === 'recording') {
      mediaRecorder.pause();
      recognition?.stop();
      isPaused = true;
    } else {
      mediaRecorder.resume();
      baseTranscript = els.transcript.value;
      try { recognition?.start(); } catch (_) {}
      isPaused = false;
    }
    updateRecordingUI();
  }

  function stopRecording() {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') return;
    mediaRecorder.stop();
    recognition?.stop();
    clearInterval(timerId);
    isRecording = false;
    isPaused = false;
    baseTranscript = els.transcript.value;
    updateRecordingUI();
    showToast('録音を終了しました');
  }

  function updateRecordingUI() {
    els.record.disabled = isRecording;
    els.pause.disabled = !isRecording;
    els.stop.disabled = !isRecording;
    els.record.classList.toggle('active', isRecording);
    els.pulse.classList.toggle('recording', isRecording && !isPaused);
    els.recordText.textContent = isRecording ? '録音中' : '録音を開始';
    els.pause.textContent = isPaused ? '録音を再開' : '一時停止';
    els.status.textContent = !isRecording ? '録音を終了しました' : isPaused ? '一時停止中' : '録音しています';
    els.speech.textContent = isRecording && !isPaused ? '文字起こし中' : '待機中';
    els.speech.classList.toggle('live', isRecording && !isPaused);
  }

  function updateCount() {
    els.count.textContent = `${els.transcript.value.length.toLocaleString('ja-JP')}文字`;
  }

  function sentenceList(text) {
    return text.replace(/\s+/g, ' ').split(/(?<=[。！？!?])|\n+/).map(s => s.trim()).filter(Boolean);
  }

  function pick(sentences, keywords, limit = 4) {
    return sentences.filter(s => keywords.some(k => s.includes(k))).slice(0, limit);
  }

  function escapeHtml(value) {
    return value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]));
  }

  function buildSummary() {
    const text = els.transcript.value.trim();
    if (!text) { showToast('先に文字起こしを入力してください'); els.transcript.focus(); return; }
    const sentences = sentenceList(text);
    const decisions = pick(sentences, ['決定', '決まり', 'すること', '確定', '了承', '合意']);
    const actions = pick(sentences, ['までに', '担当', '対応', '確認', '提出', '連絡', '実施']);
    const issues = pick(sentences, ['課題', '懸念', '保留', '検討', '問題']);
    const overview = sentences.slice(0, Math.min(3, sentences.length));
    const list = (items, fallback) => items.length ? `<ul>${items.map(x => `<li>${escapeHtml(x)}</li>`).join('')}</ul>` : `<p>${fallback}</p>`;
    els.summary.innerHTML = `
      <h3>会議の概要</h3>${list(overview, '概要を入力してください。')}
      <h3>決定事項</h3>${list(decisions, '明確な決定事項は見つかりませんでした。')}
      <h3>今後の対応</h3>${list(actions, '担当や期限を確認して入力してください。')}
      <h3>保留・確認事項</h3>${list(issues, '保留・確認事項はありません。')}`;
    showToast('議事録を整理しました');
  }

  async function copyText(text, success) {
    if (!text.trim()) { showToast('コピーする内容がありません'); return; }
    try { await navigator.clipboard.writeText(text); showToast(success); }
    catch (_) { showToast('コピーできませんでした'); }
  }

  function summaryAsText() {
    return els.summary.innerText.trim();
  }

  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function safeName() {
    return (els.title.value.trim() || '議事録').replace(/[\\/:*?"<>|]/g, '_');
  }

  function downloadMinutes() {
    const transcript = els.transcript.value.trim();
    const summary = summaryAsText();
    if (!transcript && !summary) { showToast('保存する内容がありません'); return; }
    const now = new Date().toLocaleString('ja-JP');
    const body = `${els.title.value.trim() || '議事録'}\n作成日時：${now}\n\n【要約】\n${summary || '未作成'}\n\n【文字起こし】\n${transcript || 'なし'}\n`;
    download(new Blob([body], { type: 'text/plain;charset=utf-8' }), `${safeName()}.txt`);
    showToast('議事録を保存しました');
  }

  function clearEverything() {
    if (isRecording) stopRecording();
    els.title.value = '';
    els.transcript.value = '';
    els.summary.innerHTML = '';
    audioChunks = []; audioBlob = null; elapsed = 0; baseTranscript = '';
    els.timer.textContent = '00:00:00';
    els.downloadAudio.disabled = true;
    els.status.textContent = '録音の準備ができています';
    updateCount();
    showToast('すべて削除しました');
  }

  els.record.addEventListener('click', startRecording);
  els.pause.addEventListener('click', togglePause);
  els.stop.addEventListener('click', stopRecording);
  els.transcript.addEventListener('input', () => { baseTranscript = els.transcript.value; updateCount(); });
  els.summarize.addEventListener('click', buildSummary);
  els.copyTranscript.addEventListener('click', () => copyText(els.transcript.value, '文字起こしをコピーしました'));
  els.copySummary.addEventListener('click', () => copyText(summaryAsText(), '要約をコピーしました'));
  els.downloadMinutes.addEventListener('click', downloadMinutes);
  els.downloadAudio.addEventListener('click', () => {
    if (audioBlob) download(audioBlob, `${safeName()}_録音.${audioBlob.type.includes('mp4') ? 'm4a' : 'webm'}`);
  });
  els.clear.addEventListener('click', () => els.dialog.showModal());
  els.confirmClear.addEventListener('click', clearEverything);
  window.addEventListener('beforeunload', (e) => { if (isRecording) { e.preventDefault(); e.returnValue = ''; } });

  const modelContext = document.modelContext;
  if (modelContext?.registerTool) {
    const lifecycle = new AbortController();
    try {
      Promise.resolve(modelContext.registerTool({
        name: 'prepare_minutes',
        title: '議事録を作成',
        description: '会議名と文字起こしを画面に入力し、議事録の要約を作成します。',
        inputSchema: {
          type: 'object',
          properties: {
            meetingTitle: { type: 'string', description: '会議名' },
            transcript: { type: 'string', description: '文字起こし全文', minLength: 1 }
          },
          required: ['transcript'],
          additionalProperties: false
        },
        annotations: { readOnlyHint: false, untrustedContentHint: true },
        execute(input) {
          if (!input || typeof input.transcript !== 'string' || !input.transcript.trim()) {
            throw new Error('文字起こしを入力してください。');
          }
          if (input.meetingTitle !== undefined && typeof input.meetingTitle !== 'string') {
            throw new Error('会議名は文字列で入力してください。');
          }
          els.title.value = input.meetingTitle?.trim() || '';
          els.transcript.value = input.transcript.trim();
          baseTranscript = els.transcript.value;
          updateCount();
          buildSummary();
          return { status: 'completed', characterCount: els.transcript.value.length };
        }
      }, { signal: lifecycle.signal })).catch(() => {});
    } catch (_) {}
  }

  setupRecognition();
  updateCount();
})();
