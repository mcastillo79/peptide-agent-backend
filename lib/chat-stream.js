const { StringDecoder } = require('string_decoder');
const { stripUnauthorizedPharmacySourcing, hasPharmacyLink } = require('./catalogs');

const HOLDBACK = 96;

function offerStart(text) {
  const match = /bit\.ly\/RX|bit\.ly\/sterile|RXpeptides|sterile503a|pharmaceutical-grade|pharmaceutical grade|compounding pharmacy|503A|Option 2/i.exec(String(text || ''));
  return match ? match.index : -1;
}

function releaseBoundary(assembled, done) {
  const start = offerStart(assembled);
  if (start !== -1) return start;
  if (done) return assembled.length;
  return Math.max(0, assembled.length - HOLDBACK);
}

function textDelta(block) {
  const lines = String(block || '').split('\n');
  let dataLine = '';
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].indexOf('data:') === 0) {
      dataLine = lines[i];
      break;
    }
  }
  if (!dataLine) return null;
  const raw = dataLine.replace(/^data:\s?/, '').trim();
  if (!raw || raw === '[DONE]') return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.type !== 'content_block_delta' || !parsed.delta) return null;
    if (parsed.delta.type !== 'text_delta' || typeof parsed.delta.text !== 'string') return null;
    return { text: parsed.delta.text, index: parsed.index || 0 };
  } catch (err) {
    return null;
  }
}

function isTerminalEvent(block) {
  return /"type"\s*:\s*"(content_block_stop|message_delta|message_stop)"/.test(String(block || ''));
}

function pipeFilteredChatStream(upstream, res, catalogs, contextText) {
  const decoder = new StringDecoder('utf8');
  let pending = '';
  let assembled = '';
  let released = '';
  let blockIndex = 0;
  const trailing = [];
  let closed = false;

  function emitText(text) {
    if (!text) return;
    const payload = JSON.stringify({
      type: 'content_block_delta',
      index: blockIndex,
      delta: { type: 'text_delta', text: text }
    });
    res.write('data: ' + payload + '\n\n');
  }

  function releaseThrough(text) {
    if (!text || text.length <= released.length) return;
    if (text.indexOf(released) !== 0) return;
    emitText(text.slice(released.length));
    released = text;
  }

  function processEvent(block) {
    if (!block || !String(block).trim()) return;
    const delta = textDelta(block);
    if (delta) {
      blockIndex = delta.index;
      assembled += delta.text;
      releaseThrough(assembled.slice(0, releaseBoundary(assembled, false)));
      return;
    }
    if (isTerminalEvent(block)) {
      trailing.push(block);
      return;
    }
    res.write(block + '\n\n');
  }

  function finish() {
    if (closed) return;
    closed = true;
    const cleaned = stripUnauthorizedPharmacySourcing(assembled, catalogs, contextText);
    if (!released || cleaned.indexOf(released) === 0) {
      releaseThrough(cleaned);
    } else {
      const rest = stripUnauthorizedPharmacySourcing(assembled.slice(released.length), catalogs, contextText);
      if (rest && !hasPharmacyLink(rest)) emitText(rest);
    }
    trailing.forEach(function(block) {
      res.write(block + '\n\n');
    });
    res.end();
  }

  upstream.on('data', function(chunk) {
    try {
      pending += decoder.write(chunk).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      let sep = pending.indexOf('\n\n');
      while (sep !== -1) {
        const block = pending.slice(0, sep);
        pending = pending.slice(sep + 2);
        processEvent(block);
        sep = pending.indexOf('\n\n');
      }
    } catch (err) {
      console.error('Stream error:', err);
      finish();
    }
  });

  upstream.on('end', function() {
    try {
      pending += decoder.end();
      if (pending.trim()) processEvent(pending);
    } catch (err) {
      console.error('Stream error:', err);
    }
    finish();
  });

  upstream.on('error', function(err) {
    console.error('Stream error:', err);
    try {
      finish();
    } catch (finishErr) {
      if (!closed) {
        closed = true;
        res.end();
      }
    }
  });
}

module.exports = {
  pipeFilteredChatStream: pipeFilteredChatStream,
  releaseBoundary: releaseBoundary
};
