const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const { Client, LocalAuth } = require('whatsapp-web.js');
const QRCode = require('qrcode');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const app = express();
const PORT = 3000;

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Ensure uploads directory exists
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// Multer config for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['.txt', '.pdf', '.csv', '.docx', '.doc'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedTypes.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Unsupported file type. Please upload .txt, .pdf, .csv, or .docx files.'));
    }
  }
});

// ============ WhatsApp Client State ============
let whatsappClient = null;
let clientReady = false;
let qrCodeData = null;
let connectionStatus = 'disconnected';
let messageLog = [];
let messagingInProgress = false;
let messagingStats = { total: 0, sent: 0, failed: 0, pending: 0 };

let scheduledTasks = [];
const tasksFile = path.join(__dirname, 'scheduled_tasks.json');

// Load tasks from file if exists
if (fs.existsSync(tasksFile)) {
  try {
    scheduledTasks = JSON.parse(fs.readFileSync(tasksFile, 'utf8'));
  } catch (err) {
    console.error('Error loading scheduled tasks:', err);
    scheduledTasks = [];
  }
}

function saveScheduledTasks() {
  try {
    fs.writeFileSync(tasksFile, JSON.stringify(scheduledTasks, null, 2));
  } catch (err) {
    console.error('Error saving scheduled tasks:', err);
  }
}

// Check every minute for due tasks
setInterval(async () => {
  if (!clientReady || !whatsappClient) return;
  
  const now = new Date();
  const currentTs = now.getTime();
  let changed = false;

  for (let i = 0; i < scheduledTasks.length; i++) {
    const task = scheduledTasks[i];
    if (task.completed) continue;

    const taskTime = new Date(task.nextRunTime).getTime();
    if (currentTs >= taskTime) {
      console.log(`🚀 Executing scheduled task for ${task.recipient}`);
      try {
        await whatsappClient.sendMessage(task.recipient, task.message);
        messageLog.push({
          type: 'sent_scheduled',
          recipient: task.recipient,
          message: task.message,
          timestamp: new Date().toISOString(),
          status: 'success'
        });

        if (task.intervalMs && task.intervalMs > 0) {
          // Reschedule for next interval
          task.nextRunTime = new Date(currentTs + task.intervalMs).toISOString();
          task.lastRunTime = new Date().toISOString();
        } else {
          task.completed = true;
          task.lastRunTime = new Date().toISOString();
        }
        changed = true;
      } catch (err) {
        console.error(`❌ Failed to send scheduled message to ${task.recipient}:`, err.message);
        task.error = err.message;
        changed = true;
      }
    }
  }

  if (changed) saveScheduledTasks();
}, 60000);

// ============ Initialize WhatsApp Client ============
async function initWhatsApp() {
  if (whatsappClient) return;
  
  clientReady = false;
  qrCodeData = null;

  const puppeteerOptions = {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-extensions',
      '--no-first-run',
      '--no-zygote',
      '--single-process',
      '--disable-gpu'
    ]
  };

  // Vercel / Serverless path detection
  if (process.env.VERCEL) {
    try {
      const chromium = require('@sparticuz/chromium');
      puppeteerOptions.executablePath = await chromium.executablePath();
    } catch (e) {
      console.warn('⚠ Chromium for Vercel not found. Using default paths.');
    }
  }

  whatsappClient = new Client({
    authStrategy: new LocalAuth({
      clientId: 'shah-007-agent',
      dataPath: path.join(__dirname, '.wwebjs_auth')
    }),
    puppeteer: puppeteerOptions,
    webVersionCache: {
      type: 'remote',
      remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html'
    }
  });

  whatsappClient.on('qr', async (qr) => {
    console.log('📱 QR Code received — scan from the UI');
    connectionStatus = 'qr_ready';
    try {
      qrCodeData = await QRCode.toDataURL(qr, { width: 300, margin: 2 });
    } catch (err) {
      console.error('QR Code generation error:', err);
    }
  });

  whatsappClient.on('ready', () => {
    console.log('✅ WhatsApp Client is ready!');
    clientReady = true;
    connectionStatus = 'connected';
    qrCodeData = null;
  });

  whatsappClient.on('authenticated', () => {
    console.log('🔐 WhatsApp Client authenticated');
    connectionStatus = 'connecting';
  });

  whatsappClient.on('auth_failure', (msg) => {
    console.error('❌ Authentication failure:', msg);
    connectionStatus = 'disconnected';
    clientReady = false;
  });

  whatsappClient.on('disconnected', (reason) => {
    console.log('🔌 WhatsApp Client disconnected:', reason);
    connectionStatus = 'disconnected';
    clientReady = false;
    qrCodeData = null;
  });

  connectionStatus = 'connecting';
  whatsappClient.initialize().catch(err => {
    console.error('WhatsApp initialization error:', err);
    connectionStatus = 'disconnected';
  });
}

// ============ Helpers ============

// Extract phone numbers from text
function extractPhoneNumbers(text) {
  const phoneRegex = /(?:\+?\d{1,4}[\s\-.]?)?\(?\d{1,4}\)?[\s\-.]?\d{1,4}[\s\-.]?\d{1,9}/g;
  const matches = text.match(phoneRegex) || [];

  const numbers = matches
    .map(num => num.replace(/[\s\-.\(\)]/g, ''))
    .filter(num => {
      const digitsOnly = num.replace(/\+/g, '');
      return digitsOnly.length >= 7 && digitsOnly.length <= 15;
    })
    .map(num => {
      if (num.startsWith('+')) {
        return num.replace('+', '');
      }
      if (num.length === 10) {
        return '91' + num;
      }
      return num;
    });

  return [...new Set(numbers)];
}

// Parse uploaded file
async function parseFile(filePath, originalName) {
  const ext = path.extname(originalName).toLowerCase();
  let text = '';

  try {
    if (ext === '.txt' || ext === '.csv') {
      text = fs.readFileSync(filePath, 'utf-8');
    } else if (ext === '.pdf') {
      const dataBuffer = fs.readFileSync(filePath);
      const pdfData = await pdfParse(dataBuffer);
      text = pdfData.text;
    } else if (ext === '.docx') {
      const result = await mammoth.extractRawText({ path: filePath });
      text = result.value;
    }
  } catch (err) {
    console.error('File parsing error:', err);
    throw new Error(`Failed to parse file: ${err.message}`);
  }

  return extractPhoneNumbers(text);
}

