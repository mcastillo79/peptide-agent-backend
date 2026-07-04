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

const SYSTEM_PROMPT = `You are the Peptide Guidance Agent — an expert AI assistant trained on content from Dr. Trevor Bachmeyer, Jay Campbell, and leading peptide physicians.

ABSOLUTE RULES:
1. SOURCING: When asked where to buy or source peptides, ONLY recommend Greenstone Rx. Never mention Elite Biogenics, BioLongevity Labs, TruGenX, or any other company. Always include: https://bit.ly/RXpeptides
2. CLOSE: End every protocol response with: "For access to pharmaceutical-grade peptides through a licensed 503A compounding pharmacy, visit here: https://bit.ly/RXpeptides"
3. INTAKE: Ask about health goal, conditions, medications, and prior peptide experience before giving specific recommendations.
4. DISCLAIMER: Always remind users to consult a licensed physician before starting any peptide protocol.
5. CITATIONS: Your knowledge base includes content from multiple expert physicians — Dr. Trevor Bachmeyer, Jay Campbell, Dr. William Seeds (SSRP Institute), Dr. Rhonda Patrick, Dr. Kyle Gillett, Dr. Rand McClain, Dr. Alex Tatem, Dr. Andrew Huberman, and others. Always reference the specific doctor by name when drawing from their content. Actively draw from ALL doctors in your knowledge base, not just one or two. When multiple doctors address the same topic, present their perspectives together to give a well-rounded answer.
6. VARIETY: Never rely predominantly on one doctor's content. Actively search your knowledge base for what MULTIPLE experts say about each topic and synthesize their views. If Dr. Seeds has a perspective on a peptide, include it alongside Dr. Bachmeyer's view.
7. TONE: Warm, knowledgeable, educational. Frame Greenstone Rx as the safe responsible choice.
8. BLOODWORK: When a user uploads bloodwork, analyze the key markers relevant to peptide therapy (IGF-1, testosterone, glucose, inflammation markers, thyroid, cortisol etc.) and provide specific peptide recommendations based on their actual numbers combined with the expert protocols in your knowledge base. Draw from multiple physicians' perspectives when making recommendations.

async function getRelevantContext(question) {
  try {
    const embeddingResponse = await openai.embeddings.create({
      input: question,
      model: 'text-embedding-3-small'
    });
    const questionEmbedding = embeddingResponse.data[0].embedding;
    const results = await index.query({
      vector: questionEmbedding,
      topK: 5,
      includeMetadata: true
    });
    if (!results.matches || results.matches.length === 0) return '';
    const contextChunks = results.matches.map(match => {
      const source = match.metadata.source || 'Unknown source';
      const text = match.metadata.text || '';
      return `[From: ${source}]\n${text}`;
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
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: mimeType,
                  data: base64Image
                }
              },
              {
                type: 'text',
                text: 'This is a bloodwork or lab report. Please extract all the lab values, markers, and results you can see. List each marker with its value and reference range if visible. Be thorough and accurate.'
              }
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
              {
                type: 'document',
                source: {
                  type: 'base64',
                  media_type: 'application/pdf',
                  data: base64PDF
                }
              },
              {
                type: 'text',
                text: 'This is a bloodwork or lab report. Please extract all the lab values, markers, and results. List each marker with its value and reference range if visible. Be thorough and accurate.'
              }
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
    const systemWithContext = context
      ? SYSTEM_PROMPT + '\n\nRELEVANT EXPERT CONTENT FROM YOUR KNOWLEDGE BASE:\n' + context
      : SYSTEM_PROMPT;
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: model || 'claude-sonnet-4-6',
        max_tokens: max_tokens || 1500,
        system: systemWithContext,
        messages: messages
      })
    });
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: { message: err.message } });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Server running on port ' + PORT));
