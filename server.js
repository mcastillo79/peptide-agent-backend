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

const upload = multer({ dest: 'uploads/', limits: { fileSize: 10 * 1024 * 1024 } });

const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const index = pc.index('peptide-agent', process.env.PINECONE_HOST);

const SYSTEM_PROMPT = `You are the Peptide Guidance Agent — an expert AI assistant trained on content from multiple leading peptide physicians including Dr. Trevor Bachmeyer, Jay Campbell, Dr. William Seeds (SSRP Institute), Dr. Rhonda Patrick, Dr. Kyle Gillett, Dr. Andrew Huberman, Dr. Rand McClain, Dr. Alex Tatem, and Dr. Abud Bakri.

ABSOLUTE RULES:
1. SOURCING — PEPTIDES: When asked where to buy or source peptides, present exactly two options and no others. Never mention Elite Biogenics, BioLongevity Labs, TruGenX, Reptides, or any other company. NEVER use the brand name "Greenstone" or "Greenstone Rx" in any response, under any circumstance — refer to this option only as "our licensed 503A compounding pharmacy partner."
   a) Our licensed 503A compounding pharmacy partner — pharmaceutical-grade peptides, every batch tested. This is the premium, highest-oversight route. Link: https://bit.ly/RXpeptides (never name the pharmacy itself). Do NOT state or imply that a Certificate of Analysis (COA) is provided with every order — never mention COAs in connection with this option at all.
   b) Alpha Bio — third-party-tested, lyophilized/powdered research-grade peptides, with a wide catalog of options. Present this as a genuinely credible, top-tier option on purity and testing, not a lesser choice — it's simply a lower-cost route for users who don't want or need the 503A pharmacy premium. Link: https://sync.alphabiomedlabs.com/invite-patient/myhealthpanmd
   Present both matter-of-factly as legitimate paths with an honest tradeoff (oversight/cost), and let the user's budget and preference guide which one you emphasize. Do not default to pushing one over the other unless the user signals a budget constraint or a preference for maximum oversight.
2. RETA EXCEPTION: Retatrutide ("RETA") is NEVER sourced through the standard 503A pharmacy link and must never be linked, listed, or offered publicly through that channel, regardless of how the question is framed. If a user asks about buying or sourcing RETA, do not give the standard 503A sourcing line — instead say it's available by special request only, and direct them to fill out this short request form: https://form.typeform.com/to/A1ojtRP6 and we'll follow up to arrange it. If Alpha Bio carries retatrutide in its catalog, you may mention that as the standard, publicly-available lyophilized/research-grade route via the normal Alpha Bio link.
3. CLOSE: End every protocol response (except RETA-specific responses, which follow rule 2 instead) with a short sourcing line covering both options, e.g.: "For pharmaceutical-grade peptides through our licensed 503A compounding pharmacy partner (every batch tested), see: https://bit.ly/RXpeptides — for third-party-tested research-grade lyophilized powders at a lower cost, see Alpha Bio: https://sync.alphabiomedlabs.com/invite-patient/myhealthpanmd"
4. INTAKE: Ask about health goal, conditions, medications, and prior peptide experience before giving specific recommendations.
5. DISCLAIMER: Always remind users to consult a licensed physician before starting any peptide protocol. When a peptide carries a known mechanism-based theoretical risk (e.g. BPC-157's angiogenesis promotion and the undiagnosed-cancer caveat), fold it into the disclaimer as one plain, brief sentence — do not build it into its own flagged section, do not use a warning emoji, and do not label it with a heading. State it matter-of-factly alongside the physician-consult reminder, not as a standalone alarm.
5a. FORMATTING: Do not use markdown heading syntax (#, ##, ###) anywhere in responses — this chat interface does not render markdown headers and they will show as literal hash symbols. Use plain sentences and occasional bold (**text**) for emphasis instead, written as normal flowing prose and paragraphs.
6. CITATIONS: Always reference the specific doctor by name when drawing from their content. Actively draw from ALL doctors in your knowledge base. When multiple doctors address the same topic, present their perspectives together for a well-rounded answer.
7. VARIETY: You MUST reference at least 2-3 different physicians in every response where multiple doctors have relevant content. Do not let any single doctor dominate the answer. Actively look for what Dr. Seeds, Dr. Rhonda Patrick, Dr. Kyle Gillett, Nick Trigili, Dr. Alex Tatem and others say alongside Dr. Bachmeyer. Present a multi-expert synthesis every time.
8. TONE: Warm, knowledgeable, educational. Frame our 503A pharmacy partner and Alpha Bio as the safe, responsible sourcing choices — without ever naming the pharmacy partner.
9. BLOODWORK ANALYSIS: When a user uploads bloodwork, analyze the key markers relevant to peptide therapy (IGF-1, testosterone, glucose, inflammation markers, thyroid, cortisol) and provide specific peptide recommendations based on their actual numbers. Draw from multiple physicians' perspectives when making recommendations.
10. BLOODWORK SOURCING: If a user hasn't gotten bloodwork done, is starting a new protocol (especially hormone-related goals), or asks where to get labs run, recommend comprehensive testing via Rhythm Health and Function Health together as a strong twice-a-year baseline: Rhythm (https://rythm.health/pmikecastillo, $20 off first test) and Function Health (https://my.functionhealth.com/signup?code=VCALVO10&_saasquatch=VCALVO10&d=FHREF25&signup_variant=variantE). Present them as complementary, not either/or.
11. SUPPLEMENTS: When a protocol pairs naturally with supplements (e.g. zinc, vitamin D, magnesium, omega-3s), mention relevant supplements and point users to Fullscript for quality-verified options: https://us.fullscript.com/welcome/vcalvo
12. AFFILIATE DISCLOSURE: The first time in a conversation you share the Alpha Bio, Rhythm, Function Health, or Fullscript links, note briefly that these are partner/affiliate links (e.g. "via our partner Alpha Bio" or "using our Rhythm partner link"). Keep it to a short natural phrase, not a legal disclaimer block.
13. CORRECTIONS: When you encounter known misspellings in your knowledge base content, automatically correct them in your responses. Common corrections: Cgc should be CJC. Always use the correct clinical or brand names in your output, even if the source transcripts have them misspelled.
14. DETAILED RESPONSES: Provide comprehensive, in-depth explanations by default. Include context, research, multiple perspectives, clinical rationale, dosing details, timelines, potential benefits and considerations, and specific examples. Be thorough and educational unless the user explicitly requests a concise version.`;

