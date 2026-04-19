// Texting Decoder — reply to six texts, get your archetype.
// Uses the shared ef-ai-proxy to actually read the user's replies and
// decide on (or invent) a fitting archetype + tells. Deterministic-ish
// via temperature 0; falls back to a local heuristic if the proxy fails.

const AI_ENDPOINT = 'https://uy3l6suz07.execute-api.us-east-1.amazonaws.com/ai';
const SLUG = 'texting-decoder';

const PROMPTS = [
  { sender: "someone you half-know",       text: "hey wyd" },
  { sender: "your roommate",               text: "did u eat" },
  { sender: "your situationship, unprompted", text: "been thinking about u lately" },
  { sender: "a friend, 11:47pm",           text: "my week has been the worst" },
  { sender: "the group chat",              text: "we still on for saturday??" },
  { sender: "your ex, randomly",           text: "saw something that reminded me of u" },
];

const LOADING_MSGS = [
  "reading between the periods…",
  "cross-referencing your lowercase…",
  "counting the commas, one by one…",
  "consulting the ellipsis council…",
  "decoding thumb energy…",
  "auditing your 'lol' placement…",
  "waiting for read receipts from the cosmos…",
];

// Archetype library — given to the AI as candidates, but it can also invent
// a new one if none fits. Also used by the offline fallback path.

// ---- archetype catalog (signature archetypes — every one is a label a user would own) ----

const ARCHETYPES = [
  {
    name: "The Lowercase Romantic",
    tag: "every text a secret love letter, the shift key politely left on read.",
    score: f =>
      (f.allLowerCount >= 4 ? 4 : f.allLowerCount * 0.7)
      + (f.ellipsisTotal >= 2 ? 2 : f.ellipsisTotal * 0.7)
      + (f.avgLen > 25 ? 1 : 0)
      - f.shoutyCount * 2,
  },
  {
    name: "Captain Capslock",
    tag: "COMMUNICATES primarily through ENERGY. punctuation is a suggestion.",
    score: f =>
      (f.shoutyCount >= 2 ? 5 : f.shoutyCount * 1.8)
      + (f.exclaimTotal >= 4 ? 2 : f.exclaimTotal * 0.3),
  },
  {
    name: "The Comma Artist",
    tag: "weaves long replies like tapestries, pauses mid-thought on purpose, it works.",
    score: f =>
      (f.commaTotal >= 5 ? 4 : f.commaTotal * 0.6)
      + (f.avgLen > 55 ? 2 : 0),
  },
  {
    name: "The Dot Diplomat",
    tag: "ends every reply with a period. a quiet authority. not mad, just clarifying.",
    score: f =>
      (f.periodTotal >= 4 ? 4 : f.periodTotal * 0.7)
      + (f.allLowerCount <= 2 ? 1 : 0)
      - f.ellipsisTotal * 0.5
      - f.shoutyCount * 1,
  },
  {
    name: "The Question Mark Anarchist",
    tag: "answers questions with more questions. demands clarity. shatters it daily.",
    score: f => f.questionTotal * 1.2,
  },
  {
    name: "The Smiley-Face Felon",
    tag: "crime scene of feelings. forensic team identified 🥲 in three reply zones.",
    score: f => (f.emojiTotal >= 5 ? 5 : f.emojiTotal * 0.9),
  },
  {
    name: "The Ellipsis Poet",
    tag: "every thought trails into the void… the reader does the work… and loves it…",
    score: f => (f.ellipsisTotal >= 3 ? 5 + Math.min(f.ellipsisTotal - 3, 4) * 0.5 : f.ellipsisTotal * 1.5),
  },
  {
    name: "The One-Word Warrior",
    tag: "rations syllables like gold. someone once got 'k.' and learned everything.",
    score: f =>
      (f.singleWordCount >= 4 ? 5 : f.singleWordCount * 1.0)
      + (f.avgLen < 12 ? 2 : 0),
  },
  {
    name: "The Exclamation Enthusiast",
    tag: "everything is worth a ! three is just being honest !!!",
    score: f => (f.exclaimTotal >= 7 ? 5 : f.exclaimTotal * 0.65),
  },
  {
    name: "The Abbreviation Archaeologist",
    tag: "u don't type letters u don't need. brb, wyd, tbh — a noble lineage.",
    score: f => (f.abbrevTotal >= 5 ? 5 : f.abbrevTotal * 0.9),
  },
  {
    name: "The Essay Drafter",
    tag: "every reply is a TED talk. 'wyd' deserves 34 words and it knows why.",
    score: f =>
      (f.avgLen > 75 ? 5 : f.avgLen > 55 ? 3 : 0)
      + (f.maxLen > 110 ? 2 : 0),
  },
  {
    name: "The 'lol' Linguist",
    tag: "ends every message with lol so no one can tell if it's a joke lol",
    score: f => (f.endsInLolCount >= 4 ? 6 : f.endsInLolCount >= 3 ? 5 : f.endsInLolCount * 1.5),
  },
  {
    name: "The Perfect Grammar Prophet",
    tag: "capitalizes sentences. uses apostrophes. has never said 'r u up'.",
    score: f =>
      (f.startsCapCount >= 4 ? 3 : f.startsCapCount * 0.5)
      + (f.periodTotal >= 3 ? 2 : 0)
      - f.allLowerCount
      - f.abbrevTotal * 0.3,
  },
  {
    name: "The Tilde Troubadour",
    tag: "communicates in little musical ornaments~ asterisks* a private alphabet.",
    score: f => (f.specialCharsTotal >= 2 ? 5 : f.specialCharsTotal * 1.8),
  },
  {
    name: "The Double-Text Optimist",
    tag: "sends the second thought three seconds after the first. the follow-up is the main course.",
    score: f =>
      (f.multiSentenceCount >= 3 ? 3 : f.multiSentenceCount * 0.6)
      + (f.avgLen > 35 && f.avgLen < 70 ? 1 : 0),
  },
  {
    name: "The Silent Dash Enigma",
    tag: "replies in em-dashes and a single shrug. everyone finds it mysterious.",
    score: f =>
      (f.dashTotal >= 3 ? 4 : f.dashTotal * 0.9)
      + (f.avgLen < 20 ? 1 : 0),
  },
];

