// Texting Decoder — reply to six texts, get your archetype.
// Now fully AI-driven: the INCOMING texts are generated on the fly based on your
// previous replies, so the "chat thread" feels like a real conversation that
// evolves with your tone. The final archetype read is also AI-generated.
// Uses the shared ef-ai-proxy. Falls back to deterministic local paths if the
// proxy fails so the app never breaks.

const AI_ENDPOINT = 'https://uy3l6suz07.execute-api.us-east-1.amazonaws.com/ai';
const SLUG = 'texting-decoder';
const NUM_PROMPTS = 6;

// A small bank of possible "senders" the AI can pick from when generating the
// next incoming text. This keeps the cast diverse and weirdly specific — the
// thing that makes the screenshot funny.
const SENDER_BANK = [
  "someone you half-know",
  "your roommate",
  "your situationship, unprompted",
  "a friend, 11:47pm",
  "the group chat",
  "your ex, randomly",
  "your mom",
  "your boss, on a sunday",
  "the crush from the party",
  "your most dramatic friend",
  "a person you owe $7",
  "your old coworker, out of nowhere",
  "your group chat nemesis",
  "the cousin who overshares",
  "the one who's always manifesting",
  "your dentist's front desk",
  "a matched dating app chat",
];

// Deterministic opener — always the same first message so the UX has a clean
// start. The AI takes over from message 2 onward, reacting to your replies.
const OPENER = { sender: "someone you half-know", text: "hey wyd" };

const LOADING_MSGS = [
  "reading between the periods…",
  "cross-referencing your lowercase…",
  "counting the commas, one by one…",
  "consulting the ellipsis council…",
  "decoding thumb energy…",
  "auditing your 'lol' placement…",
  "waiting for read receipts from the cosmos…",
];

const TYPING_MSGS = [
  "they're typing…",
  "…",
  "new thread incoming…",
  "another one's coming in…",
  "thumb activity detected…",
];

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

