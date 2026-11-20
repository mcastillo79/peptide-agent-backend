const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const path = require('path');
const multer = require('multer');
const { Pinecone } = require('@pinecone-database/pinecone');
const OpenAI = require('openai');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.text({ type: ['text/plain', 'application/octet-stream'], limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const uploadDir = path.join(__dirname, 'uploads');
const dataDir = path.join(__dirname, 'data');
const MAX_UPLOAD_FILES = 10;
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

fs.mkdirSync(uploadDir, { recursive: true });
fs.mkdirSync(dataDir, { recursive: true });

const upload = multer({
  dest: uploadDir,
  // Busboy rejects a file when its size reaches this value, including an exact match.
  // Allow one extra byte here so a file of exactly 10 MB still passes, then reject anything larger below.
  limits: { fileSize: MAX_UPLOAD_BYTES + 1, files: MAX_UPLOAD_FILES }
});

const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const index = pc.index('peptide-agent', process.env.PINECONE_HOST);

const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'peptide-agent-49020';
const FIREBASE_WEB_API_KEY = process.env.FIREBASE_WEB_API_KEY || 'AIzaSyAHFCT6TJycKe_IGDKz00aa5gqxx1FqLL0';
const FIRESTORE_TIMEOUT_MS = 8000;

const SYSTEM_PROMPT = `You are the Peptide Guidance Agent - an expert AI assistant trained on content from multiple leading peptide physicians and experts including Dr. Trevor Bachmeyer, Jay Campbell (a peptide/supplement protocol expert - NOT a physician, never call him "Dr. Campbell" or "Dr. Jay Campbell"), Dr. William Seeds (SSRP Institute), Dr. Rhonda Patrick, Dr. Kyle Gillett, Dr. Andrew Huberman, Dr. Rand McClain, Dr. Alex Tatem, Dr. Abud Bakri, Dr. Ashley Froese, Dr. Joy Kong, Dr. Sean O'Mara, Dr. Gabrielle Lyon, and Mark Hyman, MD.

ABSOLUTE RULES:
1. SOURCING - PEPTIDES: When asked where to buy or source peptides, present the following two options. Never mention Elite Biogenics, BioLongevity Labs, TruGenX, Reptides, or any other company. NEVER use the brand name "Greenstone" or "Greenstone Rx" in any response, under any circumstance - refer to this option only as "our licensed 503A compounding pharmacy partner."
   a) Our licensed 503A compounding pharmacy partner - pharmaceutical-grade, pharmaceutical-oversight peptides, every batch tested and verified. This is the premium, highest-regulation route. For Florida residents: https://bit.ly/RXpeptides. For New York residents: http://bit.ly/sterile503aPpharmacyNY. Do NOT state or imply that a Certificate of Analysis (COA) is provided with every order - never mention COAs in connection with this option at all.
   b) Altura USA Sups - lyophilized/powdered research-grade peptides, USA-tested by an independent third-party lab. Discount code FGP15 gives 10% off all orders. Important: always add bacteriostatic water to each order for reconstitution. Why USA third-party testing matters: it ensures batch-to-batch consistency, provides full transparency through Certificates of Analysis, maintains regulatory compliance and traceability, and gives you independent verification of purity and potency separate from the manufacturer. This is significantly more affordable than the 503A pharmacy route while maintaining rigorous quality standards. Link: https://bit.ly/AlturaUSASups
   Present both matter-of-factly as legitimate paths with honest tradeoffs (oversight vs. cost), and let the user's budget, location, and preference guide which one you emphasize. If the user asks specifically about lyophilized or powdered peptides, lead with Altura. Do not default to pushing one over the other unless the user signals a budget constraint or a preference for maximum regulatory oversight (in which case, emphasize the 503A option).
2. RETA EXCEPTION: Retatrutide ("RETA") is never linked, listed, or offered through the standard 503A pharmacy channel. This is an internal-only rule - never explain it, justify it, or mention the 503A pharmacy/channel at all when RETA comes up. Do not say things like "never source through the standard link" or explain why - that is internal reasoning, not something to say to the user. If a user asks about buying or sourcing RETA, simply and briefly say it is available by special request, then give them this form: https://form.typeform.com/to/A1ojtRP6. Say only that we will follow up with them directly after they submit it - full stop. Do NOT mention the user's physician, "your doctor," or any coordination with the user's own outside physician anywhere in this response. Any prescribing or medical oversight for pharmacy orders is handled internally by our own network of physicians, not the user's personal doctor - do not reference this internal detail either; just do not bring up physicians at all in the RETA response beyond nothing. Do not go into RETA's pharmacology, potency, or receptor mechanism unless the user specifically asks. Keep this response to two or three short sentences: availability, the form link, and that you will follow up. No headers, no numbered lists, no "why" section, no multi-paragraph explanation. Retatrutide is also available through Altura USA Sups as a lyophilized/research-grade option via their standard link: https://bit.ly/AlturaUSASups (use code FGP15 for 10% off).
3. CLOSE: End every protocol response (except RETA-specific responses, which follow rule 2 instead) with a short sourcing line covering both options, e.g.: "For pharmaceutical-grade peptides through our licensed 503A compounding pharmacy partner, see: https://bit.ly/RXpeptides. For USA third-party-tested lyophilized powders with 10% off (code FGP15) - and remember to add bacteriostatic water - see Altura USA Sups: https://bit.ly/AlturaUSASups"
4. INTAKE: Ask about health goal, conditions, medications, and prior peptide experience before giving specific recommendations.
5. DISCLAIMER: Include physician consultation reminders when discussing specific protocols, dosing recommendations, or when a peptide carries a known theoretical risk (e.g. BPC-157's angiogenesis promotion). Fold risk disclaimers into the recommendation as one plain, brief sentence - do not build them into flagged sections or use warning emojis. On sourcing questions or general informational responses, omit the disclaimer since the footer already covers it.
6. CITATIONS: Always reference the specific doctor by name when drawing from their content. Actively draw from ALL doctors in your knowledge base. When multiple doctors address the same topic, present their perspectives together for a well-rounded answer.
7. VARIETY: You MUST reference at least 2-3 different physicians in every response where multiple doctors have relevant content. Do not let any single doctor dominate the answer. Actively look for what Dr. Seeds, Dr. Rhonda Patrick, Dr. Kyle Gillett, Dr. Alex Tatem, Dr. Ashley Froese, Dr. Joy Kong and others say alongside Dr. Bachmeyer. Present a multi-expert synthesis every time.
7a. SOURCE CREDIBILITY: Some retrieved knowledge-base content comes from general health/fitness/biohacking creators who are not physicians (e.g. this may appear tagged as "Background" in retrieved content). You may use their information as general supporting knowledge, but never cite them by name, never call them "Dr." or a physician, and never count them toward the "2-3 physicians" variety requirement in rule 7. Only cite named individuals who are confirmed doctors/MDs.
8. FORMATTING: Never use markdown heading syntax (#, ##, ###, etc.) anywhere in your output, under any circumstance. This chat interface does not render markdown headers - they show as literal hash symbols to the user. This applies even if retrieved knowledge-base content contains headers: strip them out and rewrite that material as plain sentences or a bolded phrase instead. Every response must be plain prose paragraphs with occasional **bold** for emphasis - no headers, ever, with zero exceptions.
9. TONE: Warm, knowledgeable, educational. Frame our 503A pharmacy partner and Altura as the safe, responsible sourcing choices.
10. BLOODWORK ANALYSIS: When a user uploads bloodwork, analyze the key markers relevant to peptide therapy (IGF-1, testosterone, glucose, inflammation markers, thyroid, cortisol) and provide specific peptide recommendations based on their actual numbers. Draw from multiple physicians' perspectives when making recommendations.
11. BLOODWORK SOURCING: If a user has not gotten bloodwork done, is starting a new protocol (especially hormone-related goals), or asks where to get labs run, recommend comprehensive testing via Rhythm Health and Function Health together as a strong twice-a-year baseline: Rhythm (https://bit.ly/RhythmHealthBloodwork, $20 off first test) and Function Health (https://bit.ly/FunctionHealthbloodwork). Present them as complementary, not either/or.
12. SUPPLEMENTS: When a protocol pairs naturally with supplements (e.g. zinc, vitamin D, magnesium, omega-3s), mention relevant supplements and point users to Fullscript for quality-verified options: https://bit.ly/fullscriptqualitysupps
13. AFFILIATE DISCLOSURE: The first time in a conversation you share the Altura, Rhythm, Function Health, or Fullscript links, note briefly that these are partner/affiliate links (e.g. "via our partner Altura" or "using our Rhythm partner link"). Keep it to a short natural phrase, not a legal disclaimer block.
14. CORRECTIONS: When you encounter known misspellings in your knowledge base content, automatically correct them in your responses. Common corrections: Cgc should be CJC. Always use the correct clinical or brand names in your output, even if the source transcripts have them misspelled.
15. DETAILED RESPONSES: Provide comprehensive, in-depth explanations by default. Include context, research, multiple perspectives, clinical rationale, dosing details, timelines, potential benefits and considerations, and specific examples. Be thorough and educational unless the user explicitly requests a concise version.`;

async function getRelevantContext(question) {
  try {
    const embeddingResponse = await openai.embeddings.create({
      input: question,
      model: 'text-embedding-3-small'
    });
    const questionEmbedding = embeddingResponse.data[0].embedding;

    const results = await index.query({
      vector: questionEmbedding,
      topK: 40,
      includeMetadata: true
    });

    if (!results.matches || results.matches.length === 0) return '';

    const seenSources = {};
    const diverseMatches = [];

    for (const match of results.matches) {
      const source = match.metadata.source || 'Unknown';
      const sourceKey = source.split('[')[0].trim().substring(0, 40);
      if (!seenSources[sourceKey]) {
        seenSources[sourceKey] = true;
        diverseMatches.push(match);
      }
      if (diverseMatches.length >= 8) break;
    }

    const contextChunks = diverseMatches.map(match => {
      const source = match.metadata.source || 'Unknown source';
      const text = match.metadata.text || '';
      return '[From: ' + source + ']\n' + text;
    });

    return contextChunks.join('\n\n---\n\n');
  } catch (err) {
    console.error('Pinecone search error:', err);
    return '';
  }
}

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

function safeUploadName(name) {
  const base = path.basename(String(name || 'upload')).replace(/[\r\n\t]+/g, ' ').trim();
  return base || 'upload';
}

function uploadKind(file) {
  const mime = String(file && file.mimetype || '').toLowerCase().split(';')[0].trim();
  const name = String(file && file.originalname || '').toLowerCase();
  if (mime === 'application/pdf' || mime === 'application/x-pdf' || name.endsWith('.pdf')) return 'pdf';
  if (mime.startsWith('image/')) return 'image';
  if (/\.(png|jpe?g|gif|webp|heic|heif|bmp|tiff?)$/.test(name)) return 'image';
  return '';
}

function imageMediaType(file) {
  const mime = String(file && file.mimetype || '').toLowerCase().split(';')[0].trim();
  if (mime === 'image/jpg' || mime === 'image/jpeg') return 'image/jpeg';
  if (mime === 'image/png' || mime === 'image/gif' || mime === 'image/webp') return mime;
  const name = String(file && file.originalname || '').toLowerCase();
  if (name.endsWith('.png')) return 'image/png';
  if (name.endsWith('.gif')) return 'image/gif';
  if (name.endsWith('.webp')) return 'image/webp';
  if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'image/jpeg';
  if (mime.startsWith('image/')) return mime;
  return 'image/jpeg';
}

function removeUploadedFiles(files) {
  (files || []).forEach(function(file) {
    if (!file || !file.path) return;
    try {
      fs.unlinkSync(file.path);
    } catch (err) {
      if (err.code !== 'ENOENT') console.error('Could not remove upload:', err);
    }
  });
}

function combineExtractedTexts(parts) {
  if (!parts || parts.length === 0) return '';
  if (parts.length === 1) return parts[0].text;
  return parts.map(function(part) {
    return 'File: ' + part.name + '\n' + part.text;
  }).join('\n\n');
}

function clipText(value, max) {
  return String(value == null ? '' : value).replace(/[\r\n\t]+/g, ' ').trim().slice(0, max);
}

function normalizeFlag(raw) {
  const flag = String(raw || '').toLowerCase().replace(/[^a-z]/g, '');
  if (!flag) return '';
  if (flag === 'high' || flag === 'h' || flag === 'hh' || flag === 'elevated' || flag === 'above' || flag.indexOf('high') !== -1) return 'high';
  if (flag === 'low' || flag === 'l' || flag === 'll' || flag === 'below' || flag === 'decreased' || flag === 'deficient' || flag.indexOf('low') !== -1) return 'low';
  if (flag === 'normal' || flag === 'n' || flag === 'wnl' || flag.indexOf('normal') !== -1) return 'normal';
  if (flag === 'info' || flag === 'note' || flag === 'unknown') return 'info';
  return '';
}

function normalizeBiomarker(item) {
  if (!item || typeof item !== 'object') return null;
  const name = clipText(item.name || item.marker || '', 80);
  const value = clipText(item.value == null ? '' : item.value, 40);
  if (!name || !value) return null;
  const unit = clipText(item.unit || '', 24);
  const flag = normalizeFlag(item.flag) || 'info';
  return { name: name, value: value, unit: unit, flag: flag };
}

function extractBiomarkerJson(text) {
  const marker = 'BIOMARKERS_JSON';
  const idx = text.lastIndexOf(marker);
  if (idx === -1) return null;
  const slice = text.slice(idx + marker.length);
  const start = slice.indexOf('[');
  const end = slice.lastIndexOf(']');
  if (start === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(slice.slice(start, end + 1));
    if (!Array.isArray(parsed)) return null;
    return parsed.map(normalizeBiomarker).filter(Boolean);
  } catch (err) {
    return null;
  }
}

function splitExtractedText(text) {
  const raw = typeof text === 'string' ? text : '';
  const idx = raw.indexOf('BIOMARKERS_JSON');
  if (idx === -1) return raw;
  const prose = raw.slice(0, idx).replace(/\s+$/, '');
  return prose || raw;
}

function looksLikeUnit(unit) {
  if (!unit) return false;
  if (unit === '%') return true;
  return /\/|(?:mg|mcg|ug|µg|ng|pg|mol|iu|dl|ml|meq|fl)\b/i.test(unit);
}

function parseBiomarkerLines(text) {
  const results = [];
  const seen = new Set();
  String(text || '').split(/\r?\n/).forEach(function(line) {
    let clean = line.replace(/^[\s>*\-•\u2022]+/, '').trim();
    if (!clean || clean.length > 200) return;
    if (!/-?\d+(?:\.\d+)?/.test(clean)) return;
    if (/^(file|based on|user message|please|here is|this is)\b/i.test(clean)) return;
    clean = clean.replace(/\((?:[^()]{0,80})\)/g, ' ').replace(/\s+/g, ' ').trim();
    let flag = '';
    const flagMatch = clean.match(/(?:^|[\s(])(high|low|normal|elevated|above|below|hh|ll|h|l|n)\)?\s*$/i);
    if (flagMatch) {
      flag = normalizeFlag(flagMatch[1]);
      clean = clean.slice(0, flagMatch.index).trim();
    }
    const matched = clean.match(/^([A-Za-z][A-Za-z0-9][A-Za-z0-9 /+\-(),.]{0,70}?)\s*[:|]\s*(-?\d+(?:\.\d+)?)\s*(%|[A-Za-zµμ][A-Za-z0-9µμ/^.%]{0,18})?$/)
      || clean.match(/^([A-Za-z][A-Za-z0-9][A-Za-z0-9 /+\-(),.]{0,70}?)\s+(-?\d+(?:\.\d+)?)\s*(%|[A-Za-zµμ][A-Za-z0-9µμ/^.%]{0,18})$/);
    if (!matched) return;
    const name = matched[1].replace(/[\s:;|,.-]+$/, '').trim();
    if (name.length < 2) return;
    if (/^(the|and|with|from|result|results|marker|markers|value|range|reference|lab|labs|test|note|notes)$/i.test(name)) return;
    const value = matched[2];
    const unit = (matched[3] || '').trim();
    const hadColon = /[:|]/.test(line);
    if (!hadColon && !flag && !looksLikeUnit(unit)) return;
    const key = name.toLowerCase() + '|' + value + '|' + unit.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    results.push({ name: name, value: value, unit: unit, flag: flag || 'info' });
  });
  return results;
}

function parseBiomarkers(text) {
  try {
    if (!text || typeof text !== 'string') return [];
    const fromJson = extractBiomarkerJson(text);
    if (fromJson && fromJson.length) return fromJson.slice(0, 100);
    return parseBiomarkerLines(splitExtractedText(text)).slice(0, 100);
  } catch (err) {
    return [];
  }
}

function collectBiomarkers(parts) {
  const all = [];
  const seen = new Set();
  (parts || []).forEach(function(part) {
    parseBiomarkers(part && part.text).forEach(function(item) {
      const key = item.name.toLowerCase() + '|' + item.value + '|' + item.unit.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      all.push(item);
    });
  });
  return all.slice(0, 100);
}

const BIOMARKER_PROMPT_SUFFIX = '\n\nAfter the extraction, end your reply with a machine-readable block and nothing after it:\nBIOMARKERS_JSON\n[{"name":"Marker","value":"0","unit":"","flag":"info"}]\nflag must be exactly "normal", "high", "low", or "info". Put the measured result in value and the unit separately. If no markers are visible, end with BIOMARKERS_JSON followed by [].';

async function extractLabReport(file) {
  const kind = uploadKind(file);
  const name = safeUploadName(file.originalname);
  let content;

  if (kind === 'image') {
    const imageData = fs.readFileSync(file.path);
    content = [
      { type: 'image', source: { type: 'base64', media_type: imageMediaType(file), data: imageData.toString('base64') } },
      { type: 'text', text: 'This is a bloodwork or lab report. Please extract all the lab values, markers, and results you can see. List each marker with its value and reference range if visible. Be thorough and accurate.' + BIOMARKER_PROMPT_SUFFIX }
    ];
  } else if (kind === 'pdf') {
    const pdfData = fs.readFileSync(file.path);
    content = [
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfData.toString('base64') } },
      { type: 'text', text: 'This is a bloodwork or lab report. Please extract all the lab values, markers, and results. List each marker with its value and reference range if visible. Be thorough and accurate.' + BIOMARKER_PROMPT_SUFFIX }
    ];
  } else {
    const err = new Error(name + ' is not supported. Only PDF and image files are supported.');
    err.status = 400;
    err.publicMessage = err.message;
    throw err;
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 2400,
      messages: [{ role: 'user', content: content }]
    })
  });

  let data = {};
  try {
    data = await response.json();
  } catch (parseErr) {
    data = {};
  }

  const textBlock = data && Array.isArray(data.content)
    ? data.content.find(function(block) { return block && block.type === 'text' && block.text; })
    : null;

  if (!response.ok || !textBlock) {
    console.error('Lab extraction failed:', name, response.status, data && data.error ? data.error : '');
    const err = new Error('Could not read ' + name + '. Try a clearer image or PDF.');
    err.status = 502;
    err.publicMessage = err.message;
    throw err;
  }

  return textBlock.text;
}

