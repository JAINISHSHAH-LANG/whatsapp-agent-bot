// ====================================
// WhatsApp AI Agent - Frontend Logic
// ====================================

// State
let contacts = [];
let selectedContacts = new Set();
let currentStep = 1;
let statusPollInterval = null;
let logPollInterval = null;
const TOTAL_STEPS = 5;

// Analyzer state
let analyzerChatList = [];
let selectedChatFilters = new Set();
let analyzerResults = null;
let currentResultView = 'message';
let pendingConfirmedTask = null;

// ============ INITIALIZATION ============

document.addEventListener('DOMContentLoaded', () => {
  createParticles();
  startStatusPolling();
  updatePreviewTime();
});

function createParticles() {
  const container = document.getElementById('bgParticles');
  if (!container) return;
  const colors = ['rgba(37, 211, 102, 0.3)', 'rgba(59, 130, 246, 0.2)', 'rgba(139, 92, 246, 0.2)'];
  for (let i = 0; i < 30; i++) {
    const particle = document.createElement('div');
    particle.className = 'particle';
    particle.style.left = Math.random() * 100 + '%';
    particle.style.width = Math.random() * 4 + 2 + 'px';
    particle.style.height = particle.style.width;
    particle.style.background = colors[Math.floor(Math.random() * colors.length)];
    particle.style.animationDuration = Math.random() * 15 + 10 + 's';
    particle.style.animationDelay = Math.random() * 10 + 's';
    container.appendChild(particle);
  }
}

// ============ STATUS POLLING ============

function startStatusPolling() {
  statusPollInterval = setInterval(checkStatus, 2000);
  checkStatus();
}

async function checkStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    updateConnectionUI(data);
  } catch (err) {}
}

function updateConnectionUI(data) {
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  const connectBtn = document.getElementById('connectBtn');
  const disconnectBtn = document.getElementById('disconnectBtn');
  const qrPlaceholder = document.getElementById('qrPlaceholder');
  const qrDisplay = document.getElementById('qrDisplay');
  const connectedDisplay = document.getElementById('connectedDisplay');

  statusDot.className = 'status-dot';

  switch (data.status) {
    case 'disconnected':
      statusDot.classList.add('disconnected');
      statusText.textContent = 'Disconnected';
      connectBtn.classList.remove('hidden');
      connectBtn.disabled = false;
      connectBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg> Connect WhatsApp`;
      disconnectBtn.classList.add('hidden');
      qrPlaceholder.classList.remove('hidden');
      qrDisplay.classList.add('hidden');
      connectedDisplay.classList.add('hidden');
      updateNavStatus(1, 'disconnected');
      break;
    case 'connecting':
      statusDot.classList.add('connecting');
      statusText.textContent = 'Connecting...';
      connectBtn.disabled = true;
      connectBtn.innerHTML = `<div class="spinner"></div> Connecting...`;
      disconnectBtn.classList.add('hidden');
      qrPlaceholder.classList.remove('hidden');
      qrDisplay.classList.add('hidden');
      connectedDisplay.classList.add('hidden');
      updateNavStatus(1, 'connecting');
      break;
    case 'qr_ready':
      statusDot.classList.add('connecting');
      statusText.textContent = 'Scan QR Code';
      connectBtn.classList.add('hidden');
      disconnectBtn.classList.remove('hidden');
      qrPlaceholder.classList.add('hidden');
      qrDisplay.classList.remove('hidden');
      connectedDisplay.classList.add('hidden');
      if (data.qrCode) document.getElementById('qrImage').src = data.qrCode;
      updateNavStatus(1, 'scan QR');
      break;
    case 'connected':
      statusDot.classList.add('connected');
      statusText.textContent = 'Connected';
      connectBtn.classList.add('hidden');
      disconnectBtn.classList.remove('hidden');
      qrPlaceholder.classList.add('hidden');
      qrDisplay.classList.add('hidden');
      connectedDisplay.classList.remove('hidden');
      updateNavStatus(1, '✓ Ready');
      break;
  }
  
  // Re-validate if user is currently on step 4 looking at warnings
  if (currentStep === 4) {
    validateBeforeSend();
  }
}

// ============ WHATSAPP CONNECTION ============

async function connectWhatsApp() {
  try {
    const btn = document.getElementById('connectBtn');
    btn.disabled = true;
    btn.innerHTML = `<div class="spinner"></div> Initializing...`;
    const res = await fetch('/api/connect', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      showToast('info', 'Initializing WhatsApp connection...');
    } else {
      showToast('error', data.message);
      btn.disabled = false;
      btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg> Connect WhatsApp`;
    }
  } catch (err) {
    showToast('error', 'Failed to connect. Is the server running?');
  }
}

async function disconnectWhatsApp() {
  try {
    const res = await fetch('/api/disconnect', { method: 'POST' });
    const data = await res.json();
    if (data.success) showToast('info', 'Disconnected from WhatsApp');
  } catch (err) {
    showToast('error', 'Failed to disconnect');
  }
}