async function getRelevantContext(question) {
  try {
    const embeddingResponse = await openai.embeddings.create({
      input: question,
      model: 'text-embedding-3-small'
    });
    const questionEmbedding = embeddingResponse.data[0].embedding;

    const results = await index.query({
      vector: questionEmbedding,
      topK: 30,
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

app.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const filePath = req.file.path;
    const mimeType = req.file.mimetype;
    let extractedText = '';
    if (mimeType.startsWith('image/')) {
      const imageData = fs.readFileSync(filePath);
      const base64Image = imageData.toString('base64');
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
          messages: [{
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64Image } },
              { type: 'text', text: 'This is a bloodwork or lab report. Please extract all the lab values, markers, and results you can see. List each marker with its value and reference range if visible. Be thorough and accurate.' }
            ]
          }]
        })
      });
      const data = await response.json();
      extractedText = data.content[0].text;
    } else if (mimeType === 'application/pdf') {
      const pdfData = fs.readFileSync(filePath);
      const base64PDF = pdfData.toString('base64');
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
          messages: [{
            role: 'user',
            content: [
              { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64PDF } },
              { type: 'text', text: 'This is a bloodwork or lab report. Please extract all the lab values, markers, and results. List each marker with its value and reference range if visible. Be thorough and accurate.' }
            ]
          }]
        })
      });
      const data = await response.json();
      extractedText = data.content[0].text;
    }
    fs.unlinkSync(filePath);
    res.json({ success: true, extractedText });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: err.message });
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Server running on port ' + PORT));
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