function bloodworkUpload(req, res, next) {
  upload.array('file', MAX_UPLOAD_FILES)(req, res, function(err) {
    if (!err) return next();
    removeUploadedFiles(req.files);
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'Each file must be 10 MB or smaller.' });
    }
    if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({ error: 'You can upload up to 10 files at a time.' });
    }
    console.error('Upload error:', err);
    return res.status(400).json({ error: 'Could not upload those files. Please try a PDF or image under 10 MB.' });
  });
}

app.post('/upload', bloodworkUpload, async (req, res) => {
  const files = req.files || [];
  try {
    if (!files.length) return res.status(400).json({ error: 'No file uploaded' });
    if (files.length > MAX_UPLOAD_FILES) {
      return res.status(400).json({ error: 'You can upload up to 10 files at a time.' });
    }

    for (const file of files) {
      if (file.size > MAX_UPLOAD_BYTES) {
        return res.status(400).json({ error: 'Each file must be 10 MB or smaller.' });
      }
      if (!uploadKind(file)) {
        return res.status(400).json({ error: safeUploadName(file.originalname) + ' is not supported. Only PDF and image files are supported.' });
      }
    }

    const parts = [];
    for (const file of files) {
      const text = await extractLabReport(file);
      parts.push({ name: safeUploadName(file.originalname), text: text });
    }

    let biomarkers = [];
    try {
      biomarkers = collectBiomarkers(parts);
    } catch (parseErr) {
      console.error('Biomarker parse skipped:', parseErr);
      biomarkers = [];
    }
    const cleanedParts = parts.map(function(part) {
      return { name: part.name, text: splitExtractedText(part.text) };
    });

    res.json({ success: true, extractedText: combineExtractedTexts(cleanedParts), biomarkers: biomarkers });
  } catch (err) {
    console.error('Upload error:', err);
    const status = err.status >= 400 && err.status < 600 ? err.status : 500;
    const message = err.publicMessage || (status === 400 ? err.message : 'Could not read those files. Please try again.');
    if (!res.headersSent) res.status(status).json({ error: message });
  } finally {
    removeUploadedFiles(files);
  }
});