// ============ FREE STEP NAVIGATION ============

function goToStep(step) {
  currentStep = step;
  for (let i = 1; i <= TOTAL_STEPS; i++) {
    const section = document.getElementById(`step${i}`);
    const navBtn = document.getElementById(`navStep${i}`);
    if (section) section.classList.remove('active');
    if (navBtn) navBtn.classList.remove('active');
    if (i === step) {
      if (section) section.classList.add('active');
      if (navBtn) navBtn.classList.add('active');
    }
  }
  // Update connectors
  for (let i = 1; i < TOTAL_STEPS; i++) {
    const conn = document.getElementById(`navConn${i}`);
    if (conn) {
      if (i < step) conn.classList.add('active');
      else conn.classList.remove('active');
    }
  }
  if (step === 4) { updateSendSummary(); validateBeforeSend(); }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function updateNavStatus(stepNum, text) {
  const el = document.getElementById(`navStatus${stepNum}`);
  if (el) el.textContent = text ? ` · ${text}` : '';
}

// ============ FILE UPLOAD & IMPORT ============

function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  document.getElementById(`tab${tab.charAt(0).toUpperCase() + tab.slice(1)}`).classList.add('active');
  document.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'));
  document.getElementById(`${tab}Tab`).classList.add('active');
}

function handleDragOver(e) { e.preventDefault(); e.stopPropagation(); document.getElementById('uploadZone').classList.add('drag-over'); }
function handleDragLeave(e) { e.preventDefault(); e.stopPropagation(); document.getElementById('uploadZone').classList.remove('drag-over'); }
function handleDrop(e) {
  e.preventDefault(); e.stopPropagation();
  document.getElementById('uploadZone').classList.remove('drag-over');
  if (e.dataTransfer.files.length > 0) uploadFile(e.dataTransfer.files[0]);
}
function handleFileUpload(e) { if (e.target.files[0]) uploadFile(e.target.files[0]); }

async function uploadFile(file) {
  const formData = new FormData();
  formData.append('contactFile', file);
  showToast('info', `Processing ${file.name}...`);
  try {
    const res = await fetch('/api/upload', { method: 'POST', body: formData });
    const data = await res.json();
    if (data.success && data.contacts.length > 0) {
      addContacts(data.contacts);
      showToast('success', `Found ${data.contacts.length} contact(s)`);
    } else if (data.contacts && data.contacts.length === 0) {
      showToast('warning', 'No phone numbers found in the file');
    } else {
      showToast('error', data.message);
    }
  } catch (err) { showToast('error', 'Failed to process file'); }
  document.getElementById('fileInput').value = '';
}