// Offline fallback prompts — only used if the AI-prompt-generation call fails.
// These guarantee the quiz always advances to six even with no network.
const FALLBACK_PROMPTS = [
  { sender: "your roommate",               text: "did u eat" },
  { sender: "your situationship, unprompted", text: "been thinking about u lately" },
  { sender: "a friend, 11:47pm",           text: "my week has been the worst" },
  { sender: "the group chat",              text: "we still on for saturday??" },
  { sender: "your ex, randomly",           text: "saw something that reminded me of u" },
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

// ---- AI: generate the next incoming text based on prior conversation ----

function buildNextPromptMessages(history, stepIndex, usedSenders) {
  const threadBlock = history.map((h, i) =>
    `${i + 1}. "${h.sender}" texted: ${JSON.stringify(h.text)}\n   You replied: ${JSON.stringify(h.reply)}`
  ).join("\n");

  const system =
    `You are the Texting Decoder engine, scripting a six-message text-message quiz that feels like a real, chaotic phone. ` +
    `Your job right now is to write ONE NEW incoming text message that the user has to reply to. ` +
    `The message must feel like it comes from a DIFFERENT person than any already used, with a distinct vibe, so the user's texting personality is tested across a wide surface area (flirty, logistical, emotional, awkward, nosy, dramatic, etc.). ` +
    `The text should feel slightly pressuring to reply to — a question, a vulnerable statement, an ambiguous opener, a plan, a crumb, an accusation, something they can't just ignore. ` +
    `Keep it SHORT — one to two lines, like a real text. Do not use emojis unless they're structurally load-bearing. ` +
    `Lean into tonal specificity from the user's established replies so the thread feels reactive: if they went dry, someone pushes harder; if they were sincere, someone calls them out softly; if they were chaotic, someone asks "are you okay". But don't lampshade it — just feel like the next text that would actually land in their phone.\n\n` +
    `You MUST respond with strict JSON only — no markdown, no commentary, no preamble. Schema:\n` +
    `{\n` +
    `  "sender": string,   // 2–6 words, lowercase. Describes who's texting in a specific, funny way. Pick one from the sender bank below, or invent one in the same style. Must not duplicate any already-used sender.\n` +
    `  "text":   string    // the actual text message, 1–14 words, natural txt register. All lowercase unless the sender is the SHOUTY type. No quotes. No sender name. No emoji fireworks.\n` +
    `}\n\n` +
    `Sender bank (pick one or invent a similar):\n${SENDER_BANK.map(s => `- ${s}`).join('\n')}\n\n` +
    `Already-used senders (do NOT reuse, invent fresh variety): ${usedSenders.map(s => `"${s}"`).join(', ') || '(none yet)'}`;

  const user =
    `This is text #${stepIndex + 1} of ${NUM_PROMPTS} in the thread.\n\n` +
    (history.length
      ? `Thread so far:\n${threadBlock}\n\n`
      : `No messages yet — this is the first incoming text.\n\n`) +
    `Write the next incoming text. Return only the JSON object.`;

  return [
    { role: 'system', content: system },
    { role: 'user',   content: user },
  ];
}

function sanitizePrompt(parsed, usedSenders) {
  if (!parsed || typeof parsed !== 'object') return null;
  let sender = typeof parsed.sender === 'string' ? parsed.sender.trim() : '';
  let text   = typeof parsed.text   === 'string' ? parsed.text.trim()   : '';
  if (!sender || !text) return null;
  // Strip surrounding quotes the model sometimes adds
  text = text.replace(/^["'`]+|["'`]+$/g, '').trim();
  if (!text) return null;
  // Enforce non-duplicate senders (loose compare)
  const norm = s => s.toLowerCase().replace(/\s+/g, ' ').trim();
  if (usedSenders.some(u => norm(u) === norm(sender))) return null;
  // Truncate absurdly long values defensively
  if (sender.length > 60) sender = sender.slice(0, 60);
  if (text.length > 160)  text = text.slice(0, 160);
  return { sender, text };
}

async function fetchNextPromptAI(history, stepIndex, usedSenders) {
  const messages = buildNextPromptMessages(history, stepIndex, usedSenders);
  const res = await fetch(AI_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      slug: SLUG,
      messages,
      max_tokens: 160,
      temperature: 0.85,
      response_format: 'json_object',
    }),
  });
  if (!res.ok) throw new Error('http_' + res.status);
  const data = await res.json();
  const raw = (data && data.content) || '';
  let parsed;
  try { parsed = JSON.parse(raw); } catch (_) { parsed = null; }
  const clean = sanitizePrompt(parsed, usedSenders);
  if (!clean) throw new Error('bad_ai_prompt_payload');
  return clean;
}

// ---- AI-backed archetype reader ----