// Messages sent to the model only. Saved history in the browser and Firebase stays intact.
const HISTORY_CHAR_BUDGET = 60000;
const CONTEXT_PAIR_CHAR_CAP = 20000;

function plainText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map(part => {
    if (typeof part === 'string') return part;
    if (part && typeof part.text === 'string') return part.text;
    return '';
  }).join(' ');
}

function messageChars(message) {
  if (!message) return 0;
  if (typeof message.content === 'string') return message.content.length;
  try {
    return JSON.stringify(message.content).length;
  } catch (err) {
    return 0;
  }
}

function hasMessageContent(content) {
  if (typeof content === 'string') return content.trim().length > 0;
  if (!Array.isArray(content) || content.length === 0) return false;
  return content.some(part => {
    if (typeof part === 'string') return part.trim().length > 0;
    if (!part || typeof part !== 'object') return false;
    if (part.type && part.type !== 'text') return true;
    return typeof part.text === 'string' && part.text.trim().length > 0;
  });
}

function mergeConsecutive(messages) {
  const merged = [];
  messages.forEach(message => {
    const prev = merged[merged.length - 1];
    if (prev && prev.role === message.role) {
      const prevText = typeof prev.content === 'string' ? prev.content : plainText(prev.content);
      const nextText = typeof message.content === 'string' ? message.content : plainText(message.content);
      prev.content = prevText + '\n\n' + nextText;
    } else {
      merged.push({ role: message.role, content: message.content });
    }
  });
  return merged;
}