async function extractFromText() {
  const text = document.getElementById('pasteArea').value.trim();
  if (!text) { showToast('warning', 'Please paste some text'); return; }
  try {
    const res = await fetch('/api/extract-text', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
    const data = await res.json();
    if (data.success && data.contacts.length > 0) {
      addContacts(data.contacts);
      showToast('success', `Extracted ${data.contacts.length} contact(s)`);
      document.getElementById('pasteArea').value = '';
    } else { showToast('warning', 'No phone numbers found'); }
  } catch (err) { showToast('error', 'Failed to extract numbers'); }
}

function addManualNumber() {
  const input = document.getElementById('manualInput');
  let number = input.value.trim();
  if (!number) { showToast('warning', 'Please enter a phone number or Group ID'); return; }

  // Check if it's already a group ID or properly formatted chat ID
  if (number.includes('@g.us') || number.includes('@c.us') || number.includes('-')) {
    addContacts([number]);
    showToast('success', 'Chat ID / Group added');
    input.value = ''; input.focus();
    return;
  }

  number = number.replace(/[\s\-.\(\)]/g, '');
  if (number.startsWith('+')) number = number.substring(1);
  if (number.length === 10 && /^\d+$/.test(number)) number = '91' + number;
  const digitsOnly = number.replace(/\D/g, '');
  if (digitsOnly.length < 7 || digitsOnly.length > 15) {
    showToast('error', 'Invalid phone number format'); return;
  }
  addContacts([number]);
  showToast('success', 'Contact added');
  input.value = ''; input.focus();
}

function addContacts(newContacts) {
  newContacts.forEach(num => { if (!contacts.includes(num)) { contacts.push(num); selectedContacts.add(num); } });
  renderContactList();
  document.getElementById('contactListSection').classList.remove('hidden');
  updateNavStatus(2, `${selectedContacts.size} contacts`);
}

function renderContactList() {
  const list = document.getElementById('contactList');
  document.getElementById('contactCount').textContent = contacts.length;
  list.innerHTML = contacts.map((num, i) => `
    <div class="contact-item ${selectedContacts.has(num) ? 'selected' : ''}" onclick="toggleContact('${num}')" id="contact-${i}">
      <div class="contact-checkbox">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg>
      </div>
      <span class="contact-number">+${num}</span>
      <button class="contact-remove" onclick="event.stopPropagation(); removeContact('${num}')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
  `).join('');
}

function toggleContact(num) {
  selectedContacts.has(num) ? selectedContacts.delete(num) : selectedContacts.add(num);
  renderContactList(); updateNavStatus(2, `${selectedContacts.size} contacts`);
}
function selectAll() { contacts.forEach(n => selectedContacts.add(n)); renderContactList(); updateNavStatus(2, `${selectedContacts.size} contacts`); }
function deselectAll() { selectedContacts.clear(); renderContactList(); updateNavStatus(2, '0 contacts'); }
function clearContacts() { contacts = []; selectedContacts.clear(); renderContactList(); document.getElementById('contactListSection').classList.add('hidden'); updateNavStatus(2, ''); showToast('info', 'Cleared'); }
function removeContact(num) {
  contacts = contacts.filter(c => c !== num); selectedContacts.delete(num); renderContactList();
  updateNavStatus(2, contacts.length > 0 ? `${selectedContacts.size} contacts` : '');
  if (!contacts.length) document.getElementById('contactListSection').classList.add('hidden');
}

// ============ MESSAGE COMPOSE ============

function updateCharCount() {
  const textarea = document.getElementById('messageInput');
  document.getElementById('charCount').textContent = `${textarea.value.length} characters`;
  const preview = document.getElementById('previewText');
  if (textarea.value.trim()) { preview.textContent = textarea.value; updateNavStatus(3, `${textarea.value.length} chars`); }
  else { preview.textContent = 'Your message will appear here...'; updateNavStatus(3, ''); }
}

function updatePreviewTime() {
  const now = new Date();
  document.getElementById('previewTime').textContent = `${now.getHours() % 12 || 12}:${now.getMinutes().toString().padStart(2, '0')} ${now.getHours() >= 12 ? 'PM' : 'AM'}`;
}

function insertTemplate(type) {
  const t = document.getElementById('messageInput');
  const templates = {
    greeting: `Hello! 👋\n\nHope you're doing well! I wanted to reach out and share some exciting updates with you.\n\nLooking forward to connecting!\n\nBest regards`,
    promo: `🎉 Special Offer Alert!\n\nWe have an exclusive deal just for you.\n\n📌 Details: [Your offer details]\n📅 Valid until: [Date]\n\nReply to learn more!`,
    reminder: `📋 Friendly Reminder\n\nHi! Just a quick reminder about [your event/deadline].\n\n📅 Date: [Date]\n⏰ Time: [Time]\n📍 Location: [Location]\n\nPlease confirm. Thank you!`
  };
  t.value = templates[type] || ''; updateCharCount(); showToast('info', 'Template inserted');
}

// ============ SEND MESSAGES ============

function updateSendSummary() {
  const sel = Array.from(selectedContacts);
  const msg = document.getElementById('messageInput').value;
  document.getElementById('summaryContacts').textContent = sel.length;
  document.getElementById('summaryMessageLen').textContent = `${msg.length} chars`;
  document.getElementById('summaryTime').textContent = sel.length > 0 ? `~${Math.max(1, Math.ceil((sel.length * 3.5) / 60))} min` : '~0 min';
}

function validateBeforeSend() {
  const w = document.getElementById('validationWarnings');
  const sel = Array.from(selectedContacts);
  const msg = document.getElementById('messageInput').value.trim();
  const issues = [];
  let type = 'success';
  if (document.getElementById('statusText').textContent !== 'Connected') { issues.push('⚠️ WhatsApp is not connected. Go to Step 1.'); type = 'error'; }
  if (!sel.length) { issues.push('⚠️ No contacts selected. Go to Step 2.'); type = 'error'; }
  if (!msg) { issues.push('⚠️ No message written. Go to Step 3.'); type = 'error'; }
  if (issues.length > 0) {
    w.className = `validation-warnings ${type}-type`; w.innerHTML = `<ul>${issues.map(i => `<li>${i}</li>`).join('')}</ul>`; w.classList.remove('hidden');
    document.getElementById('sendBtn').disabled = (type === 'error');
  } else {
    w.className = 'validation-warnings success-type'; w.innerHTML = '<ul><li>✅ Everything looks good! Ready to send.</li></ul>'; w.classList.remove('hidden');
    document.getElementById('sendBtn').disabled = false;
  }
}

async function startSending() {
  const sel = Array.from(selectedContacts);
  const msg = document.getElementById('messageInput').value.trim();
  
  console.log('[Send] Contacts:', sel, '| Message len:', msg.length);
  
  if (!sel.length) { showToast('warning', 'No contacts selected. Go to Step 2.'); return; }
  if (!msg) { showToast('warning', 'No message written. Go to Step 3.'); return; }

  const sendBtn = document.getElementById('sendBtn');
  sendBtn.disabled = true;
  sendBtn.textContent = '⏳ Sending...';

  try {
    console.log('[Send] Calling /api/send with', sel.length, 'contacts...');
    const res = await fetch('/api/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contacts: sel, message: msg })
    });
    const data = await res.json();
    console.log('[Send] API response:', data);
    
    if (data.success) {
      showToast('success', '🚀 Sending started! Watch the log below.');
      sendBtn.classList.add('hidden');
      document.getElementById('resetBtn').classList.remove('hidden');
      document.getElementById('progressSection').classList.remove('hidden');
      document.getElementById('messageLog').classList.remove('hidden');
      document.getElementById('validationWarnings').classList.add('hidden');
      startLogPolling();
    } else {
      showToast('error', data.message || 'Send failed');
      sendBtn.disabled = false;
      sendBtn.textContent = 'Start Sending Messages';
      if (data.message && data.message.includes('not connected')) setTimeout(() => goToStep(1), 1500);
    }
  } catch (err) {
    console.error('[Send] Error:', err);
    showToast('error', 'Network error — check server is running');
    sendBtn.disabled = false;
    sendBtn.textContent = 'Start Sending Messages';
  }
}