// ============ ROBUST MESSAGE SENDING ============
// Generate all possible number format variations to try
function generateNumberVariations(inputNumber) {
  if (inputNumber.includes('@g.us') || inputNumber.includes('@c.us') || inputNumber.includes('-')) {
    const isGroup = inputNumber.includes('@g.us') || inputNumber.includes('-');
    return [isGroup && !inputNumber.endsWith('@g.us') ? `${inputNumber}@g.us` : inputNumber];
  }

  const clean = inputNumber.replace(/[^\d]/g, '');
  const variations = new Set();

  // 1) The number as-is
  variations.add(clean);

  // 2) If it looks like an Indian 10-digit number, add with 91 prefix
  if (clean.length === 10) {
    variations.add('91' + clean);
  }

  // 3) If starts with 91 and is 12 digits, also try without 91
  if (clean.startsWith('91') && clean.length === 12) {
    variations.add(clean);  // keep with 91
    variations.add(clean.substring(2));  // try without 91 (for getNumberId)
  }

  // 4) If starts with 0, strip the leading zero and try with 91
  if (clean.startsWith('0')) {
    const withoutZero = clean.substring(1);
    variations.add(withoutZero);
    if (withoutZero.length === 10) {
      variations.add('91' + withoutZero);
    }
  }

  // 5) If has country code + leading zero (e.g., 910XXXXXXXXX)
  if (clean.length > 10) {
    const stripped = clean.replace(/^(\d{1,4})0/, '$1');
    if (stripped !== clean) {
      variations.add(stripped);
    }
  }

  return [...variations];
}

async function sendWhatsAppMessage(number, message) {
  let cleanNumber = String(number).trim();

  // --- Handle Group IDs directly ---
  if (cleanNumber.endsWith('@g.us')) {
    console.log(`\n  → Sending to Group: ${cleanNumber}`);
    try {
      // Open the chat object first (avoids LID caching issues)
      const chat = await whatsappClient.getChatById(cleanNumber);
      await chat.sendMessage(message);
      console.log(`  ✅ Sent to Group ${cleanNumber}`);
      return { success: true, method: 'group', resolvedId: cleanNumber };
    } catch (err) {
      console.error(`  ❌ Group send failed:`, err.message);
      return { success: false, error: err.message || 'Group send failed' };
    }
  }

  // --- Handle regular contact numbers ---
  const digits = cleanNumber.replace(/[^0-9]/g, '');
  const variations = [];

  if (digits.length === 10) {
    // 10-digit local number → try with +91 first, then raw
    variations.push(`91${digits}`);
    variations.push(digits);
  } else if (digits.length === 12 && digits.startsWith('91')) {
    // Already has country code
    variations.push(digits);
    variations.push(digits.substring(2)); // also try without 91
  } else if (digits.length > 0) {
    variations.push(digits);
  }

  console.log(`\n  → Trying variations: ${variations.join(', ')}`);

  for (const variant of variations) {
    try {
      // Use getNumberId to verify the number exists on WhatsApp
      const numberId = await whatsappClient.getNumberId(variant);
      if (numberId && numberId._serialized) {
        const chatId = numberId._serialized;
        console.log(`  ✓ Verified: ${variant} → ${chatId}`);
        // KEY FIX: Use getChatById + chat.sendMessage() to bypass "No LID for user"
        const chat = await whatsappClient.getChatById(chatId);
        await chat.sendMessage(message);
        console.log(`  ✅ Sent to ${chatId}`);
        return { success: true, method: 'chat-object', resolvedId: chatId };
      }
    } catch (err) {
      console.log(`  ✗ Failed for ${variant}: ${err.message}`);
    }
  }

  return { success: false, error: `Number not found on WhatsApp (tried: ${variations.join(', ')})` };
}

// ============ CHAT ANALYZER ENGINE ============

// Escape regex special chars
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const SEARCH_STOP_WORDS = new Set([
  'a', 'an', 'and', 'all', 'are', 'as', 'at', 'be', 'by', 'chat', 'chats', 'for',
  'from', 'group', 'groups', 'hello', 'i', 'if', 'in', 'into', 'is', 'it', 'let',
  'me', 'message', 'messages', 'my', 'need', 'of', 'on', 'or', 'please', 'provide',
  'requirements', 'search', 'show', 'summary', 'that', 'the', 'their', 'them',
  'there', 'these', 'this', 'till', 'to', 'today', 'unread', 'until', 'view',
  'want', 'what', 'who', 'with', 'you', 'your'
]);

const REQUIREMENT_HINT_WORDS = [
  'need', 'require', 'required', 'want', 'looking for', 'searching', 'urgent',
  'asap', 'immediately', 'help', 'needed', 'interested', 'chahiye', 'zarurat',
  'mangta', 'dedo', 'bhejo', 'please send', 'can you', 'do you have', 'is there',
  'anyone', 'koi hai', 'available'
];