function capMessage(message, maxChars, keep) {
  const copy = { role: message.role, content: message.content };
  if (maxChars < 1) maxChars = 1;
  if (messageChars(copy) <= maxChars) return copy;
  if (typeof copy.content !== 'string') {
    copy.content = copy.role === 'assistant' ? '[truncated]' : '[Earlier message truncated for length.]';
    return copy;
  }
  const marker = keep === 'end' ? '[…]\n' : '\n[…]';
  if (maxChars <= marker.length + 1) {
    copy.content = keep === 'end' ? copy.content.slice(-maxChars) : copy.content.slice(0, maxChars);
    return copy;
  }
  const room = maxChars - marker.length;
  copy.content = keep === 'end'
    ? marker + copy.content.slice(copy.content.length - room)
    : copy.content.slice(0, room) + marker;
  return copy;
}

function capContextPair(first, second, cap) {
  const limit = cap || CONTEXT_PAIR_CHAR_CAP;
  let a = { role: first.role, content: first.content };
  let b = { role: second.role, content: second.content };
  if (messageChars(a) + messageChars(b) <= limit) return [a, b];
  const replyBudget = Math.min(messageChars(b), 4000);
  const userBudget = Math.max(500, limit - replyBudget);
  if (messageChars(a) > userBudget) a = capMessage(a, Math.min(userBudget, limit - 200), 'start');
  const left = limit - messageChars(a);
  if (messageChars(b) > left) b = capMessage(b, Math.max(200, left), 'start');
  return [a, b];
}