function buildAIMessages(history) {
  const candidates = ARCHETYPES.map(a => `- ${a.name}: ${a.tag}`).join("\n");
  const repliesBlock = history.map((h, i) =>
    `${i + 1}. From "${h.sender}" (text: "${h.text}")\n   Reply: ${JSON.stringify(h.reply || "")}`
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

async function pickArchetypeAI(history) {
  const messages = buildAIMessages(history);
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

// state.history = [{ sender, text, reply }]
const state = { step: 0, history: [], pendingPrompt: null };
const $ = id => document.getElementById(id);

function showScreen(name) {
  ["intro", "quiz", "loading", "result"].forEach(id => {
    $(id).classList.toggle("hidden", id !== name);
  });
  window.scrollTo(0, 0);
}

function setInputEnabled(enabled) {
  $("reply-input").disabled = !enabled;
  $("send-btn").disabled = !enabled;
}

function startQuiz() {
  state.step = 0;
  state.history = [];
  state.pendingPrompt = { sender: OPENER.sender, text: OPENER.text };
  showScreen("quiz");
  renderPrompt();
}

function renderPrompt() {
  const p = state.pendingPrompt;
  if (!p) return;
  $("sender-name").textContent = p.sender;
  $("prompt-text").textContent = p.text;

  // Re-trigger the pop animation
  const bubble = $("prompt-bubble");
  bubble.classList.remove("hidden");
  bubble.style.animation = "none";
  void bubble.offsetWidth;
  bubble.style.animation = "";

  $("progress-label").textContent = `Text ${state.step + 1} of ${NUM_PROMPTS}`;
  $("progress-bar").style.width = `${(state.step / NUM_PROMPTS) * 100}%`;
  $("error-msg").classList.add("hidden");
  $("reply-input").value = "";
  setInputEnabled(true);
  setTimeout(() => $("reply-input").focus(), 120);
}

async function submitReply(e) {
  e.preventDefault();
  const val = $("reply-input").value.trim();
  if (!val) {
    const err = $("error-msg");
    err.textContent = "say something. anything. even 'k'.";
    err.classList.remove("hidden");
    return;
  }

  // Record this turn in the history.
  const current = state.pendingPrompt;
  state.history.push({ sender: current.sender, text: current.text, reply: val });
  state.step++;
  $("progress-bar").style.width = `${(state.step / NUM_PROMPTS) * 100}%`;

  if (state.step >= NUM_PROMPTS) {
    finishQuiz();
    return;
  }

  // Show a "typing" state while the next incoming text is generated by the AI.
  setInputEnabled(false);
  const bubble = $("prompt-bubble");
  bubble.classList.add("hidden");
  $("sender-name").textContent = "";
  const seed = hash(state.history.map(h => h.reply).join("|")) + state.step;
  $("prompt-text").textContent = TYPING_MSGS[seed % TYPING_MSGS.length];

  const next = await fetchNextPromptWithFallback();
  state.pendingPrompt = next;
  renderPrompt();
}

async function fetchNextPromptWithFallback() {
  const usedSenders = state.history.map(h => h.sender);
  // Dedupe against the pending prompt's sender too, just in case.
  const minDelay = new Promise(r => setTimeout(r, 500));
  try {
    const [p] = await Promise.all([
      fetchNextPromptAI(state.history, state.step, usedSenders),
      minDelay,
    ]);
    return p;
  } catch (_) {
    // Offline path: pick a fallback prompt that hasn't been used yet.
    await minDelay;
    const remaining = FALLBACK_PROMPTS.filter(p => !usedSenders.includes(p.sender));
    const pool = remaining.length ? remaining : FALLBACK_PROMPTS;
    const seed = hash(state.history.map(h => h.reply).join("|") + state.step);
    return pool[seed % pool.length];
  }
}

async function finishQuiz() {
  showScreen("loading");
  const seed = hash(state.history.map(h => h.reply).join("|"));
  $("loading-copy").textContent = LOADING_MSGS[seed % LOADING_MSGS.length];

  // Run AI call and a minimum-loading-time timer in parallel so the
  // typing-bubble never flashes by too fast.
  const minDelay = new Promise(r => setTimeout(r, 1200));
  let result;
  try {
    const aiPromise = pickArchetypeAI(state.history);
    const [aiResult] = await Promise.all([aiPromise, minDelay]);
    result = { name: aiResult.name, tag: aiResult.tag, tells: aiResult.tells };
  } catch (_) {
    // Deterministic offline fallback — keeps the app working if the proxy
    // is rate-limited, capped, or down.
    await minDelay;
    const replies = state.history.map(h => h.reply);
    const local = pickArchetypeLocal(replies);
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
  state.history.forEach((h) => {
    const incoming = document.createElement("div");
    incoming.className = "bubble incoming";
    incoming.innerHTML =
      `<span class="sender-name">${escapeHtml(h.sender)}</span>` +
      `<span class="bubble-text">${escapeHtml(h.text)}</span>`;
    thread.appendChild(incoming);

    const outgoing = document.createElement("div");
    outgoing.className = "bubble outgoing";
    outgoing.textContent = h.reply;
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
  state.history = [];
  state.pendingPrompt = null;
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