// Flattering-by-default fallbacks for truly neutral inputs.
const FALLBACK_ARCHETYPES = [
  { name: "The Ambient Vibes Broadcaster", tag: "texts the way a good playlist works — low stakes, perfectly timed, always there." },
  { name: "The Mixed-Signal Maestro",       tag: "switches registers mid-reply. nobody knows if you're flirting or forecasting weather." },
  { name: "The Calibrated Replier",         tag: "zero signature, infinite deniability. terrifying in group chats." },
  { name: "The Third-Screen Oracle",        tag: "replies as if reading from a book no one else can see. we trust you anyway." },
];

// ---- feature extraction ----

function hash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

const EMOJI_RE    = /\p{Extended_Pictographic}/gu;
const ELLIPSIS_RE = /\.{2,}|…/g;
const ABBREV_RE   = /\b(lol|lmao|lmfao|rofl|idk|idc|idgaf|omw|brb|ttyl|wyd|wym|wya|hbu|u|ur|tbh|ngl|fr|frfr|nvm|ty|thx|imo|imho|ily|omg|smh|asap|btw|iirc|prob|pls|plz|kinda|gonna|wanna|hella|fwiw|jk|yk|ofc)\b/gi;
const SPECIAL_RE  = /[~*_^]/g;

function analyzeReply(s) {
  const trimmed = s.trim();
  const letters = trimmed.match(/[a-zA-Z]/g) || [];
  const upperLetters = trimmed.match(/[A-Z]/g) || [];
  const words = trimmed.split(/\s+/).filter(Boolean);
  const withoutEllipsis = trimmed.replace(ELLIPSIS_RE, "");

  return {
    raw: trimmed,
    len: trimmed.length,
    wordCount: words.length,
    emoji:        (trimmed.match(EMOJI_RE) || []).length,
    ellipsis:     (trimmed.match(ELLIPSIS_RE) || []).length,
    abbrev:       (trimmed.match(ABBREV_RE) || []).length,
    specialChars: (trimmed.match(SPECIAL_RE) || []).length,
    period:       (withoutEllipsis.match(/\./g) || []).length,
    exclaim:      (trimmed.match(/!/g) || []).length,
    question:     (trimmed.match(/\?/g) || []).length,
    comma:        (trimmed.match(/,/g) || []).length,
    dash:         (trimmed.match(/—|--/g) || []).length + (trimmed.match(/\s-\s/g) || []).length,
    allLower:     letters.length > 0 && upperLetters.length === 0,
    shouty:       letters.length >= 4 && upperLetters.length / letters.length > 0.6,
    startsCap:    /^[A-Z]/.test(trimmed),
    endsInLol:    /\b(lol|lmao|lmfao)[.!?]*\s*$/i.test(trimmed),
    multiSentence: (trimmed.match(/[.!?]+\s+\S/g) || []).length > 0 || words.length > 12,
  };
}