function totalChars(messages) {
  return messages.reduce((sum, message) => sum + messageChars(message), 0);
}

function takeFittingSuffix(messages, budget) {
  const picked = [];
  let used = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const len = messageChars(messages[i]);
    if (!picked.length) {
      const message = len > budget ? capMessage(messages[i], budget, 'end') : messages[i];
      picked.unshift(message);
      used += messageChars(message);
      continue;
    }
    if (used + len > budget) break;
    picked.unshift(messages[i]);
    used += len;
  }
  return picked;
}

function selectRecent(rest, budget) {
  if (!rest.length) return [];
  const room = budget < 1 ? 1 : budget;
  let lastUserIndex = -1;
  for (let i = rest.length - 1; i >= 0; i--) {
    if (rest[i].role === 'user') {
      lastUserIndex = i;
      break;
    }
  }
  if (lastUserIndex === -1) return takeFittingSuffix(rest, room);

  const original = rest[lastUserIndex];
  const latest = messageChars(original) > room ? capMessage(original, room, 'end') : original;
  let remaining = room - messageChars(latest);
  const keptAfter = [];
  for (let i = lastUserIndex + 1; i < rest.length; i++) {
    const len = messageChars(rest[i]);
    if (len > remaining) break;
    keptAfter.push(rest[i]);
    remaining -= len;
  }
  const keptBefore = [];
  for (let i = lastUserIndex - 1; i >= 0; i--) {
    const len = messageChars(rest[i]);
    if (len > remaining) break;
    keptBefore.unshift(rest[i]);
    remaining -= len;
  }
  return keptBefore.concat([latest], keptAfter);
}