function startLogPolling() { logPollInterval = setInterval(updateLog, 1500); updateLog(); }

async function updateLog() {
  try {
    const res = await fetch('/api/log');
    const data = await res.json();
    const stats = data.stats;
    document.getElementById('statSent').textContent = stats.sent;
    document.getElementById('statFailed').textContent = stats.failed;
    document.getElementById('statPending').textContent = stats.pending;
    const total = stats.total || 1, completed = stats.sent + stats.failed;
    const pct = Math.round((completed / total) * 100);
    document.getElementById('progressBar').style.width = pct + '%';
    document.getElementById('progressPercent').textContent = pct + '%';
    updateNavStatus(4, `${stats.sent}/${total} sent`);
    const lc = document.getElementById('logEntries');
    lc.innerHTML = data.log.map(e => `
      <div class="log-entry ${e.status}" style="border-left: 3px solid ${e.status === 'sent' ? '#25d366' : '#f44336'}; padding: 12px 16px; margin-bottom: 8px; border-radius: 8px; background: ${e.status === 'sent' ? 'rgba(37,211,102,0.08)' : 'rgba(244,67,54,0.08)'}; display: flex; align-items: center; gap: 12px;">
        <div class="log-icon" style="font-size:20px">${e.status === 'sent' ? '✅' : '❌'}</div>
        <div style="flex:1;">
          <div style="font-weight:600; color: ${e.status === 'sent' ? '#25d366' : '#f44336'};">
            ${e.status === 'sent' ? '✅ DELIVERED!' : '❌ FAILED'}
          </div>
          <div style="font-size:13px; opacity:0.8; margin-top:2px;">
            <strong>To:</strong> ${e.contact}
            ${e.resolvedId && e.resolvedId !== e.contact ? ` → <span style="color:#25d366">${e.resolvedId}</span>` : ''}
          </div>
          ${e.error ? `<div style="font-size:12px; color:#f44336; margin-top:2px;">Reason: ${e.error}</div>` : ''}
          ${e.method ? `<div style="font-size:11px; opacity:0.5; margin-top:2px;">Method: ${e.method}</div>` : ''}
        </div>
        <span style="font-size:11px; opacity:0.5; white-space:nowrap">${new Date(e.timestamp).toLocaleTimeString()}</span>
      </div>
    `).join('');
    lc.scrollTop = lc.scrollHeight;
    if (!data.inProgress && completed >= total && total > 0) {
      clearInterval(logPollInterval);
      if (stats.sent > 0) {
        showToast('success', `🎉 ${stats.sent} message${stats.sent > 1 ? 's' : ''} delivered successfully!`);
      } else {
        showToast('error', `Campaign finished: ${stats.failed} failed. Check numbers are on WhatsApp.`);
      }
    }
  } catch (err) {}
}


async function resetAll() {
  try { await fetch('/api/reset', { method: 'POST' }); } catch (e) {}
  contacts = []; selectedContacts.clear();
  document.getElementById('messageInput').value = '';
  ['contactListSection', 'progressSection', 'messageLog', 'validationWarnings'].forEach(id => document.getElementById(id).classList.add('hidden'));
  document.getElementById('sendBtn').classList.remove('hidden');
  document.getElementById('sendBtn').disabled = false;
  document.getElementById('resetBtn').classList.add('hidden');
  document.getElementById('logEntries').innerHTML = '';
  document.getElementById('progressBar').style.width = '0%';
  document.getElementById('progressPercent').textContent = '0%';
  updateCharCount(); renderContactList();
  updateNavStatus(2, ''); updateNavStatus(3, ''); updateNavStatus(4, '');
  if (logPollInterval) clearInterval(logPollInterval);
  goToStep(2); showToast('info', 'Ready for a new campaign');
}

// ============ CHAT & GROUP ANALYZER ============