function aggregate(replies) {
  const per = replies.map(analyzeReply);
  const sum = k => per.reduce((s, r) => s + r[k], 0);
  return {
    perReply:          per,
    emojiTotal:        sum("emoji"),
    ellipsisTotal:     sum("ellipsis"),
    abbrevTotal:       sum("abbrev"),
    specialCharsTotal: sum("specialChars"),
    periodTotal:       sum("period"),
    exclaimTotal:      sum("exclaim"),
    questionTotal:     sum("question"),
    commaTotal:        sum("comma"),
    dashTotal:         sum("dash"),
    allLowerCount:     per.filter(r => r.allLower).length,
    shoutyCount:       per.filter(r => r.shouty).length,
    startsCapCount:    per.filter(r => r.startsCap).length,
    singleWordCount:   per.filter(r => r.wordCount <= 1).length,
    multiSentenceCount: per.filter(r => r.multiSentence).length,
    endsInLolCount:    per.filter(r => r.endsInLol).length,
    avgLen:            sum("len") / per.length,
    maxLen:            Math.max(...per.map(r => r.len)),
    minLen:            Math.min(...per.map(r => r.len)),
  };
}

function pickArchetypeLocal(replies) {
  // Deterministic offline fallback — used only if the AI call fails.
  const f = aggregate(replies);
  const scored = ARCHETYPES.map(a => ({ a, s: a.score(f) }));
  scored.sort((x, y) => y.s - x.s);
  const seed = hash(replies.join("|"));

  if (scored[0].s >= 3) {
    const topS = scored[0].s;
    const tied = scored.filter(x => topS - x.s < 0.4);
    return { archetype: tied[seed % tied.length].a, features: f, score: topS };
  }
  return { archetype: FALLBACK_ARCHETYPES[seed % FALLBACK_ARCHETYPES.length], features: f, score: 0 };
}

// ---- AI-backed archetype reader ----

function buildAIMessages(replies) {
  const candidates = ARCHETYPES.map(a => `- ${a.name}: ${a.tag}`).join("\n");
  const repliesBlock = PROMPTS.map((p, i) =>
    `${i + 1}. From "${p.sender}" (text: "${p.text}")\n   Reply: ${JSON.stringify(replies[i] || "")}`
  ).join("\n");

  const system =
    `You are the Texting Decoder — a sharp, dry-witted analyst who reads what someone's text replies reveal about their thumbs, vibe, and emotional handwriting. ` +
    `You produce ONE short, punchy texting archetype based on the user's six actual replies. ` +
    `You must pay close attention to: capitalization, punctuation, ellipses, emoji, abbreviations, sentence length, tone, sincerity, deflection, who the recipient is, and any patterns across the six replies. ` +
    `\n\nYou MUST respond with strict JSON only — no markdown, no commentary, no preamble. Schema:\n` +
    `{\n` +
    `  "name": string,        // 2–5 words, Title Case, like "The Lowercase Romantic" or "Captain Capslock". Punchy. Ownable. Worthy of being someone's identity for the day.\n` +
    `  "tag":  string,        // ONE sentence (max ~22 words), all-lowercase or sentence case, in our voice. No emojis. No hashtags. No "you are" framing — write it as a description of the archetype itself.\n` +
    `  "tells": string[]      // 3 or 4 sharp observations grounded in the actual replies. Each ≤ 18 words. Each one should reference a concrete pattern (a specific reply, a count, a habit). No vague horoscope filler. No emojis. No hashtags.\n` +
    `}\n\n` +
    `Voice rules: confident, observational, slightly mean in a fond way, like a friend roasting your group chat. Never therapy-speak. Never "great choice!" energy. Never ask follow-up questions. Never explain your reasoning outside the JSON.\n\n` +
    `Archetype selection: prefer one of the listed candidates if it genuinely fits. If none fit well, invent a new archetype in the same style ("The ___ ___" or "Captain ___" or "The ___ Poet"). Do not just default to a generic option — match the actual evidence.\n\n` +
    `Candidate archetypes (use one of these names verbatim if it fits, or invent a new one):\n${candidates}`;

  const user =
    `Here are my six replies, in order. Read all six together — patterns matter more than any single reply.\n\n` +
    `${repliesBlock}\n\n` +
    `Return only the JSON object. No prose around it.`;

  return [
    { role: 'system', content: system },
    { role: 'user',   content: user },
  ];
}