function normalizeText(value = '') {
  return String(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9+]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeText(value = '') {
  return normalizeText(value).split(/[^a-z0-9+]+/).filter(Boolean);
}

function uniqueStrings(values) {
  const seen = new Set();
  const output = [];

  for (const value of values) {
    const cleaned = String(value || '').trim();
    const normalized = normalizeText(cleaned);
    if (!cleaned || !normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(cleaned);
  }

  return output;
}

function extractDigits(value = '') {
  return String(value).replace(/\D/g, '');
}

function countOccurrences(haystack, needle) {
  if (!haystack || !needle) return 0;

  let count = 0;
  let position = 0;

  while (true) {
    position = haystack.indexOf(needle, position);
    if (position === -1) break;
    count++;
    position += needle.length;
  }

  return count;
}

function extractQuotedPhrases(text = '') {
  const matches = [];
  const regex = /["'`“”‘’]([^"'`“”‘’]{2,80})["'`“”‘’]/g;
  let match;

  while ((match = regex.exec(String(text))) !== null) {
    matches.push(match[1].trim());
  }

  return matches;
}

function parseSearchTerms({ keywords = [], query = '' } = {}) {
  const rawValues = [
    ...((Array.isArray(keywords) ? keywords : []).map(value => String(value || '').trim())),
    String(query || '').trim()
  ].filter(Boolean);

  const candidateTerms = [];

  for (const value of rawValues) {
    candidateTerms.push(...extractQuotedPhrases(value));

    if (value.includes(',')) {
      candidateTerms.push(...value.split(',').map(part => part.trim()));
    } else if (value.length <= 80) {
      candidateTerms.push(value);
    }

    const focusedMatch = value.match(/(?:about|for|keyword|keywords|mentioning|containing|regarding)\s+(.+)/i);
    if (focusedMatch && focusedMatch[1]) {
      candidateTerms.push(focusedMatch[1].trim());
    }

    const tokens = tokenizeText(value)
      .filter(token => token.length > 2 && !SEARCH_STOP_WORDS.has(token))
      .slice(0, 12);
    candidateTerms.push(...tokens);
  }

  return uniqueStrings(candidateTerms).slice(0, 20);
}

// Compute relevance score for a message against search terms
function computeRelevance(messageBody, keywords, options = {}) {
  const body = normalizeText(messageBody);
  if (!body) return { score: 0, matchedTerms: [] };

  const fuzzy = Boolean(options.fuzzy);
  const bodyTokens = [...new Set(tokenizeText(body))];
  let score = 0;
  const matchedTerms = new Set();

  for (const keyword of keywords) {
    const normalizedKeyword = normalizeText(keyword);
    if (!normalizedKeyword) continue;

    const keywordTokens = tokenizeText(normalizedKeyword);
    if (keywordTokens.length === 0) continue;

    let termScore = 0;

    if (body.includes(normalizedKeyword)) {
      const occurrenceCount = countOccurrences(body, normalizedKeyword);
      termScore += 25 + (occurrenceCount * 10);
      matchedTerms.add(keyword);
    } else if (keywordTokens.length > 1 && keywordTokens.every(token => bodyTokens.includes(token))) {
      termScore += keywordTokens.length * 10;
      matchedTerms.add(keyword);
    } else {
      let tokenHits = 0;

      for (const token of keywordTokens) {
        if (bodyTokens.includes(token)) {
          tokenHits++;
          continue;
        }

        if (!fuzzy || token.length < 4) continue;

        let bestSimilarity = 0;
        for (const candidate of bodyTokens) {
          if (Math.abs(candidate.length - token.length) > 2) continue;
          bestSimilarity = Math.max(bestSimilarity, jaroWinkler(candidate, token));
        }

        if (bestSimilarity >= 0.9) tokenHits += 0.9;
        else if (bestSimilarity >= 0.84) tokenHits += 0.55;
      }

      if (tokenHits > 0) {
        termScore += Math.round(tokenHits * 8);
        matchedTerms.add(keyword);
      }
    }

    if (termScore > 0 && body.startsWith(normalizedKeyword)) termScore += 5;
    score += termScore;
  }

  if (matchedTerms.size > 1) score += matchedTerms.size * 5;

  for (const hintWord of REQUIREMENT_HINT_WORDS) {
    if (body.includes(hintWord)) score += 3;
  }

  return { score, matchedTerms: [...matchedTerms] };
}

// Jaro-Winkler similarity for fuzzy matching
function jaroWinkler(s1, s2) {
  if (s1 === s2) return 1.0;
  const len1 = s1.length, len2 = s2.length;
  if (len1 === 0 || len2 === 0) return 0.0;

  const maxDist = Math.floor(Math.max(len1, len2) / 2) - 1;
  const s1Matches = new Array(len1).fill(false);
  const s2Matches = new Array(len2).fill(false);

  let matches = 0, transpositions = 0;

  for (let i = 0; i < len1; i++) {
    const start = Math.max(0, i - maxDist);
    const end = Math.min(i + maxDist + 1, len2);
    for (let j = start; j < end; j++) {
      if (s2Matches[j] || s1[i] !== s2[j]) continue;
      s1Matches[i] = true;
      s2Matches[j] = true;
      matches++;
      break;
    }
  }

  if (matches === 0) return 0.0;

  let k = 0;
  for (let i = 0; i < len1; i++) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) k++;
    if (s1[i] !== s2[k]) transpositions++;
    k++;
  }

  const jaro = (matches / len1 + matches / len2 + (matches - transpositions / 2) / matches) / 3;

  let prefix = 0;
  for (let i = 0; i < Math.min(4, Math.min(len1, len2)); i++) {
    if (s1[i] === s2[i]) prefix++;
    else break;
  }

  return jaro + prefix * 0.1 * (1 - jaro);
}



function highlightMatches(text, keywords) {
  let highlighted = text;
  for (const kw of uniqueStrings(keywords).sort((a, b) => b.length - a.length)) {
    const regex = new RegExp(`(${escapeRegex(kw)})`, 'gi');
    highlighted = highlighted.replace(regex, '**$1**');
  }
  return highlighted;
}

function extractDigits(str) {
  if (!str) return '';
  return String(str).replace(/[^\d]/g, '');
}

function formatAnalyzerDateTime(timestamp) {
  if (!timestamp) return '';
  return new Date(timestamp * 1000).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    dateStyle: 'medium',
    timeStyle: 'short'
  });
}

function getChatDisplayName(chat) {
  return chat.name || chat.pushname || extractDigits(chat.id?.user) || chat.id?.user || 'Unknown Chat';
}

async function resolveMessageContact(msg, chat) {
  let senderName = '';
  // Use author if it exists (groups), else 'from'
  const authorId = msg.author || msg.from;
  let senderNumber = extractDigits(authorId || '');

  // Optimization: If it's a personal chat and from me, it's 'You'
  if (msg.fromMe) return { senderName: 'You', senderNumber: '' };
  
  // Optimization: If it's a personal chat and NOT from me, it's the chat name
  if (chat && !chat.isGroup) {
     return { senderName: getChatDisplayName(chat), senderNumber: extractDigits(chat.id?.user || '') };
  }

  try {
    // For groups, we might need to fetch the contact, but let's try to avoid it if slow
    // Maybe we can skip it for very large summaries to increase speed?
    const contact = await msg.getContact();
    senderName = contact.pushname || contact.name || contact.shortName || senderName;
    senderNumber = contact.number || senderNumber;
  } catch (err) {
    console.warn(`Contact resolution error: ${err.message}`);
  }

  if (!senderName) senderName = senderNumber ? `+${senderNumber}` : 'Unknown';
  return { senderName, senderNumber };
}

async function buildMessageResult(chat, msg, matchedTerms, relevance = 0) {
  const { senderName, senderNumber } = await resolveMessageContact(msg, chat);

  return {
    chatId: chat.id._serialized,
    chatName: getChatDisplayName(chat),
    isGroup: Boolean(chat.isGroup),
    messageId: msg.id._serialized,
    body: msg.body,
    highlighted: highlightMatches(msg.body, matchedTerms),
    senderName,
    senderNumber,
    timestamp: msg.timestamp,
    dateTime: formatAnalyzerDateTime(msg.timestamp),
    relevance,
    matchedTerms,
    fromMe: Boolean(msg.fromMe)
  };
}

function buildPersonResults(results) {
  const byPerson = {};

  for (const result of results) {
    const key = result.senderNumber || result.senderName || 'Unknown';
    if (!byPerson[key]) {
      byPerson[key] = {
        name: result.senderName || 'Unknown',
        number: result.senderNumber,
        messages: [],
        totalRelevance: 0,
        chats: new Set()
      };
    }

    byPerson[key].messages.push(result);
    byPerson[key].totalRelevance += result.relevance || 0;
    byPerson[key].chats.add(result.chatName);
  }

  return Object.values(byPerson)
    .map(person => ({ ...person, chats: [...person.chats] }))
    .sort((a, b) => b.totalRelevance - a.totalRelevance);
}

function cleanCapturedName(value = '') {
  return String(value)
    .replace(/\s+/g, ' ')
    .replace(/^(my|the)\s+/i, '')
    .trim();
}

function extractTargetChatNames(prompt = '') {
  const names = [...extractQuotedPhrases(prompt)];
  const patterns = [
    /(?:my|the)\s+([^.,\n]{2,80}?)\s+(?:group|chat)\b/gi,
    /(?:group|chat)\s+(?:named|called)\s+([^.,\n]{2,80})/gi,
    /\bsend\s+(?:the\s+)?(?:message|notification)\s+(?:to\s+)?(?:the\s+)?(?:contact|group\s+)?([^.,\n\s]{2,40})/gi, // "Send message to contact Legend"
    /\btalking\s+with\s+([^.,\n\s]{2,40})/gi,
    /\bsummary\s+of\s+([^.,\n\s]{2,40})/gi,
    /\bschedule\s+a?\s*(?:message|notification)\s+to\s+([^.,\n\s]{2,40})/gi // "Schedule message to Daddy"
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(prompt)) !== null) {
      const captured = cleanCapturedName(match[1]);
      if (captured.length >= 2 && !['chat', 'group', 'message', 'conversation', 'summary', 'contact', 'member', 'person'].includes(captured.toLowerCase())) {
        names.push(captured);
      }
    }
  }

  return uniqueStrings(names).filter(name => name.length >= 2);
}

function extractDaysRange(prompt = '') {
  const match = prompt.match(/\blast\s+(\d+)\s+days?\b/i);
  return match ? parseInt(match[1]) : null;
}

function extractPersonName(prompt = '') {
  const matches = prompt.match(/\b(?:profile|about|insight|analyze|person|summary\s+of)\s+([^.,\n\b]{2,40})(?:\s+in\s+|$|\.)/i);
  return matches ? matches[1].replace(/\b(?:the|my|of)\b/i, '').trim() : '';
}

function parseScheduling(prompt = '') {
  const normalized = prompt.toLowerCase();
  let intervalMs = 0;
  if (normalized.includes('daily') || normalized.includes('every day')) intervalMs = 24 * 60 * 60 * 1000;
  else if (normalized.includes('weekly')) intervalMs = 7 * 24 * 60 * 60 * 1000;
  else if (normalized.includes('hourly')) intervalMs = 60 * 60 * 1000;
  
  const timeMatch = normalized.match(/at\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i);
  const timeStr = timeMatch ? timeMatch[1] : '';
  
  return { intervalMs, targetTime: timeStr };
}

function detectTaskIntent(prompt = '') {
  const normalizedPrompt = normalizeText(prompt);
  const targetChatNames = extractTargetChatNames(prompt);
  const keywords = parseSearchTerms({ query: prompt })
    .filter(term => !targetChatNames.some(name => normalizeText(name) === normalizeText(term)));
  
  // Basic Flags
  const scanUnreadOnly = /\bunread\b|\bnot read\b|\bpending messages?\b/.test(normalizedPrompt);
  const isProfilingTask = /\bprofile\b|\binsights?\b|\blikings?\b|\bhobbies\b|\bdislikings?\b|\bbusiness\b|\bbackground\b|\barea of business\b|\babout\b|\bwho is\b/.test(normalizedPrompt);
  const isSchedulingTask = /\bschedule\b|\breminder\b|\bautomate\b|\bevery\b|\bat\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?|\bon\s+\d{1,2}[/-]\d{1,2}/.test(normalizedPrompt);
  const worksOnAll = /\ball\b|\beverything\b|\bevery\b/.test(normalizedPrompt) && targetChatNames.length === 0;

  const wantsSummary = /\bsummary\b|\bsummarize\b|\bsummarise\b|\banalyze\b|\banalyse\b|\boverview\b|\bdigest\b/.test(normalizedPrompt);
  const wantsSearch = /\bsearch\b|\bfind\b|\bshow\b|\blist\b|\blocate\b|\bkeyword\b|\bmessages?\b/.test(normalizedPrompt);
  const groupsOnly = /\bgroups?\b/.test(normalizedPrompt) && !/\bpersonal\b|\bdirect\b|\bcontact\b/.test(normalizedPrompt);
  const personalOnly = /\bpersonal\b|\bdirect chat\b|\bcontact\b/.test(normalizedPrompt) && !/\bgroups?\b/.test(normalizedPrompt);

  let taskType = 'summary';
  if (isSchedulingTask) taskType = 'scheduling';
  else if (isProfilingTask) taskType = 'profiling';
  else if (wantsSummary && wantsSearch) taskType = 'mixed';
  else if (wantsSearch && !wantsSummary) taskType = 'search';
  else if (prompt.toLowerCase().includes('send') || prompt.toLowerCase().includes('message')) taskType = 'action';

  const scheduling = parseScheduling(prompt);
  const personName = (extractPersonName(prompt) || targetChatNames[0] || '').trim();
  
  return {
    prompt: String(prompt || '').trim(),
    keywords: keywords.slice(0, 20),
    taskType,
    personName,
    targetChatNames,
    isProfilingTask,
    isSchedulingTask,
    scheduling,
    scanUnreadOnly,
    worksOnAll,
    groupsOnly,
    personalOnly,
    daysRange: extractDaysRange(prompt)
  };
}

function scoreChatMatch(chat, targetNames) {
  const chatName = normalizeText(getChatDisplayName(chat));
  if (!chatName) return 0;

  let bestScore = 0;

  for (const targetName of targetNames) {
    const normalizedTarget = normalizeText(targetName);
    if (!normalizedTarget) continue;

    if (chatName === normalizedTarget) {
      bestScore = Math.max(bestScore, 100);
      continue;
    }

    if (chatName.includes(normalizedTarget) || normalizedTarget.includes(chatName)) {
      bestScore = Math.max(bestScore, 75);
      continue;
    }

    const chatTokens = tokenizeText(chatName);
    const targetTokens = tokenizeText(normalizedTarget);
    const overlap = targetTokens.filter(token => chatTokens.includes(token)).length;

    if (overlap > 0) {
      bestScore = Math.max(bestScore, overlap * 18);
      continue;
    }

    let fuzzyScore = 0;
    for (const targetToken of targetTokens) {
      for (const chatToken of chatTokens) {
        if (Math.abs(targetToken.length - chatToken.length) > 2) continue;
        fuzzyScore = Math.max(fuzzyScore, Math.round(jaroWinkler(targetToken, chatToken) * 20));
      }
    }

    bestScore = Math.max(bestScore, fuzzyScore);
  }

  return bestScore;
}

function summarizeTopics(messages, keywords = []) {
  const blockedTokens = new Set([...SEARCH_STOP_WORDS, ...tokenizeText(keywords.join(' '))]);
  const frequencies = new Map();

  for (const message of messages) {
    for (const token of tokenizeText(message.body || '')) {
      if (token.length < 4 || blockedTokens.has(token)) continue;
      frequencies.set(token, (frequencies.get(token) || 0) + 1);
    }
  }

  return [...frequencies.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([token]) => token);
}

function buildFallbackSummary(messages, intent) {
  if (!messages.length) {
    return intent.scanUnreadOnly
      ? 'No unread messages matched this request.'
      : 'No matching messages were found for this request.';
  }

  const chatNames = [...new Set(messages.map(message => message.chatName))];
  const contactNames = [...new Set(messages.map(message => message.senderName).filter(Boolean))];
  const topics = summarizeTopics(messages, intent.keywords);
  const summaryParts = [];

  if (intent.scanUnreadOnly) {
    summaryParts.push(`Found ${messages.length} unread message${messages.length === 1 ? '' : 's'} in ${chatNames.length} chat${chatNames.length === 1 ? '' : 's'}.`);
  } else if (intent.keywords.length > 0) {
    summaryParts.push(`Found ${messages.length} message${messages.length === 1 ? '' : 's'} matching ${intent.keywords.join(', ')} across ${chatNames.length} chat${chatNames.length === 1 ? '' : 's'}.`);
  } else {
    summaryParts.push(`Analyzed ${messages.length} message${messages.length === 1 ? '' : 's'} across ${chatNames.length} chat${chatNames.length === 1 ? '' : 's'}.`);
  }

  if (chatNames.length === 1) {
    summaryParts.push(`Chat: ${chatNames[0]}.`);
  }

  if (contactNames.length > 0) {
    summaryParts.push(`Key contacts: ${contactNames.slice(0, 3).join(', ')}${contactNames.length > 3 ? ` and ${contactNames.length - 3} more` : ''}.`);
  }

  if (topics.length > 0) {
    summaryParts.push(`Common themes: ${topics.join(', ')}.`);
  }

  return summaryParts.join(' ');
}

async function maybeEnhanceSummary(prompt, fallbackSummary, messages) {
  if (!process.env.GEMINI_API_KEY || messages.length === 0) {
    return fallbackSummary;
  }

  try {
    const ai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = ai.getGenerativeModel({ model: 'gemini-1.5-pro' });
    const condensedMessages = messages.slice(0, 40).map((message, index) => (
      `${index + 1}. Group: ${message.chatName} | Contact: ${message.senderName}${message.senderNumber ? ` (+${message.senderNumber})` : ''} | Date/Time: ${message.dateTime} | Message: ${message.body.substring(0, 240)}`
    )).join('\n');

    const response = await model.generateContent(
      `You are summarizing WhatsApp messages for a user.\n` +
      `User request: ${prompt}\n` +
      `Fallback summary: ${fallbackSummary}\n` +
      `Write one concise paragraph in plain text, under 120 words, grounded only in the messages below.\n\n${condensedMessages}`
    );

    const text = response.response.text().trim();
    return text || fallbackSummary;
  } catch (err) {
    console.warn('Gemini summary enhancement failed:', err.message);
    return fallbackSummary;
  }
}

let analyzerChatList = [];
let contactCache = new Map();
let lastContactSync = 0;
const CONTACT_CACHE_TTL = 30 * 60 * 1000; // 30 minutes cache

// ============ UTILS ============

// Get WhatsApp connection status
app.get('/api/status', (req, res) => {
  res.json({
    status: connectionStatus,
    qrCode: qrCodeData,
    isReady: clientReady,
    messagingInProgress,
    stats: messagingStats
  });
});

// Connect to WhatsApp
app.post('/api/connect', (req, res) => {
  if (connectionStatus === 'connected') {
    return res.json({ success: true, message: 'Already connected' });
  }
  initializeWhatsApp();
  res.json({ success: true, message: 'Connecting to WhatsApp...' });
});

// Disconnect WhatsApp
app.post('/api/disconnect', async (req, res) => {
  try {
    if (whatsappClient) {
      await whatsappClient.destroy();
      whatsappClient = null;
    }
    clientReady = false;
    connectionStatus = 'disconnected';
    qrCodeData = null;
    res.json({ success: true, message: 'Disconnected' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Upload file and extract contacts
app.post('/api/upload', upload.single('contactFile'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    const numbers = await parseFile(req.file.path, req.file.originalname);
    try { fs.unlinkSync(req.file.path); } catch (e) {}

    if (numbers.length === 0) {
      return res.json({ success: true, message: 'No phone numbers found in the file.', contacts: [] });
    }

    res.json({ success: true, message: `Found ${numbers.length} phone number(s)`, contacts: numbers });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Extract contacts from pasted text
app.post('/api/extract-text', (req, res) => {
  try {
    const { text } = req.body;
    if (!text) {
      return res.status(400).json({ success: false, message: 'No text provided' });
    }
    const numbers = extractPhoneNumbers(text);
    res.json({ success: true, message: `Found ${numbers.length} phone number(s)`, contacts: numbers });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Send messages
app.post('/api/send', async (req, res) => {
  try {
    const { contacts, message } = req.body;

    if (!contacts || contacts.length === 0) {
      return res.status(400).json({ success: false, message: 'No contacts provided' });
    }
    if (!message || message.trim() === '') {
      return res.status(400).json({ success: false, message: 'No message provided' });
    }
    if (!clientReady) {
      return res.status(400).json({ success: false, message: 'WhatsApp is not connected. Please connect first.' });
    }
    if (messagingInProgress) {
      return res.status(400).json({ success: false, message: 'Messaging already in progress' });
    }

    messagingInProgress = true;
    messageLog = [];
    messagingStats = {
      total: contacts.length,
      sent: 0,
      failed: 0,
      pending: contacts.length
    };

    // Send messages asynchronously
    (async () => {
      for (let i = 0; i < contacts.length; i++) {
        const contact = contacts[i];
        console.log(`\n📤 Sending to ${contact} (${i + 1}/${contacts.length})...`);

        const result = await sendWhatsAppMessage(contact, message);

        if (result.success) {
          messagingStats.sent++;
          messagingStats.pending--;
          messageLog.push({
            contact,
            status: 'sent',
            method: result.method,
            resolvedId: result.resolvedId,
            timestamp: new Date().toISOString()
          });
          console.log(`  ✅ Sent via ${result.method} → ${result.resolvedId}`);
        } else {
          messagingStats.failed++;
          messagingStats.pending--;
          messageLog.push({
            contact,
            status: 'failed',
            error: result.error,
            timestamp: new Date().toISOString()
          });
          console.log(`  ❌ Failed: ${result.error}`);
        }

        // Random delay between 2-5 seconds to avoid detection
        if (i < contacts.length - 1) {
          const delay = Math.floor(Math.random() * 3000) + 2000;
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
      messagingInProgress = false;
      console.log(`\n🏁 Campaign complete: ${messagingStats.sent} sent, ${messagingStats.failed} failed\n`);
    })();

    res.json({ success: true, message: `Started sending messages to ${contacts.length} contacts` });
  } catch (err) {
    messagingInProgress = false;
    res.status(500).json({ success: false, message: err.message });
  }
});

// Get message log
app.get('/api/log', (req, res) => {
  res.json({
    log: messageLog,
    stats: messagingStats,
    inProgress: messagingInProgress
  });
});

// Reset message log
app.post('/api/reset', (req, res) => {
  messageLog = [];
  messagingStats = { total: 0, sent: 0, failed: 0, pending: 0 };
  messagingInProgress = false;
  res.json({ success: true });
});

// ============ CHAT ANALYZER API ============

// Get all chats (groups + personal)
app.get('/api/analyzer/chats', async (req, res) => {
  try {
    if (!clientReady) {
      return res.status(400).json({ success: false, message: 'WhatsApp not connected' });
    }

    // High Speed Sync Strategy:
    // 1. Fetch all chats and contacts in parallel
    // 2. Map chats against contact book for instant name resolution
    const [chats, allContacts] = await Promise.all([
      whatsappClient.getChats(),
      (Date.now() - lastContactSync > CONTACT_CACHE_TTL) ? whatsappClient.getContacts() : Promise.resolve([])
    ]);

    // Update cache if new contacts fetched
    if (allContacts.length > 0) {
      allContacts.forEach(c => {
        if (c.id && c.id._serialized) contactCache.set(c.id._serialized, c);
      });
      lastContactSync = Date.now();
    }

    const chatList = chats.map(chat => {
      const contactId = chat.id._serialized;
      const cachedContact = contactCache.get(contactId);
      
      let name = chat.name || (cachedContact ? cachedContact.name || cachedContact.pushname : '');
      if (!name) name = getChatDisplayName(chat);

      return {
        id: chat.id._serialized,
        name: name,
        isGroup: Boolean(chat.isGroup),
        contactNumber: chat.isGroup ? '' : extractDigits(chat.id.user),
        unreadCount: chat.unreadCount || 0,
        timestamp: chat.timestamp || (chat.lastMessage ? chat.lastMessage.timestamp : 0),
        lastActivityText: formatAnalyzerDateTime(chat.timestamp || (chat.lastMessage ? chat.lastMessage.timestamp : 0)),
        pinned: Boolean(chat.pinned),
        lastMessage: chat.lastMessage ? {
          body: chat.lastMessage.body ? (typeof chat.lastMessage.body === 'string' ? chat.lastMessage.body.substring(0, 60) : '[Media]') : '',
          timestamp: chat.lastMessage.timestamp
        } : null
      };
    });

    // Instant Sorting
    chatList.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      if (b.unreadCount !== a.unreadCount) return b.unreadCount - a.unreadCount;
      return (b.timestamp || 0) - (a.timestamp || 0);
    });

    res.json({ success: true, chats: chatList, total: chatList.length });
  } catch (err) {
    console.error('Error fetching chats:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Preferred deep-search route with stronger keyword parsing and cleaner results.
app.post('/api/analyzer/search', async (req, res) => {
  try {
    if (!clientReady) {
      return res.status(400).json({ success: false, message: 'WhatsApp not connected' });
    }

    const {
      keywords = [],
      query = '',
      chatIds = [],
      searchGroups = true,
      searchPersonal = true,
      messageLimit = 200,
      fuzzy = true,
      minRelevance = 5
    } = req.body;

    const parsedKeywords = parseSearchTerms({ keywords, query });
    if (parsedKeywords.length === 0) {
      return res.status(400).json({ success: false, message: 'No search keywords provided' });
    }

    const allChats = await whatsappClient.getChats();
    let targetChats = allChats;

    if (chatIds.length > 0) {
      targetChats = allChats.filter(chat => chatIds.includes(chat.id._serialized));
    }

    targetChats = targetChats.filter(chat => {
      if (chat.isGroup && !searchGroups) return false;
      if (!chat.isGroup && !searchPersonal) return false;
      return true;
    });

    const results = [];
    let chatsScanned = 0;
    let totalMessages = 0;

    // Split into chunks to balance speed and stability
    const CHUNK_SIZE = 2;
    for (let i = 0; i < targetChats.length; i += CHUNK_SIZE) {
      const chunk = targetChats.slice(i, i + CHUNK_SIZE);
      await Promise.all(chunk.map(async (chat) => {
        chatsScanned++;
        try {
          // Add a tiny random jitter to avoid all calls hitting exactly at once
          await new Promise(r => setTimeout(r, Math.random() * 500));
          
          let messages = [];
          try {
            messages = await chat.fetchMessages({ limit: messageLimit });
          } catch (fetchErr) {
            console.warn(`⚠️ First fetch attempt failed for ${chat.name}, retrying...`);
            await new Promise(r => setTimeout(r, 1000));
            messages = await chat.fetchMessages({ limit: messageLimit });
          }
          
          totalMessages += messages.length;

          for (const msg of messages) {
            if (!msg.body || !msg.body.trim()) continue;

            const { score, matchedTerms } = computeRelevance(msg.body, parsedKeywords, { fuzzy });
            if (score < minRelevance) continue;

            results.push(await buildMessageResult(chat, msg, matchedTerms, score));
          }
        } catch (err) {
          console.log(`Fetch failed for ${chat.name}: ${err.message}`);
        }
      }));
    }

    results.sort((a, b) => (b.relevance - a.relevance) || (b.timestamp - a.timestamp));
    const personResults = buildPersonResults(results);
    const matchedChatCount = new Set(results.map(result => result.chatId)).size;

    // Generate a structured "By Message" summary text
    let byMessageText = "";
    if (results.length > 0) {
      byMessageText = "By Message\n";
      for (const r of results.slice(0, 50)) {
        byMessageText += `\n---\n`;
        byMessageText += `Group: ${r.chatName}\n`;
        byMessageText += `Contact: ${r.senderName} (${r.senderNumber ? '+' + r.senderNumber : 'No Number'})\n`;
        byMessageText += `Date/Time: ${r.dateTime}\n`;
        byMessageText += `Message: ${r.body}\n`;
      }
    }

    res.json({
      success: true,
      results,
      byPerson: personResults,
      aiResponse: byMessageText,
      summary: results.length
        ? `Found ${results.length} matching message${results.length === 1 ? '' : 's'} across ${matchedChatCount} chat${matchedChatCount === 1 ? '' : 's'}.`
        : 'No matching messages found.',
      stats: {
        totalMatches: results.length,
        chatsScanned,
        messagesScanned: totalMessages,
        uniquePeople: personResults.length,
        keywords: parsedKeywords
      }
    });
  } catch (err) {
    console.error('Analyzer search error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/analyzer/ai', async (req, res) => {
  try {
    if (!clientReady) {
      return res.status(400).json({ success: false, message: 'WhatsApp not connected' });
    }
    const { prompt, chatIds = [], timeRange = 30, messageLimit = 200 } = req.body;
    if (!prompt) return res.status(400).json({ success: false, message: 'Prompt required' });

    if (!process.env.GEMINI_API_KEY) {
      return res.status(400).json({ success: false, message: 'Gemini API key is not configured in .env file.' });
    }

    const ai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = ai.getGenerativeModel({ model: 'gemini-1.5-pro' });
    const currentDateTime = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

    // ── Step 1: Parse intent ──────────────────────────────────────────────────
    const intent = detectTaskIntent(prompt);
    
    // Override timeRange if prompt specifies days
    const overrideDays = intent.daysRange || extractDaysRange(prompt);
    const activeTimeRange = overrideDays || parseInt(timeRange) || 7;
    
    // Adjust message limit based on time range to ensure we get a full analysis
    const adjustedLimit = overrideDays ? Math.max(parseInt(messageLimit), overrideDays * 40) : parseInt(messageLimit);

    // ── Step 2: Find target chats ─────────────────────────────────────────────
    const allChats = await whatsappClient.getChats();
    let targetChats = allChats;

    if (chatIds.length > 0) {
      targetChats = targetChats.filter(c => chatIds.includes(c.id._serialized));
    }

    if (intent.targetChatNames && intent.targetChatNames.length > 0) {
      const names = intent.targetChatNames.map(n => n.toLowerCase().trim());
      const filtered = targetChats.filter(c => {
        const cn = (c.name || '').toLowerCase();
        return names.some(n => cn.includes(n) || n.includes(cn));
      });
      if (filtered.length > 0) targetChats = filtered;
    }

    // ── Step 2: Handle Scheduling & Immediate Actions ──────────────────────────
    if (intent.taskType === 'scheduling' || prompt.toLowerCase().includes('send') || prompt.toLowerCase().includes('message')) {
      const isImmediate = prompt.toLowerCase().includes('now') || prompt.toLowerCase().includes('immediately') || !intent.isSchedulingTask;
      const { intervalMs, targetTime } = intent.isSchedulingTask ? intent.scheduling : { intervalMs: 0, targetTime: '' };
      
      // Attempt to find recipient in targetChats or allChats
      const searchName = (intent.personName || intent.targetChatNames[0] || '').trim();
      
      if (!searchName || searchName.length < 2) {
        return res.json({ 
          success: true, 
          aiResponse: `I couldn't identify who to send this to. Please start your request with "Send message to [Name]..."`,
          messageCount: 0 
        });
      }

      let recipientObj = targetChats.find(c => 
        (c.name || '').toLowerCase().includes(searchName.toLowerCase())
      );

      if (!recipientObj && searchName) {
         // Deep search in all chats if not in targets
         recipientObj = allChats.find(c => 
           (c.name || '').toLowerCase().includes(searchName.toLowerCase()) ||
           (c.id.user === searchName)
         );
      }

      if (!recipientObj) {
        return res.json({ 
          success: true, 
          aiResponse: `I couldn't clearly identify the recipient for "${searchName}". Please check the contact name and try again.` 
        });
      }

      const messageContent = prompt.split(/send|message|remind|automate/i).pop()
                            .replace(/\b(?:now|immediately|to contact|to)\b/i, '')
                            .replace(new RegExp(searchName, 'i'), '')
                            .trim();

      if (isImmediate && !intent.isSchedulingTask) {
        try {
          // Attempt immediate delivery
          await whatsappClient.sendMessage(recipientObj.id._serialized, messageContent);
          return res.json({
            success: true,
            aiResponse: `✅ **Sent Successfully!**\n\nI've sent the message to **${recipientObj.name}** right now.\n\n**Record:** "${messageContent}"`,
            messageCount: 0
          });
        } catch (immediateErr) {
          console.warn(`Immediate delivery failed, fallback to schedule: ${immediateErr.message}`);
          // If it's a "detached frame" error, it likely means the browser needs re-init or the page is busy.
        }
      }

      // Calculate next run time
      let nextRun = new Date();
      if (targetTime) {
        const [time, modifier] = targetTime.split(/(am|pm)/i);
        let [hours, minutes] = time.trim().split(':');
        hours = parseInt(hours);
        minutes = parseInt(minutes) || 0;
        if (modifier && modifier.toLowerCase() === 'pm' && hours < 12) hours += 12;
        if (modifier && modifier.toLowerCase() === 'am' && hours === 12) hours = 0;
        nextRun.setHours(hours, minutes, 0, 0);
        if (nextRun < new Date()) nextRun.setDate(nextRun.getDate() + 1);
      } else {
        nextRun.setMinutes(nextRun.getMinutes() + 1); // 1 minute from now
      }

      const newTask = {
        id: Date.now(),
        recipient: recipientObj.id._serialized,
        recipientName: recipientObj.name,
        message: messageContent,
        nextRunTime: nextRun.toISOString(),
        intervalMs: intervalMs,
        completed: false
      };

      scheduledTasks.push(newTask);
      saveScheduledTasks();

      return res.json({
        success: true,
        aiResponse: `✅ **Task Scheduled Successfully!**\n\nI've queued this for **${recipientObj.name}** to be sent at **${nextRun.toLocaleString('en-IN')}**.\n` +
                   (intervalMs ? `This task will repeat every ${intervalMs / (60 * 60 * 1000)} hours.\n` : '') +
                   `Message: "${messageContent}"`,
        messageCount: 0
      });
    }

    // ── Step 3: Collect messages for Analysis/Profiling ───────────────────────
    const results = [];
    const cutoffTime = (Date.now() / 1000) - (activeTimeRange * 24 * 60 * 60);
    const limit = Math.min(adjustedLimit || 300, 3000);

    // Filter chats strictly if names are provided
    let chatsToScan = targetChats;
    const hasSpecificScanTarget = intent.targetChatNames && intent.targetChatNames.length > 0;
    
    if (hasSpecificScanTarget) {
      // We already filtered targetChats at line 1201
      chatsToScan = targetChats;
    } else if (intent.worksOnAll) {
      chatsToScan = allChats;
    }

    // Balanced concurrency for stability & Speed (Increased for commercial needs)
    const CONCURRENCY_LIMIT = 12; 
    console.log(`\n🚀 High-Speed Scan: ${chatsToScan.length} chats for "${prompt}"...`);    
    for (let i = 0; i < chatsToScan.length; i += CONCURRENCY_LIMIT) {
      const chunk = chatsToScan.slice(i, i + CONCURRENCY_LIMIT);
      
      await Promise.all(chunk.map(async (chat) => {
        try {
          // Dynamic Fetching: Only fetch what's needed
          let fetchLimit = limit;
          if (intent.scanUnreadOnly) {
            fetchLimit = Math.max(chat.unreadCount || 0, 15); 
          } else if (hasSpecificScanTarget) {
             fetchLimit = limit; 
          } else {
             fetchLimit = 75; // Balanced fetch for wide scans
          }
          
          const timeoutMs = hasSpecificScanTarget ? 60000 : 15000;
          
          const msgs = await Promise.race([
            chat.fetchMessages({ limit: fetchLimit }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Fetch Timeout')), timeoutMs))
          ]);

          if (!msgs || !Array.isArray(msgs)) return;

          const msgsToAnalyze = intent.scanUnreadOnly && chat.unreadCount > 0 
            ? msgs.slice(-chat.unreadCount) 
            : msgs;

          for (const msg of msgsToAnalyze) {
            if (!msg.body || !msg.body.trim()) continue;
            
            // Fast Time filtering
            if (!intent.scanUnreadOnly && !intent.isProfilingTask && msg.timestamp < cutoffTime) continue;

            // High-Performance Compiled Regex Matching
            if (!hasSpecificScanTarget && intent.keywords.length > 0) {
              const kwRegex = new RegExp(intent.keywords.join('|'), 'i');
              if (!kwRegex.test(msg.body)) continue;
            }

            results.push(await buildMessageResult(chat, msg, intent.keywords, 150));
          }
        } catch (err) {
          // Silent speed-mode failover
        }
      }));
    }

    if (results.length === 0) {
      return res.json({ 
        success: true, 
        aiResponse: `No relevant messages found for ${intent.taskType === 'profiling' ? 'person "' + (intent.personName || 'specified') + '"' : 'your query'}. Ensure valid connection and correct names are used.`, 
        results: [],
        messageCount: 0 
      });
    }

    // ── Step 4: AI Context & Generation ───────────────────────────────────────
    results.sort((a, b) => b.timestamp - a.timestamp);
    
    // Accuracy Boost: Chain-of-Thought Prompting
    const analysisPrompt = intent.taskType === 'profiling' 
      ? `You are an Elite Data Analyst. Profile "${intent.personName}" with high accuracy.\n` +
        `PROCESS: \n` +
        `1. Analyze tone and sentiment from the Context.\n` +
        `2. Identify recurring intent or professional background.\n` +
        `3. Provide a Persona Summary in a structured Dossier format.\n\n` +
        `CONTEXT (MESSAGES for ${intent.personName}):\n`
      : `You are a High-Performance Intelligence Agent. Respond accurately and efficiently.\n` +
        `COMMAND: "${prompt}"\n\n` +
        `RULES FOR ACCURACY:\n` +
        `- Step-by-Step Reason: Think about each relevant message before summarizing.\n` +
        `- Target Data: Focus on Project Requirements, Skills (React, Ads), and Contact Leads.\n` +
        `- Professional Triage: Prioritize items that require immediate user action.\n\n` +
        `CONTEXT (WHATSAPP DATA):\n`;

    const chatContext = results.slice(0, 80).map((r, i) => 
      `[M-${i+1}] ${r.dateTime} | Chat: ${r.chatName} | Sender: ${r.senderName} | Content: ${r.body.substring(0, 500)}`
    ).join('\n');

    const response = await model.generateContent(
      analysisPrompt + chatContext + 
      `\n\nFINAL INSTRUCTIONS FOR OUTPUT:\n` +
      `1. Be extremely concise and professional.\n` +
      `2. For dossiers: Use bullet points for Persona sections.\n` +
      `3. For triage: Prioritize by urgency. Group by chat if helpful.\n` +
      `4. DO NOT reference message ID numbers (e.g. [M-1]) in the final text unless necessary for clarity.\n` +
      `5. Use local timestamp alignment in all references.`
    );

    const summaryText = response.response.text();

    let responseText = `### ${intent.taskType === 'profiling' ? '👤 Member Briefing: ' + intent.personName : '📑 Intelligence Triage Result'}\n\n` + 
                      summaryText + "\n\n---\n\n### Intelligence Source References\n";
    for (const r of results.slice(0, 40)) {
      responseText += `\n---\n`;
      responseText += `**Source Chat:** ${r.chatName}\n`;
      responseText += `**Data Origin:** ${r.senderName}\n`;
      responseText += `**Indexed At:** ${r.dateTime}\n`;
      responseText += `**Original Record:** ${r.body}\n`;
    }

    res.json({ 
      success: true, 
      aiResponse: responseText, 
      results: results,
      messageCount: results.length,
      stats: {
        totalMatches: results.length,
        chatsScanned: targetChats.length,
        keywords: intent.keywords
      }
    });

  } catch (err) {
    console.error('AI error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n🤖 WhatsApp Messaging Agent running at http://localhost:${PORT}`);
  console.log('   Click "Connect WhatsApp" in the UI to start.\n');
});