async function loadChatList() {
  const btn = document.getElementById('loadChatsBtn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-sm"></span> Syncing...';
  }
  
  showToast('info', 'Loading chat list...');
  try {
    const res = await fetch('/api/analyzer/chats');
    const data = await res.json();
    if (!data.success) { showToast('error', data.message); return; }
    analyzerChatList = data.chats;
    renderChatFilterList();
    document.getElementById('chatFilterSection').classList.remove('hidden');
    showToast('success', `Loaded ${data.total} chats`);
  } catch (err) { 
    showToast('error', 'Failed to load chats. Connect WhatsApp first.'); 
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg> Sync Chat List';
    }
  }
}

function toggleSearchScope() {
  const isAll = document.getElementById('searchAllToggle').checked;
  const scopeText = document.getElementById('searchScopeText');
  scopeText.textContent = isAll ? 'All Chats' : 'Selected Only';
  if (!isAll && selectedChatFilters.size === 0 && analyzerChatList.length > 0) {
    showToast('info', 'Select specific chats below to focus your search');
  }
}

function renderChatFilterList() {
  const listEl = document.getElementById('chatFilterList');
  const searchVal = document.getElementById('chatFilterSearch').value.toLowerCase();
  
  if (analyzerChatList.length === 0) {
    listEl.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-muted);">Click "Sync Chat List" to load contacts</div>';
    return;
  }

  const filtered = analyzerChatList.filter(chat => 
    (chat.name || '').toLowerCase().includes(searchVal) || 
    (chat.id || '').includes(searchVal)
  );

  if (filtered.length === 0) {
    listEl.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-muted);">No matching contacts found</div>';
    return;
  }

  listEl.innerHTML = filtered.map(chat => `
    <div class="chat-filter-item ${selectedChatFilters.has(chat.id) ? 'selected' : ''}" onclick="toggleChatFilter('${chat.id}')">
      <div style="display: flex; align-items: center; gap: 12px; flex: 1; min-width: 0;">
        <input type="checkbox" ${selectedChatFilters.has(chat.id) ? 'checked' : ''} style="pointer-events: none; flex-shrink: 0;">
        <div class="cf-avatar" style="flex-shrink: 0;">${(chat.name || '?').substring(0, 1).toUpperCase()}</div>
        <div style="display: flex; flex-direction: column; min-width: 0; flex: 1;">
          <div style="display: flex; align-items: center; gap: 6px;">
            <div class="cf-name" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 180px;">${escapeHtml(chat.name || 'Unknown')}</div>
            ${chat.pinned ? `<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" style="color: var(--text-muted);"><path d="M16 5V4c0-1.1-.9-2-2-2h-4c-1.1 0-2 .9-2 2v1c-1.1 0-2 .9-2 2v2c0 2.2-1.8 4-4 4v2h18v-2c-2.2 0-4-1.8-4-4V7c0-1.1-.9-2-2-2z"/></svg>` : ''}
          </div>
          ${chat.lastMessage ? `<div style="font-size: 11px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(chat.lastMessage.body)}</div>` : ''}
        </div>
        ${chat.unreadCount > 0 ? `<div style="background: var(--accent-green); color: white; font-size: 10px; font-weight: 700; min-width: 18px; height: 18px; border-radius: 9px; display: flex; align-items: center; justify-content: center; padding: 0 5px; flex-shrink: 0;">${chat.unreadCount}</div>` : ''}
      </div>
      <div class="cf-actions" style="margin-left: 8px;">
        <button class="btn-action" onclick="event.stopPropagation(); initTaskFromChat('${chat.id}', '${escapeHtml(chat.name)}')" title="Quick Task">⚡</button>
      </div>
    </div>
  `).join('');
}

function toggleChatFilter(id) {
  selectedChatFilters.has(id) ? selectedChatFilters.delete(id) : selectedChatFilters.add(id);
  renderChatFilterList();
}

function filterChatList() {
  renderChatFilterList();
}

function selectAllChats() { analyzerChatList.forEach(c => selectedChatFilters.add(c.id)); renderChatFilterList(); }
function deselectAllChats() { selectedChatFilters.clear(); renderChatFilterList(); }

function setExampleSearch(text) {
  document.getElementById('analyzerKeywords').value = text;
  document.getElementById('analyzerKeywords').focus();
}

async function runAnalysis() {
  const input = document.getElementById('analyzerKeywords').value.trim();
  if (!input) { showToast('warning', 'Enter keywords to search'); return; }

  const searchGroups = document.getElementById('searchGroups').checked;
  const searchPersonal = document.getElementById('searchPersonal').checked;
  const fuzzy = document.getElementById('fuzzySearch').checked;
  const searchAll = document.getElementById('searchAllToggle').checked;
  const chatIds = searchAll ? [] : [...selectedChatFilters];

  if (!searchAll && chatIds.length === 0) {
    showToast('warning', 'Please select at least one chat or switch to "All Chats"');
    return;
  }

  // Show progress
  document.getElementById('analyzerProgress').classList.remove('hidden');
  document.getElementById('analyzerResults').classList.add('hidden');
  document.getElementById('analyzerEmpty').classList.add('hidden');
  renderAnalyzerSummary('');
  document.getElementById('analyzerSearchBtn').disabled = true;
  document.getElementById('analyzerProgressText').textContent = `Scanning chats for "${input}"...`;

  try {
    const res = await fetch('/api/analyzer/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: input, chatIds, searchGroups, searchPersonal, fuzzy })
    });
    const data = await res.json();

    document.getElementById('analyzerProgress').classList.add('hidden');
    document.getElementById('analyzerSearchBtn').disabled = false;

    if (!data.success) { showToast('error', data.message); document.getElementById('analyzerEmpty').classList.remove('hidden'); return; }

    analyzerResults = data;

    // Update stats
    document.getElementById('aStatMatches').textContent = data.stats.totalMatches;
    document.getElementById('aStatChats').textContent = data.stats.chatsScanned;
    document.getElementById('aStatMessages').textContent = data.stats.messagesScanned;
    document.getElementById('aStatPeople').textContent = data.stats.uniquePeople;
    updateNavStatus(5, `${data.stats.totalMatches} matches`);
    renderAnalyzerSummary(data.summary || '');

    // Show results
    document.getElementById('analyzerResults').classList.remove('hidden');
    renderResultsView();

    if (data.stats.totalMatches === 0) {
      showToast('warning', 'No matches found. Try different keywords.');
    } else {
      showToast('success', `Found ${data.stats.totalMatches} matches from ${data.stats.uniquePeople} people`);
    }
  } catch (err) {
    document.getElementById('analyzerProgress').classList.add('hidden');
    document.getElementById('analyzerSearchBtn').disabled = false;
    document.getElementById('analyzerEmpty').classList.remove('hidden');
    showToast('error', 'Search failed. Make sure WhatsApp is connected.');
  }
}

async function runAIAnalysis() {
  const input = document.getElementById('analyzerKeywords').value.trim();
  if (!input) { showToast('warning', 'Enter your request for the AI Assistant'); return; }

  const searchAll = document.getElementById('searchAllToggle').checked;
  const chatIds = searchAll ? [] : [...selectedChatFilters];

  if (!searchAll && chatIds.length === 0) {
    showToast('warning', 'Please select a contact from the list or switch to "All Chats" mode');
    return;
  }
  const timeRangeInput = document.getElementById('analyzerTime');
  const timeRange = timeRangeInput ? (parseInt(timeRangeInput.value) || 30) : 30;

  document.getElementById('analyzerProgress').classList.remove('hidden');
  document.getElementById('analyzerResults').classList.add('hidden');
  document.getElementById('analyzerEmpty').classList.add('hidden');
  renderAnalyzerSummary('');
  document.getElementById('analyzerSearchBtn').disabled = true;
  document.getElementById('analyzerAiBtn').disabled = true;
  document.getElementById('analyzerProgressText').textContent = `AI Agent is reading chats and analyzing requirements...`;

  try {
    const res = await fetch('/api/analyzer/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: input, chatIds, timeRange })
    });
    const data = await res.json();

    document.getElementById('analyzerProgress').classList.add('hidden');
    document.getElementById('analyzerSearchBtn').disabled = false;
    document.getElementById('analyzerAiBtn').disabled = false;

    if (!data.success) { 
      showToast('error', data.message); 
      document.getElementById('analyzerEmpty').classList.remove('hidden'); 
      return; 
    }

    if (data.taskPending) {
      showTaskConfirmModal(data.taskData);
      return;
    }

    analyzerResults = data;
    
    // Update stats
    document.getElementById('aStatMatches').textContent = data.stats?.totalMatches ?? data.messageCount ?? 0;
    document.getElementById('aStatChats').textContent = data.stats?.chatsScanned ?? '-';
    document.getElementById('aStatMessages').textContent = data.stats?.messagesScanned ?? '-';
    document.getElementById('aStatPeople').textContent = data.stats?.uniquePeople ?? '-';
    updateNavStatus(5, `${data.messageCount || 0} matches`);

    // Process and show AI Response with simple markdown conversion
    if (data.aiResponse) {
      const formattedHtml = data.aiResponse
        .replace(/### (.*?)\n/g, '<h3 style="margin-top:20px; border-bottom:1px solid var(--border-color); padding-bottom:5px;">$1</h3>')
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\n\n/g, '<br><br>')
        .replace(/\n---\n/g, '<hr style="opacity:0.2; margin:15px 0;">')
        .replace(/\n- /g, '<br>• ')
        .replace(/\n/g, '<br>');
        
      renderAnalyzerSummary(formattedHtml, true);
    }

    // Show results
    document.getElementById('analyzerResults').classList.remove('hidden');
    renderResultsView();
    
    showToast('success', 'AI analysis complete!');
  } catch (err) {
    document.getElementById('analyzerProgress').classList.add('hidden');
    document.getElementById('analyzerSearchBtn').disabled = false;
    document.getElementById('analyzerAiBtn').disabled = false;
    document.getElementById('analyzerEmpty').classList.remove('hidden');
    showToast('error', 'AI search failed. Make sure WhatsApp is connected.');
  }
}

function switchResultView(view) {
  currentResultView = 'message';
  renderResultsView();
}

function renderResultsView() {
  if (!analyzerResults) return;
  const container = document.getElementById('resultsContainer');
  currentResultView = 'message';
  renderByMessage(container);
}

function renderAnalyzerSummary(summaryText, isHtml = false) {
  const panel = document.getElementById('aiResponsePanel');
  const text = document.getElementById('aiResponseText');
  if (!panel || !text) return;

  if (!summaryText) {
    panel.classList.add('hidden');
    text.innerHTML = '';
    return;
  }

  if (isHtml) {
    text.innerHTML = summaryText;
  } else {
    text.textContent = summaryText;
  }
  panel.classList.remove('hidden');
}

function renderByPerson(container) {
  const people = analyzerResults.byPerson;
  if (!people.length) { container.innerHTML = '<p style="text-align:center;color:var(--text-muted);padding:40px;">No results found</p>'; return; }

  container.innerHTML = people.map((person, idx) => {
    const initials = getInitials(person.name);
    return `
      <div class="person-card">
        <div class="person-header" onclick="togglePersonMessages(${idx})">
          <div class="person-avatar">${initials}</div>
          <div class="person-info">
            <div class="person-name">${escapeHtml(person.name || 'Unknown')}</div>
            <div class="person-number">${person.number ? '+' + person.number : ''} · ${person.chats.join(', ')}</div>
          </div>
          <div class="person-meta">
            <span class="person-badge relevance-badge">Score: ${person.totalRelevance}</span>
            <span class="person-badge match-count-badge">${person.messages.length} match${person.messages.length > 1 ? 'es' : ''}</span>
          </div>
          <div class="person-expand" id="expandIcon${idx}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
          </div>
        </div>
        <div class="person-messages" id="personMsgs${idx}">
          ${person.messages.map(m => `
            <div class="person-msg">
              <div class="person-msg-header">
                <span class="person-msg-chat">${m.isGroup ? '👥' : '💬'} ${escapeHtml(m.chatName)}</span>
                <span>${formatDate(m.timestamp)}</span>
              </div>
              <div class="person-msg-body">${formatHighlighted(m.highlighted)}</div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }).join('');
}

function renderByMessage(container) {
  const results = analyzerResults.results;
  if (!results.length) { container.innerHTML = '<p style="text-align:center;color:var(--text-muted);padding:40px;">No results found</p>'; return; }

  container.innerHTML = results.slice(0, 100).map(r => {
    return `
      <div class="message-result-card" style="padding: 24px; border: 1px solid var(--border-color); background: var(--bg-card); border-radius: var(--radius-md); margin-bottom: 16px; box-shadow: var(--shadow-md);">
        <div class="msg-result-content">
          <div style="font-size: 1.1rem; border-bottom: 1px solid var(--border-color); padding-bottom: 12px; margin-bottom: 16px; font-weight: 800; color: var(--accent-green); display: flex; align-items: center; gap: 8px;">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            By Message
          </div>
          <div style="display: grid; grid-template-columns: 100px 1fr; gap: 12px; font-size: 0.95rem; line-height: 1.6;">
            <div style="font-weight: 700; color: var(--text-muted);">👥 Group:</div>
            <div style="color: var(--text-primary); font-weight: 500;">${escapeHtml(r.chatName)}</div>
            
            <div style="font-weight: 700; color: var(--text-muted);">📱 Contact:</div>
            <div style="color: var(--text-primary); font-weight: 500;">${escapeHtml(r.senderName || 'Unknown')} <span style="opacity: 0.6; font-weight: 400; font-size: 0.85rem;">(${r.senderNumber ? '+' + r.senderNumber : 'No Number'})</span></div>
            
            <div style="font-weight: 700; color: var(--text-muted);">📅 Date/Time:</div>
            <div style="color: var(--text-primary); font-weight: 500;">${escapeHtml(r.dateTime || formatDate(r.timestamp))}</div>
            
            <div style="font-weight: 700; color: var(--text-muted); grid-column: 1 / -1; margin-top: 12px; display: flex; align-items: center; gap: 6px;">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
              Message Content:
            </div>
            <div style="grid-column: 1 / -1; border-left: 4px solid var(--accent-green); padding: 12px 16px; margin-top: 4px; background: rgba(255,255,255,0.03); border-radius: 4px; color: var(--text-secondary); font-style: italic;">
              ${formatHighlighted(r.highlighted || r.body)}
            </div>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function renderByChat(container) {
  const results = analyzerResults.results;
  if (!results.length) { container.innerHTML = '<p style="text-align:center;color:var(--text-muted);padding:40px;">No results found</p>'; return; }

  // Group by chat
  const byChat = {};
  for (const r of results) {
    if (!byChat[r.chatId]) { byChat[r.chatId] = { name: r.chatName, isGroup: r.isGroup, messages: [] }; }
    byChat[r.chatId].messages.push(r);
  }

  container.innerHTML = Object.entries(byChat).map(([chatId, chat], idx) => `
    <div class="person-card">
      <div class="person-header" onclick="togglePersonMessages(${1000 + idx})">
        <div class="person-avatar" style="background: ${chat.isGroup ? 'var(--gradient-blue)' : 'var(--gradient-primary)'}">${chat.isGroup ? '👥' : '💬'}</div>
        <div class="person-info">
          <div class="person-name">${escapeHtml(chat.name)}</div>
          <div class="person-number">${chat.isGroup ? 'Group' : 'Personal Chat'}</div>
        </div>
        <div class="person-meta">
          <span class="person-badge match-count-badge">${chat.messages.length} match${chat.messages.length > 1 ? 'es' : ''}</span>
        </div>
        <div class="person-expand" id="expandIcon${1000 + idx}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
        </div>
      </div>
      <div class="person-messages" id="personMsgs${1000 + idx}">
        ${chat.messages.map(m => `
          <div class="person-msg">
            <div class="person-msg-header">
              <span><strong>${escapeHtml(m.senderName || m.senderNumber || 'Unknown')}</strong>${m.senderNumber ? ` (+${m.senderNumber})` : ''}</span>
              <span>${formatDate(m.timestamp)}</span>
            </div>
            <div class="person-msg-body">${formatHighlighted(m.highlighted)}</div>
          </div>
        `).join('')}
      </div>
    </div>
  `).join('');
}

function togglePersonMessages(idx) {
  const msgs = document.getElementById(`personMsgs${idx}`);
  const icon = document.getElementById(`expandIcon${idx}`);
  if (msgs.classList.contains('show')) {
    msgs.classList.remove('show');
    icon.classList.remove('expanded');
  } else {
    msgs.classList.add('show');
    icon.classList.add('expanded');
  }
}

// ============ UTILITY FUNCTIONS ============

function getInitials(name) {
  if (!name || name === 'Unknown') return '?';
  const parts = name.trim().split(/\s+/);
  return parts.length >= 2 ? (parts[0][0] + parts[1][0]).toUpperCase() : name[0].toUpperCase();
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatHighlighted(text) {
  if (!text) return '';
  // Replace ⟦...⟧ markers with styled highlights
  return escapeHtml(text).replace(/⟦(.*?)⟧/g, '<span class="match-highlight">$1</span>');
}

function formatHighlighted(text) {
  if (!text) return '';
  return escapeHtml(text).replace(/\[\[hl\]\](.*?)\[\[\/hl\]\]/g, '<span class="match-highlight">$1</span>');
}

function formatDate(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp * 1000);
  const now = new Date();
  const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return `Today ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  if (diffDays === 1) return `Yesterday ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

// ============ TASK CONFIRMATION MODAL ============

function showTaskConfirmModal(taskData) {
  pendingConfirmedTask = taskData;
  document.getElementById('confirmTarget').textContent = taskData.recipientName;
  document.getElementById('confirmType').textContent = taskData.type;
  document.getElementById('confirmMessage').textContent = taskData.message;
  
  const timeRow = document.getElementById('confirmTimeRow');
  const timeVal = document.getElementById('confirmTime');
  
  if (taskData.type === 'Immediate Send') {
    timeRow.classList.add('hidden');
  } else {
    timeRow.classList.remove('hidden');
    const date = new Date(taskData.scheduledTime);
    timeVal.textContent = date.toLocaleString('en-IN', { dateStyle: 'full', timeStyle: 'short' });
  }

  document.getElementById('taskConfirmModal').classList.remove('hidden');
  document.getElementById('finalConfirmBtn').onclick = executeConfirmedTask;
}

function closeModal(modalId) {
  document.getElementById(modalId).classList.add('hidden');
  pendingConfirmedTask = null;
}

async function executeConfirmedTask() {
  if (!pendingConfirmedTask) return;
  
  const btn = document.getElementById('finalConfirmBtn');
  btn.disabled = true;
  btn.textContent = 'Executing...';
  
  try {
    const res = await fetch('/api/executor/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pendingConfirmedTask)
    });
    const data = await res.json();
    
    if (data.success) {
      showToast('success', data.message);
      closeModal('taskConfirmModal');
    } else {
      showToast('error', data.message);
      btn.disabled = false;
      btn.textContent = 'Confirm & Execute';
    }
  } catch (err) {
    showToast('error', 'Execution failed. Check connection.');
    btn.disabled = false;
    btn.textContent = 'Confirm & Execute';
  }
}

function initTaskFromChat(id, name) {
  const input = document.getElementById('analyzerKeywords');
  input.value = `Send a message to ${name} saying: `;
  input.focus();
  showToast('info', `Type your message for ${name}`);
}

// ============ TOAST NOTIFICATIONS ============

function escapeHtml(unsafe) {
  if (!unsafe) return '';
  return String(unsafe)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function showToast(type, message) {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  const icons = {
    success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg>',
    error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
    warning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>'
  };
  toast.innerHTML = `<div class="toast-icon">${icons[type]}</div><span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => { toast.classList.add('removing'); setTimeout(() => toast.remove(), 300); }, 4000);
}