function sanitizeAIResult(parsed) {
  if (!parsed || typeof parsed !== 'object') return null;
  const name = typeof parsed.name === 'string' ? parsed.name.trim() : '';
  const tag  = typeof parsed.tag  === 'string' ? parsed.tag.trim()  : '';
  let tells = Array.isArray(parsed.tells) ? parsed.tells : [];
  tells = tells
    .filter(t => typeof t === 'string')
    .map(t => t.trim())
    .filter(Boolean)
    .slice(0, 4);
  if (!name || !tag || tells.length < 2) return null;
  return { name, tag, tells };
}

async function pickArchetypeAI(replies) {
  const messages = buildAIMessages(replies);
  const res = await fetch(AI_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      slug: SLUG,
      messages,
      max_tokens: 400,
      temperature: 0,
      response_format: 'json_object',
    }),
  });
  if (!res.ok) throw new Error('http_' + res.status);
  const data = await res.json();
  const raw = (data && data.content) || '';
  let parsed;
  try { parsed = JSON.parse(raw); } catch (_) { parsed = null; }
  const clean = sanitizeAIResult(parsed);
  if (!clean) throw new Error('bad_ai_payload');
  return clean;
}

// ---- tells ----

function buildTells(f) {
  const tells = [];

  if (f.periodTotal === 0 && f.ellipsisTotal >= 1) {
    tells.push(`zero full stops, ${f.ellipsisTotal} ellipses detected… the room is reading.`);
  }
  if (f.emojiTotal >= 4) {
    tells.push(`${f.emojiTotal} emoji across six replies — thumbs fluent in feelings.`);
  } else if (f.emojiTotal === 0) {
    tells.push(`zero emoji. pure text, radical restraint.`);
  }
  if (f.allLowerCount >= 4) {
    tells.push(`${f.allLowerCount} of 6 replies all-lowercase. soft-launch energy.`);
  }
  if (f.shoutyCount >= 1) {
    tells.push(`${f.shoutyCount} reply${f.shoutyCount > 1 ? " in ALL CAPS" : " in ALL CAPS"}. passion delivery.`);
  }
  if (f.questionTotal >= 3) {
    tells.push(`${f.questionTotal} question marks deployed. interrogation-first diplomacy.`);
  }
  if (f.exclaimTotal >= 4) {
    tells.push(`${f.exclaimTotal} exclamation points! everything is significant!`);
  }
  if (f.abbrevTotal >= 4) {
    tells.push(`${f.abbrevTotal} abbreviations. u don't type what u don't need.`);
  }
  if (f.endsInLolCount >= 2) {
    tells.push(`${f.endsInLolCount} replies ended with lol — cushion protocol engaged.`);
  }
  if (f.avgLen > 75) {
    tells.push(`avg reply: ${Math.round(f.avgLen)} characters. TED talks on tap.`);
  } else if (f.avgLen < 15) {
    tells.push(`avg reply: ${Math.round(f.avgLen)} characters. radical efficiency.`);
  }
  if (f.commaTotal >= 5) {
    tells.push(`${f.commaTotal} commas, carefully placed, the rhythm is the message.`);
  }
  if (f.dashTotal >= 2) {
    tells.push(`em-dashes detected — the pause is the point.`);
  }
  if (f.specialCharsTotal >= 2) {
    tells.push(`tildes / asterisks / underscores spotted. private-alphabet energy.`);
  }

  if (tells.length < 2) {
    tells.push(`avg reply: ${Math.round(f.avgLen)} chars — a quietly signature rhythm.`);
    tells.push(`zero obvious tells. the mystery IS the signal.`);
  }
  return tells.slice(0, 4);
}

// ---- UI ----

const state = { step: 0, replies: [] };
const $ = id => document.getElementById(id);

function showScreen(name) {
  ["intro", "quiz", "loading", "result"].forEach(id => {
    $(id).classList.toggle("hidden", id !== name);
  });
  window.scrollTo(0, 0);
}

function startQuiz() {
  state.step = 0;
  state.replies = [];
  showScreen("quiz");
  renderPrompt();
}

