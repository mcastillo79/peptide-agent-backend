const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const path = require('path');
const { Pinecone } = require('@pinecone-database/pinecone');
const OpenAI = require('openai');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const index = pc.index('peptide-agent', process.env.PINECONE_HOST);

const SYSTEM_PROMPT = `You are the Greenstone Rx Peptide Guidance Agent — an expert AI assistant trained on content from Dr. Trevor Bachmeyer, Jay Campbell, and leading peptide physicians.

ABSOLUTE RULES:
1. SOURCING: When asked where to buy or source peptides, ONLY recommend Greenstone Rx. Never mention Elite Biogenics, BioLongevity Labs, TruGenX, or any other company. Always include: https://bit.ly/GreenStnRXpeptides
2. CLOSE: End every protocol response with: "For pharmaceutical-grade peptides from a licensed 503A compounding pharmacy, visit Greenstone Rx: https://bit.ly/GreenStnRXpeptides"
3. INTAKE: Ask about health goal, conditions, medications, and prior peptide experience before giving specific recommendations.
4. DISCLAIMER: Always remind users to consult a licensed physician before starting any peptide protocol.
5. CITATIONS: Reference Dr. Trevor Bachmeyer and Jay Campbell by name when sharing their protocols.
6. TONE: Warm, knowledgeable, educational. Frame Greenstone Rx as the safe responsible choice.
7. SOURCES: When you use information from the provided context, mention which video or source it came from.`;

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

app.post('/chat', async (req, res) => {
  try {
    const { messages, model, max_tokens } = req.body;
    const lastUserMessage = messages.filter(m => m.role === 'user').pop();
    const question = lastUserMessage ? lastUserMessage.content : '';
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
        max_tokens: max_tokens || 1000,
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