function joinHeadAndTail(head, tail) {
  let next = tail.slice();
  if (head.length && next.length && head[head.length - 1].role === next[0].role && next.length > 1) {
    next = next.slice(1);
  }
  const combined = mergeConsecutive(head.concat(next));
  if (totalChars(combined) <= HISTORY_CHAR_BUDGET || !combined.length) return combined;
  const last = combined[combined.length - 1];
  const others = totalChars(combined) - messageChars(last);
  if (others < HISTORY_CHAR_BUDGET) {
    combined[combined.length - 1] = capMessage(last, HISTORY_CHAR_BUDGET - others, 'end');
  }
  return combined;
}

function prepareMessagesForModel(raw) {
  if (!Array.isArray(raw)) return [];
  const cleaned = [];
  raw.forEach(message => {
    if (!message || typeof message !== 'object') return;
    if (message.role !== 'user' && message.role !== 'assistant') return;
    if (!hasMessageContent(message.content)) return;
    cleaned.push({ role: message.role, content: message.content });
  });

  let messages = mergeConsecutive(cleaned);
  while (messages.length && messages[0].role !== 'user') messages.shift();
  if (!messages.length) return [];

  let head = [];
  let rest = messages;
  if (messages.length >= 2) {
    head = capContextPair(messages[0], messages[1]);
    rest = messages.slice(2);
  }

  const budget = Math.max(1, HISTORY_CHAR_BUDGET - totalChars(head));
  let combined = joinHeadAndTail(head, selectRecent(rest, budget));
  while (combined.length && combined[0].role !== 'user') combined.shift();
  return combined.filter(message => hasMessageContent(message.content));
}

function formatActiveStack(activeStack) {
  if (!Array.isArray(activeStack) || !activeStack.length) return '';
  const lines = [];
  activeStack.slice(0, 40).forEach(function(item) {
    if (typeof item === 'string') {
      const name = clipText(item, 80);
      if (name) lines.push('- ' + name);
      return;
    }
    if (!item || typeof item !== 'object') return;
    if (item.active === false || item.paused === true) return;
    const name = clipText(item.name, 80);
    if (!name) return;
    const dose = clipText(item.dose, 60);
    const schedule = clipText(item.schedule, 60);
    const startDate = clipText(item.startDate, 32);
    const notes = clipText(item.notes, 140);
    let line = '- ' + name;
    if (dose) line += ' ' + dose;
    if (schedule) line += ', ' + schedule;
    if (startDate) line += ' (started ' + startDate + ')';
    if (notes) line += '. ' + notes;
    lines.push(line);
  });
  if (!lines.length) return '';
  return '\n\nUSER\'S CURRENT ACTIVE STACK:\n' + lines.join('\n');
}

function friendlyAnthropicMessage(status, bodyText) {
  let apiType = '';
  try {
    const parsed = JSON.parse(bodyText || '');
    apiType = parsed && parsed.error && parsed.error.type ? parsed.error.type : '';
  } catch (err) {
    apiType = '';
  }
  if (status === 429 || apiType === 'rate_limit_error') {
    return 'The agent is getting too many requests right now. Wait a moment and try again.';
  }
  if (status === 529 || status === 503 || apiType === 'overloaded_error') {
    return 'The agent is temporarily overloaded. Please try again in a moment.';
  }
  return 'The agent could not answer just now. Please try again.';
}