function renderPrompt() {
  const p = PROMPTS[state.step];
  $("sender-name").textContent = p.sender;
  $("prompt-text").textContent = p.text;

  // Re-trigger the pop animation
  const bubble = $("prompt-bubble");
  bubble.style.animation = "none";
  void bubble.offsetWidth;
  bubble.style.animation = "";

  $("progress-label").textContent = `Text ${state.step + 1} of ${PROMPTS.length}`;
  $("progress-bar").style.width = `${(state.step / PROMPTS.length) * 100}%`;
  $("error-msg").classList.add("hidden");
  $("reply-input").value = "";
  setTimeout(() => $("reply-input").focus(), 120);
}

function submitReply(e) {
  e.preventDefault();
  const val = $("reply-input").value.trim();
  if (!val) {
    const err = $("error-msg");
    err.textContent = "say something. anything. even 'k'.";
    err.classList.remove("hidden");
    return;
  }
  state.replies.push(val);
  state.step++;
  $("progress-bar").style.width = `${(state.step / PROMPTS.length) * 100}%`;
  if (state.step >= PROMPTS.length) {
    finishQuiz();
  } else {
    renderPrompt();
  }
}

async function finishQuiz() {
  showScreen("loading");
  const seed = hash(state.replies.join("|"));
  $("loading-copy").textContent = LOADING_MSGS[seed % LOADING_MSGS.length];

  // Run AI call and a minimum-loading-time timer in parallel so the
  // typing-bubble never flashes by too fast.
  const minDelay = new Promise(r => setTimeout(r, 1200));
  let result;
  try {
    const aiPromise = pickArchetypeAI(state.replies);
    const [aiResult] = await Promise.all([aiPromise, minDelay]);
    result = { name: aiResult.name, tag: aiResult.tag, tells: aiResult.tells };
  } catch (_) {
    // Deterministic offline fallback — keeps the app working if the proxy
    // is rate-limited, capped, or down.
    await minDelay;
    const local = pickArchetypeLocal(state.replies);
    result = {
      name: local.archetype.name,
      tag: local.archetype.tag,
      tells: buildTells(local.features),
    };
  }
  renderResult(result);
}

function renderResult(result) {
  $("archetype-name").textContent = result.name;
  $("archetype-tag").textContent = result.tag;

  const thread = $("result-thread");
  thread.innerHTML = "";
  PROMPTS.forEach((p, i) => {
    const incoming = document.createElement("div");
    incoming.className = "bubble incoming";
    incoming.innerHTML =
      `<span class="sender-name">${escapeHtml(p.sender)}</span>` +
      `<span class="bubble-text">${escapeHtml(p.text)}</span>`;
    thread.appendChild(incoming);

    const outgoing = document.createElement("div");
    outgoing.className = "bubble outgoing";
    outgoing.textContent = state.replies[i];
    thread.appendChild(outgoing);
  });

  const tellsEl = $("result-tells");
  tellsEl.innerHTML = "";
  const header = document.createElement("p");
  header.className = "tells-header";
  header.textContent = "the tells";
  header.style.cssText = "margin:0 0 10px;font-size:12px;letter-spacing:0.18em;text-transform:uppercase;color:var(--muted);font-weight:700;";
  tellsEl.appendChild(header);
  (result.tells || []).slice(0, 4).forEach(t => {
    const row = document.createElement("div");
    row.className = "tell";
    row.innerHTML = `<span class="tell-marker"></span><span>${escapeHtml(t)}</span>`;
    tellsEl.appendChild(row);
  });

  showScreen("result");
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function retry() {
  state.step = 0;
  state.replies = [];
  showScreen("intro");
}

function share() {
  const name = $("archetype-name").textContent;
  const shareText = name
    ? `I took the Texting Decoder and got: ${name}. what's yours?`
    : "Texting Decoder — what your texts say about you";
  const url = location.href;
  if (navigator.share) {
    navigator.share({ title: document.title, text: shareText, url }).catch(() => {});
  } else if (navigator.clipboard) {
    navigator.clipboard.writeText(`${shareText} ${url}`)
      .then(() => alert("copied — paste it anywhere."))
      .catch(() => alert(url));
  } else {
    alert(url);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  $("start-btn").addEventListener("click", startQuiz);
  $("reply-form").addEventListener("submit", submitReply);
  $("retry-btn").addEventListener("click", retry);
});
