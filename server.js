const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const path = require('path');
const multer = require('multer');
const { Pinecone } = require('@pinecone-database/pinecone');
const OpenAI = require('openai');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const uploadDir = path.join(__dirname, 'uploads');
const MAX_UPLOAD_FILES = 10;
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const upload = multer({
  dest: uploadDir,
  // Busboy rejects a file when its size reaches this value, including an exact match.
  // Allow one extra byte here so a file of exactly 10 MB still passes, then reject anything larger below.
  limits: { fileSize: MAX_UPLOAD_BYTES + 1, files: MAX_UPLOAD_FILES }
});

const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const index = pc.index('peptide-agent', process.env.PINECONE_HOST);

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

async function extractLabReport(file) {
  const kind = uploadKind(file);
  const name = safeUploadName(file.originalname);
  let content;

  if (kind === 'image') {
    const imageData = fs.readFileSync(file.path);
    content = [
      { type: 'image', source: { type: 'base64', media_type: imageMediaType(file), data: imageData.toString('base64') } },
      { type: 'text', text: 'This is a bloodwork or lab report. Please extract all the lab values, markers, and results you can see. List each marker with its value and reference range if visible. Be thorough and accurate.' }
    ];
  } else if (kind === 'pdf') {
    const pdfData = fs.readFileSync(file.path);
    content = [
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfData.toString('base64') } },
      { type: 'text', text: 'This is a bloodwork or lab report. Please extract all the lab values, markers, and results. List each marker with its value and reference range if visible. Be thorough and accurate.' }
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
      max_tokens: 2000,
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

    res.json({ success: true, extractedText: combineExtractedTexts(parts) });
  } catch (err) {
    console.error('Upload error:', err);
    const status = err.status >= 400 && err.status < 600 ? err.status : 500;
    const message = err.publicMessage || (status === 400 ? err.message : 'Could not read those files. Please try again.');
    if (!res.headersSent) res.status(status).json({ error: message });
  } finally {
    removeUploadedFiles(files);
  }
});

app.post('/chat', async (req, res) => {
  try {
    const { messages, model, max_tokens } = req.body;
    const lastUserMessage = messages.filter(m => m.role === 'user').pop();
    const question = lastUserMessage ? (typeof lastUserMessage.content === 'string' ? lastUserMessage.content : lastUserMessage.content.map(c => c.text || '').join(' ')) : '';
    const context = await getRelevantContext(question);
    const systemWithContext = context ? SYSTEM_PROMPT + '\n\nRELEVANT EXPERT CONTENT FROM YOUR KNOWLEDGE BASE:\n' + context : SYSTEM_PROMPT;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');

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
        messages: messages
      })
    });

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
    res.status(500).json({ error: { message: err.message } });
  }
});

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const MIN_DONATION_CENTS = 50;
const MAX_DONATION_CENTS = 1000 * 100;
const APP_URL = 'https://peptide-agent-backend.onrender.com';

app.post('/create-checkout-session', async (req, res) => {
  try {
    const { amount, type } = req.body || {};
    const successUrl = APP_URL + '/?success=true';
    const cancelUrl = APP_URL + '/?canceled=true';
    const cents = type === 'subscription' ? null : Number(amount);

    if (type !== 'subscription') {
      if (!Number.isInteger(cents) || cents < MIN_DONATION_CENTS || cents > MAX_DONATION_CENTS) {
        return res.status(400).json({ error: 'Please enter an amount between $0.50 and $1,000.00.' });
      }
    }

    if (!process.env.STRIPE_SECRET_KEY) {
      return res.status(500).json({ error: 'Payments are temporarily unavailable. Please try again later.' });
    }

    let session;

    if (type === 'subscription') {
      session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        mode: 'subscription',
        line_items: [{
          price_data: {
            currency: 'usd',
            product_data: { name: 'Peptide Guidance Agent Monthly Support' },
            recurring: { interval: 'month' },
            unit_amount: 499
          },
          quantity: 1
        }],
        success_url: successUrl,
        cancel_url: cancelUrl
      });
    } else {
      session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        mode: 'payment',
        line_items: [{
          price_data: {
            currency: 'usd',
            product_data: { name: 'Support Peptide Guidance Agent' },
            unit_amount: cents
          },
          quantity: 1
        }],
        success_url: successUrl,
        cancel_url: cancelUrl
      });
    }

    res.json({ sessionId: session.id, url: session.url });
  } catch (error) {
    console.error('Stripe error:', error);
    res.status(500).json({ error: error.message || 'Unable to start checkout. Please try again.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Server running on port ' + PORT));