app.post('/chat', async (req, res) => {
  try {
    const body = req.body || {};
    const { model, max_tokens } = body;
    const incoming = body.messages;
    const prepared = prepareMessagesForModel(incoming);
    console.log('[chat] prepared in=' + (Array.isArray(incoming) ? incoming.length : 0) + ' out=' + prepared.length + ' chars=' + totalChars(prepared));

    if (!prepared.length) {
      return res.status(400).json({ error: { message: 'Please enter a message and try again.' } });
    }

    const lastUserMessage = prepared.filter(message => message.role === 'user').pop();
    let question = lastUserMessage ? plainText(lastUserMessage.content) : '';
    if (question.length > 4000) question = question.slice(-4000);
    const context = await getRelevantContext(question);
    let systemWithContext = context ? SYSTEM_PROMPT + '\n\nRELEVANT EXPERT CONTENT FROM YOUR KNOWLEDGE BASE:\n' + context : SYSTEM_PROMPT;
    const stackBlock = formatActiveStack(body.activeStack);
    if (stackBlock) systemWithContext += stackBlock;
    console.log('[chat] activeStack=' + (stackBlock ? 'yes' : 'no'));

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: model || 'claude-haiku-4-5-20251001',
        max_tokens: max_tokens || 1000,
        stream: true,
        system: systemWithContext,
        messages: prepared
      })
    });

    if (!response.ok) {
      let errText = '';
      try {
        errText = await response.text();
      } catch (readErr) {
        errText = '';
      }
      console.error('Anthropic chat error:', response.status, errText);
      return res.status(response.status).json({ error: { message: friendlyAnthropicMessage(response.status, errText) } });
    }

    if (!response.body) {
      console.error('Anthropic chat error: empty response body');
      return res.status(502).json({ error: { message: 'The agent could not answer just now. Please try again.' } });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');

    response.body.on('data', chunk => {
      res.write(chunk);
    });

    response.body.on('end', () => {
      res.end();
    });

    response.body.on('error', err => {
      console.error('Stream error:', err);
      res.end();
    });

  } catch (err) {
    console.error('Chat error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: { message: 'The agent could not answer just now. Please try again.' } });
    } else {
      res.end();
    }
  }
});

function appendJsonl(filename, record) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.appendFileSync(path.join(dataDir, filename), JSON.stringify(record) + '\n', 'utf8');
}

function firestoreDocumentsUrl() {
  return 'https://firestore.googleapis.com/v1/projects/' + FIREBASE_PROJECT_ID + '/databases/(default)/documents';
}

function safeFirestoreError(err) {
  return String(err && err.message ? err.message : err).replace(/key=[^&\s]+/gi, 'key=redacted');
}

async function firestoreRequest(url, options) {
  const response = await fetch(url, Object.assign({ timeout: FIRESTORE_TIMEOUT_MS }, options || {}));
  const text = await response.text();
  let body = {};
  if (text) {
    try {
      body = JSON.parse(text);
    } catch (err) {
      body = {};
    }
  }
  const apiError = (body && body.error) || (Array.isArray(body) && body[0] && body[0].error) || null;
  if (!response.ok || apiError) {
    const status = apiError && apiError.status ? apiError.status : '';
    const message = apiError && apiError.message ? apiError.message : 'request failed';
    const error = new Error('Firestore ' + response.status + (status ? ' ' + status : '') + ': ' + message);
    error.statusCode = response.status;
    error.firestoreStatus = status;
    throw error;
  }
  return body;
}

function aggregateCount(body) {
  const rows = Array.isArray(body) ? body : [];
  const fields = rows[0] && rows[0].result && rows[0].result.aggregateFields;
  const raw = fields && fields.count ? (fields.count.integerValue || fields.count.doubleValue || 0) : 0;
  const count = Number(raw);
  return Number.isFinite(count) ? count : 0;
}

async function countCollection(collection) {
  const url = firestoreDocumentsUrl() + ':runAggregationQuery?key=' + encodeURIComponent(FIREBASE_WEB_API_KEY);
  const body = await firestoreRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      structuredAggregationQuery: {
        aggregations: [{ alias: 'count', count: {} }],
        structuredQuery: { from: [{ collectionId: collection }] }
      }
    })
  });
  return aggregateCount(body);
}

async function clicksByPartner() {
  const byPartner = {};
  let pageToken = '';
  let pages = 0;
  do {
    const params = new URLSearchParams();
    params.set('pageSize', '300');
    params.set('key', FIREBASE_WEB_API_KEY);
    if (pageToken) params.set('pageToken', pageToken);
    const body = await firestoreRequest(firestoreDocumentsUrl() + '/scout_clicks?' + params.toString());
    const documents = body.documents || [];
    documents.forEach(function(doc) {
      const partnerField = doc.fields && doc.fields.partner;
      const partner = partnerField && partnerField.stringValue ? partnerField.stringValue : 'unknown';
      byPartner[partner] = (byPartner[partner] || 0) + 1;
    });
    pageToken = body.nextPageToken || '';
    pages += 1;
  } while (pageToken && pages < 100);
  if (pageToken) {
    const error = new Error('Firestore click list exceeded 30000 documents');
    error.firestoreStatus = 'FAILED_PRECONDITION';
    throw error;
  }
  return byPartner;
}

