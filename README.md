# 🤖 WhatsApp Messaging AI Agent

An intelligent, AI-powered WhatsApp message automation agent with a premium web interface. Import contacts from files (PDF, TXT, CSV, DOCX) or paste them directly, compose your message, and send it to all contacts automatically via WhatsApp Web.

---

## ✨ Features

- **🔗 WhatsApp Web Integration** — Connect your WhatsApp via QR code scanning
- **📁 Multi-Format File Import** — Upload contacts from `.txt`, `.pdf`, `.csv`, and `.docx` files
- **📋 Paste & Extract** — Paste raw text and extract phone numbers automatically
- **✏️ Manual Entry** — Add contacts one at a time
- **📝 Message Templates** — Pre-built templates for greetings, promos, and reminders
- **📱 Live Preview** — See your message in a phone mockup before sending
- **📊 Real-Time Progress** — Track sending progress with live stats and logs
- **🎨 Premium Dark UI** — Glassmorphism, animations, and responsive design

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** v18+ installed
- **Google Chrome** (required by Puppeteer for WhatsApp Web)

### Installation

```bash
cd whatsapp-agent
npm install
```

### Running

```bash
npm start
# or
npm run dev
```

Open your browser to **http://localhost:3000**

---

## 📖 How to Use

### Step 1: Connect WhatsApp
1. Click **"Connect WhatsApp"**
2. A QR code will appear
3. Open WhatsApp on your phone → **Settings** → **Linked Devices** → **Link a Device**
4. Scan the QR code with your phone camera

### Step 2: Import Contacts
Choose one of three methods:
- **Upload File** — Drag & drop or browse for a `.txt`, `.pdf`, `.csv`, or `.docx` file
- **Paste Text** — Paste text containing phone numbers (any format)
- **Add Manually** — Type individual phone numbers

### Step 3: Compose Message
- Write your message in the text area
- Use **message templates** for quick drafts
- Preview your message in the phone mockup

### Step 4: Send & Review
- Review the summary (recipients, message length, estimated time)
- Click **"Start Sending Messages"**
- Monitor live progress and per-contact delivery logs

---

## 📞 Phone Number Formats

The agent supports various phone number formats:

| Format | Interpretation |
|--------|---------------|
| `+91 98765 43210` | India (+91) |
| `919876543210` | India (91 prefix) |
| `9876543210` | Defaults to India (+91) |
| `+1 (555) 123-4567` | US (+1) |
| `+44 20 7946 0958` | UK (+44) |

> **Note:** 10-digit numbers without a country code default to India (+91). For other countries, include the country code.

---

## ⚠️ Important Notes

1. **WhatsApp Terms of Service** — Use this tool responsibly. Mass messaging may violate WhatsApp's ToS and could result in account restrictions.
2. **Rate Limiting** — Messages are sent with random 2-5 second delays between each to reduce detection risk.
3. **Session Persistence** — Your WhatsApp session is saved locally in `.wwebjs_auth/`. You won't need to scan the QR code every time.
4. **Chrome Required** — Puppeteer runs Chromium in headless mode. Ensure Chrome is installed.

---

## 🛠 Tech Stack

- **Backend:** Node.js, Express.js
- **WhatsApp:** whatsapp-web.js (Puppeteer-based)
- **File Parsing:** pdf-parse, mammoth (DOCX)
- **Frontend:** Vanilla HTML/CSS/JS with premium design
- **QR Code:** qrcode library

---

## 📂 Project Structure

```
whatsapp-agent/
├── server.js              # Express server + WhatsApp client
├── package.json           # Dependencies
├── README.md              # This file
├── public/
│   ├── index.html         # Main UI
│   ├── styles.css         # Premium dark theme CSS
│   └── app.js             # Frontend logic
├── uploads/               # Temporary file uploads (auto-cleaned)
└── .wwebjs_auth/          # WhatsApp session data (auto-created)
```

---

## 📄 License

MIT — Use responsibly.