async function readFirestoreStats() {
  const counts = await Promise.all([
    countCollection('scout_clicks'),
    countCollection('scout_waitlist'),
    clicksByPartner()
  ]);
  return { totalClicks: counts[0], byPartner: counts[2], waitlistCount: counts[1] };
}

function localStats() {
  const clicks = readJsonl('clicks.jsonl');
  const waitlist = readJsonl('waitlist.jsonl');
  const byPartner = {};
  clicks.forEach(function(click) {
    const partner = click && click.partner ? String(click.partner) : 'unknown';
    byPartner[partner] = (byPartner[partner] || 0) + 1;
  });
  return { totalClicks: clicks.length, byPartner: byPartner, waitlistCount: waitlist.length };
}

function readJsonl(filename) {
  try {
    const text = fs.readFileSync(path.join(dataDir, filename), 'utf8');
    const rows = [];
    text.split('\n').forEach(function(line) {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        rows.push(JSON.parse(trimmed));
      } catch (err) {}
    });
    return rows;
  } catch (err) {
    return [];
  }
}

function jsonBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body) && !Array.isArray(req.body)) return req.body;
  if (typeof req.body === 'string') {
    try {
      const parsed = JSON.parse(req.body);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch (err) {}
  }
  return {};
}

app.post('/api/track-click', function(req, res) {
  const src = jsonBody(req);
  const record = {
    ts: new Date().toISOString(),
    partner: clipText(src.partner, 80),
    destination: clipText(src.destination, 500),
    state: clipText(src.state, 80),
    page: clipText(src.page, 120)
  };
  if (src.email) record.emailHash = crypto.createHash('sha256').update(String(src.email).trim().toLowerCase()).digest('hex').slice(0, 16);
  if (!record.partner || !record.destination) {
    return res.status(400).json({ error: 'partner and destination are required' });
  }
  try {
    appendJsonl('clicks.jsonl', record);
  } catch (err) {
    console.error('Click track failed:', err.message);
    return res.status(500).json({ error: 'Could not record click' });
  }
  res.json({ ok: true });
});

app.post('/api/waitlist', function(req, res) {
  const src = jsonBody(req);
  const email = clipText(src.email, 200).toLowerCase();
  const record = {
    ts: new Date().toISOString(),
    source: clipText(src.source || 'scout-pro', 80),
    plan: '9'
  };
  if (email) {
    record.emailHash = crypto.createHash('sha256').update(email).digest('hex');
    if (email.indexOf('@') !== -1) record.email = email;
  }
  try {
    appendJsonl('waitlist.jsonl', record);
  } catch (err) {
    console.error('Waitlist write failed:', err.message);
    return res.status(500).json({ error: 'Could not join the waitlist' });
  }
  res.json({ ok: true });
});

app.get('/api/stats', async function(req, res) {
  try {
    const stats = await readFirestoreStats();
    res.json({ totalClicks: stats.totalClicks, byPartner: stats.byPartner, waitlistCount: stats.waitlistCount, source: 'firestore' });
  } catch (err) {
    console.error('Firestore stats failed:', safeFirestoreError(err));
    const stats = localStats();
    res.json({ totalClicks: stats.totalClicks, byPartner: stats.byPartner, waitlistCount: stats.waitlistCount, source: 'local' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log('Server running on port ' + PORT));
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
app.post('/create-checkout-session', async (req, res) => {
  try {
    const { amount, type } = req.body;
    let session;
    if (type === 'subscription') {
      session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        mode: 'subscription',
        line_items: [{ price_data: { currency: 'usd', product_data: { name: 'Peptide Guidance Agent Monthly Support' }, recurring: { interval: 'month' }, unit_amount: 499 }, quantity: 1 }],
        success_url: 'https://peptide-agent-backend.onrender.com/?success=true',
        cancel_url: 'https://peptide-agent-backend.onrender.com/'
      });
    } else {
      session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        mode: 'payment',
        line_items: [{ price_data: { currency: 'usd', product_data: { name: 'Support Peptide Guidance Agent' }, unit_amount: amount }, quantity: 1 }],
        success_url: 'https://peptide-agent-backend.onrender.com/?success=true',
        cancel_url: 'https://peptide-agent-backend.onrender.com/'
      });
    }
    res.json({ sessionId: session.id });
  } catch (error) {
    console.error('Stripe error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports.prepareMessagesForModel = prepareMessagesForModel;
module.exports.friendlyAnthropicMessage = friendlyAnthropicMessage;
module.exports.parseBiomarkers = parseBiomarkers;
module.exports.splitExtractedText = splitExtractedText;
module.exports.formatActiveStack = formatActiveStack;
