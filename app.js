// Texting Decoder — swipe through a handful of texting threads, get your archetype.
// Each "thread" is its OWN conversation with ONE sender. You see up to 3 texts
// in that thread (the sender can keep going if the chat is alive, or bail early
// if it dies), then you move to the NEXT sender's thread. Four senders total.
// This structure fixes the old confusion of all senders bleeding into a single
// phone-shaped thread: now it reads like flipping through separate DMs.
//
// Uses the shared ef-ai-proxy for both turn-by-turn text generation and final
// archetype read. Falls back to deterministic local paths if the proxy fails
// so the app never breaks.

const AI_ENDPOINT = 'https://uy3l6suz07.execute-api.us-east-1.amazonaws.com/ai';
const SLUG = 'texting-decoder';
const NUM_THREADS = 4;         // four distinct conversations / senders
const MAX_TURNS_PER_THREAD = 3;// at most three incoming texts per sender

// A small bank of possible "senders" the AI can pick from when opening a new
// thread. Keeps the cast diverse and weirdly specific — the thing that makes
// the screenshot funny.
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

// Deterministic opener — always the same first conversation so the UX has a
// clean start. The AI takes over from the second message in this thread and
// for every subsequent thread.
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
  "another message coming in…",
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

// Offline fallback thread openers — only used if the AI-prompt-generation call
// fails. These guarantee the quiz always advances even with no network.
const FALLBACK_THREAD_OPENERS = [
  { sender: "your roommate",                   text: "did u eat or am i making enough for both" },
  { sender: "your situationship, unprompted",  text: "been thinking about u lately. weird of me?" },
  { sender: "a friend, 11:47pm",               text: "my week has been the worst and i don't know where to start" },
  { sender: "the group chat",                  text: "we still on for saturday?? someone confirm because i'm spiraling" },
  { sender: "your ex, randomly",               text: "saw something that reminded me of u. no pressure to respond" },
];

// Offline fallback follow-ups inside a single thread (used when the AI fails
// mid-thread). Generic enough to feel like any sender doubling back.
const FALLBACK_THREAD_FOLLOWUPS = [
  "wait — actually what does that even mean lol",
  "ok but be real with me for a sec",
  "ok so i'm overthinking this — tell me what you'd do",
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

// Flatten the thread structure into one linear list of turns for feature
// extraction. A "turn" is one incoming text + the user's reply (or skip).
function flattenTurns(threads) {
  const out = [];
  threads.forEach(t => {
    t.turns.forEach(turn => {
      out.push({
        sender: t.sender,
        text: turn.text,
        reply: turn.reply || "",
        skipped: !!turn.skipped,
      });
    });
  });
  return out;
}

function aggregate(turns) {
  const answered = turns.filter(t => !t.skipped && t.reply);
  const per = answered.map(t => analyzeReply(t.reply));
  const skippedCount = turns.filter(t => t.skipped).length;
  const sum = k => per.reduce((s, r) => s + r[k], 0);
  const safeAvg = per.length ? sum("len") / per.length : 0;
  const safeMax = per.length ? Math.max(...per.map(r => r.len)) : 0;
  const safeMin = per.length ? Math.min(...per.map(r => r.len)) : 0;
  return {
    perReply:          per,
    skippedCount,
    answeredCount:     per.length,
    totalTurns:        turns.length,
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
    avgLen:            safeAvg,
    maxLen:            safeMax,
    minLen:            safeMin,
  };
}

// Extra ghost-mode archetype for people who skip most of the threads.
const GHOST_ARCHETYPE = {
  name: "The Read-Receipt Ghost",
  tag: "believes not replying is a reply. left four threads on 'delivered' and slept great.",
};

function pickArchetypeLocal(threads) {
  // Deterministic offline fallback — used only if the AI call fails.
  const turns = flattenTurns(threads);
  const f = aggregate(turns);
  const seed = hash(turns.map(t => (t.skipped ? "(skip)" : t.reply)).join("|"));

  // Ghost mode: if the user skipped at least half of their turns, that IS the
  // signature. Scales with however many turns actually happened.
  if (turns.length >= 4 && f.skippedCount >= Math.ceil(turns.length / 2)) {
    return { archetype: GHOST_ARCHETYPE, features: f, score: 10 };
  }

  const scored = ARCHETYPES.map(a => ({ a, s: a.score(f) }));
  scored.sort((x, y) => y.s - x.s);

  if (scored.length && scored[0].s >= 3) {
    const topS = scored[0].s;
    const tied = scored.filter(x => topS - x.s < 0.4);
    return { archetype: tied[seed % tied.length].a, features: f, score: topS };
  }
  return { archetype: FALLBACK_ARCHETYPES[seed % FALLBACK_ARCHETYPES.length], features: f, score: 0 };
}

// ---- AI: generate the NEXT text for whichever thread we're in ----
//
// Two shapes of call:
//   - "new thread": pick a fresh sender and write their opening text.
//   - "continue thread": same sender, next text in the thread, OR decide
//     the thread should end because the chat is dead.

function buildNewThreadMessages(pastThreads, threadIndex, usedSenders) {
  const recap = pastThreads.length
    ? pastThreads.map((t, i) => {
        const lines = t.turns.map((turn, j) =>
          `    - "${t.sender}": ${JSON.stringify(turn.text)}\n      you: ${turn.skipped ? '(ignored)' : JSON.stringify(turn.reply || '')}`
        ).join("\n");
        return `  Thread ${i + 1} with "${t.sender}":\n${lines}`;
      }).join("\n")
    : '  (none yet — this is the first thread.)';

  const system =
    `You are the Texting Decoder engine. The user is flipping through four SEPARATE text threads on their phone — one per sender. ` +
    `You are OPENING a brand new thread from a fresh sender. The user has never replied to this person in this session. ` +
    `\n\nYour job: write ONE opening text message from a new sender that the user has to reply to. ` +
    `It should probe a DIFFERENT facet of their texting personality than the previous threads did (flirty vs. logistical vs. emotional vs. awkward vs. dramatic, etc.). ` +
    `\n\nCRITICAL — anti-one-word bias: the incoming text MUST invite a substantive reply (more than a single word). Avoid openers that naturally get "k", "lol", "yeah", or a shrug. Good examples: an ambiguous accusation, a vulnerable confession, a messy plan needing a counter-proposal, gossip asking "what do i do", a logistics puzzle. Bad examples: "wyd", "you up?", "you good?", "hey". The first thread already used "hey wyd" — don't repeat that energy. ` +
    `\n\nKeep it SHORT: 5–30 words, natural txt register, 1–3 short lines. All lowercase unless the sender is the SHOUTY type. No emoji fireworks. No quotes around the text. No sender name inside the text itself. ` +
    `\n\nYou MUST respond with strict JSON only — no markdown, no commentary, no preamble. Schema:\n` +
    `{\n` +
    `  "sender": string,   // 2–6 words, lowercase. Describes who's texting in a specific, funny way.\n` +
    `  "text":   string    // the opening text. See rules above.\n` +
    `}\n\n` +
    `Sender bank (pick one or invent a similar fresh one — must NOT match already-used senders):\n${SENDER_BANK.map(s => `- ${s}`).join('\n')}\n\n` +
    `Already-used senders (do NOT re-use): ${usedSenders.map(s => `"${s}"`).join(', ') || '(none yet)'}`;

  const user =
    `This is thread #${threadIndex + 1} of ${NUM_THREADS}.\n\n` +
    `Recap of prior threads (for context — the new sender does NOT know about them):\n${recap}\n\n` +
    `Open a fresh thread with a new sender. Return only the JSON object.`;

  return [
    { role: 'system', content: system },
    { role: 'user',   content: user },
  ];
}

function buildContinueThreadMessages(currentThread, turnIndex) {
  const threadBlock = currentThread.turns.map((turn, i) =>
    `  ${i + 1}. "${currentThread.sender}" texted: ${JSON.stringify(turn.text)}\n     You replied: ${turn.skipped ? '(IGNORED — the user chose not to answer)' : JSON.stringify(turn.reply || '')}`
  ).join("\n");

  const system =
    `You are the Texting Decoder engine. You are CONTINUING an ongoing 1-on-1 text thread with ONE specific sender ("${currentThread.sender}"). ` +
    `The user has already exchanged ${currentThread.turns.length} message(s) with this person in this thread. ` +
    `The thread has a max of ${MAX_TURNS_PER_THREAD} incoming texts. ` +
    `\n\nYou have TWO choices for this turn:\n` +
    `  1. Write the NEXT text from the SAME sender that reacts to what the user just said. Keep continuity, use callbacks, let the thread escalate or shift tone.\n` +
    `  2. DECIDE the conversation is dead and end the thread early. Pick this if the user's last reply killed the energy (one-word, dismissive, ignored the text, etc.) and there's nothing natural left to say.\n` +
    `\n\nRespond with strict JSON only — no markdown, no preamble. Schema:\n` +
    `{\n` +
    `  "action": "continue" | "end",\n` +
    `  "text":   string | null   // required if action="continue", MUST be null or omitted if action="end".\n` +
    `}\n\n` +
    `If action="continue": text must come from the SAME sender ("${currentThread.sender}"), match their established voice, be 5–30 words, natural txt register, no sender label. Invite a substantive reply. ` +
    `\n\nIf action="end": the user's last reply killed the chat. Return action="end" and text=null. No excuses, no "ok bye" text. ` +
    `\n\nPrefer "end" when: user sent one-word replies twice in a row, user ignored the most recent text, user replied with pure contempt, or the subject has been fully resolved. ` +
    `Prefer "continue" when: the user engaged substantively, asked a question, introduced a new beat, or the thread clearly has more to say.`;

  const user =
    `Thread with "${currentThread.sender}" so far (turn ${turnIndex + 1} of ${MAX_TURNS_PER_THREAD} max):\n${threadBlock}\n\n` +
    `Decide: continue or end. If continue, write the next text from "${currentThread.sender}". Return only the JSON object.`;

  return [
    { role: 'system', content: system },
    { role: 'user',   content: user },
  ];
}

function sanitizeOpenPayload(parsed, usedSenders) {
  if (!parsed || typeof parsed !== 'object') return null;
  let sender = typeof parsed.sender === 'string' ? parsed.sender.trim() : '';
  let text   = typeof parsed.text   === 'string' ? parsed.text.trim()   : '';
  if (!sender || !text) return null;
  text = text.replace(/^["'`]+|["'`]+$/g, '').trim();
  if (!text) return null;
  const norm = s => s.toLowerCase().replace(/\s+/g, ' ').trim();
  if (usedSenders.some(u => norm(u) === norm(sender))) return null;
  if (sender.length > 60) sender = sender.slice(0, 60);
  if (text.length > 240)  text = text.slice(0, 240);
  return { sender, text };
}

function sanitizeContinuePayload(parsed) {
  if (!parsed || typeof parsed !== 'object') return null;
  const action = parsed.action;
  if (action === 'end') return { action: 'end' };
  if (action === 'continue') {
    let text = typeof parsed.text === 'string' ? parsed.text.trim() : '';
    if (!text) return null;
    text = text.replace(/^["'`]+|["'`]+$/g, '').trim();
    if (!text) return null;
    if (text.length > 240) text = text.slice(0, 240);
    return { action: 'continue', text };
  }
  return null;
}

async function fetchOpenThreadAI(pastThreads, threadIndex, usedSenders) {
  const messages = buildNewThreadMessages(pastThreads, threadIndex, usedSenders);
  const res = await fetch(AI_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      slug: SLUG,
      messages,
      max_tokens: 220,
      temperature: 0.85,
      response_format: 'json_object',
    }),
  });
  if (!res.ok) throw new Error('http_' + res.status);
  const data = await res.json();
  const raw = (data && data.content) || '';
  let parsed;
  try { parsed = JSON.parse(raw); } catch (_) { parsed = null; }
  const clean = sanitizeOpenPayload(parsed, usedSenders);
  if (!clean) throw new Error('bad_ai_open_payload');
  return clean;
}

async function fetchContinueThreadAI(currentThread, turnIndex) {
  const messages = buildContinueThreadMessages(currentThread, turnIndex);
  const res = await fetch(AI_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      slug: SLUG,
      messages,
      max_tokens: 220,
      temperature: 0.8,
      response_format: 'json_object',
    }),
  });
  if (!res.ok) throw new Error('http_' + res.status);
  const data = await res.json();
  const raw = (data && data.content) || '';
  let parsed;
  try { parsed = JSON.parse(raw); } catch (_) { parsed = null; }
  const clean = sanitizeContinuePayload(parsed);
  if (!clean) throw new Error('bad_ai_continue_payload');
  return clean;
}

// ---- AI-backed archetype reader ----

function buildAIMessages(threads) {
  const candidates = ARCHETYPES.map(a => `- ${a.name}: ${a.tag}`).join("\n");
  const turns = flattenTurns(threads);
  const skippedCount = turns.filter(t => t.skipped).length;
  const threadsBlock = threads.map((t, i) => {
    const lines = t.turns.map((turn, j) =>
      `   ${j + 1}. "${t.sender}": ${JSON.stringify(turn.text)}\n      reply: ${turn.skipped ? '(NO REPLY — the user chose not to answer)' : JSON.stringify(turn.reply || '')}`
    ).join("\n");
    return `Thread ${i + 1} with "${t.sender}" (${t.turns.length} text${t.turns.length === 1 ? '' : 's'}):\n${lines}`;
  }).join("\n\n");

  const system =
    `You are the Texting Decoder — a sharp, dry-witted analyst who reads what someone's text replies reveal about their thumbs, vibe, and emotional handwriting. ` +
    `You produce ONE short, punchy texting archetype based on the user's replies across FOUR separate text threads with four different senders. ` +
    `You must pay close attention to: capitalization, punctuation, ellipses, emoji, abbreviations, sentence length, tone, sincerity, deflection, WHO they're replying to (did they soften with mom, get dry with an ex?), WHICH messages they ignored (leaving someone on read is loud), and any patterns across the conversations. ` +
    `\n\nYou MUST respond with strict JSON only — no markdown, no commentary, no preamble. Schema:\n` +
    `{\n` +
    `  "name": string,        // 2–5 words, Title Case, like "The Lowercase Romantic" or "Captain Capslock". Punchy. Ownable.\n` +
    `  "tag":  string,        // ONE sentence (max ~22 words), all-lowercase or sentence case, in our voice. No emojis. No hashtags. No "you are" framing.\n` +
    `  "tells": string[]      // 3 or 4 sharp observations grounded in the actual replies. Each ≤ 18 words. Each one should reference a concrete pattern. No vague horoscope filler.\n` +
    `}\n\n` +
    `Voice rules: confident, observational, slightly mean in a fond way, like a friend roasting your group chat. Never therapy-speak. Never "great choice!" energy. Never ask follow-up questions. Never explain your reasoning outside the JSON.\n\n` +
    `Archetype selection: prefer one of the listed candidates if it genuinely fits. If none fit well, invent a new archetype in the same style. Do not just default to a generic option — match the actual evidence.\n\n` +
    `Candidate archetypes (use one of these names verbatim if it fits, or invent a new one):\n${candidates}`;

  const user =
    `Here are my four threads, in order. Read them all together — patterns across threads matter more than any single turn. ` +
    (skippedCount > 0 ? `NOTE: the user chose not to reply to ${skippedCount} message(s) — ghosting IS a signal, weight it. ` : ``) +
    `\n\n${threadsBlock}\n\n` +
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

async function pickArchetypeAI(threads) {
  const messages = buildAIMessages(threads);
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

// ---- tells (local fallback) ----

function buildTells(f) {
  const tells = [];

  if (f.skippedCount >= 1) {
    tells.push(`${f.skippedCount} message${f.skippedCount === 1 ? '' : 's'} left on read. silence is a reply too.`);
  }
  if (f.periodTotal === 0 && f.ellipsisTotal >= 1) {
    tells.push(`zero full stops, ${f.ellipsisTotal} ellipses detected… the room is reading.`);
  }
  if (f.emojiTotal >= 4) {
    tells.push(`${f.emojiTotal} emoji across your replies — thumbs fluent in feelings.`);
  } else if (f.emojiTotal === 0) {
    tells.push(`zero emoji. pure text, radical restraint.`);
  }
  if (f.allLowerCount >= 3) {
    tells.push(`${f.allLowerCount} replies all-lowercase. soft-launch energy.`);
  }
  if (f.shoutyCount >= 1) {
    tells.push(`${f.shoutyCount} reply in ALL CAPS. passion delivery.`);
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
  } else if (f.avgLen < 15 && f.answeredCount >= 2) {
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
//
// state.threads is an array of { sender, text_count_goal?, turns: [{ text, reply, skipped }] }
// Each thread's `turns.length` grows from 0..MAX_TURNS_PER_THREAD.
// state.activeThreadIdx points at the current thread.
// state.pendingPrompt is the current unanswered incoming text (its text is
// already pushed into the current thread's turns[last] with no reply yet).

const state = {
  threads: [],
  activeThreadIdx: 0,
};
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
  const skip = $("skip-btn");
  if (skip) skip.disabled = !enabled;
}

function startQuiz() {
  state.threads = [];
  state.activeThreadIdx = 0;
  // First thread uses the deterministic opener.
  state.threads.push({
    sender: OPENER.sender,
    turns: [{ text: OPENER.text, reply: "", skipped: false, answered: false }],
    closed: false,
  });
  showScreen("quiz");
  renderThread({ typing: false });
}

function activeThread() {
  return state.threads[state.activeThreadIdx];
}

function currentUnansweredTurn() {
  const th = activeThread();
  if (!th) return null;
  const last = th.turns[th.turns.length - 1];
  if (!last) return null;
  return last.answered ? null : last;
}

function progressFraction() {
  // Progress by: completed threads count, out of NUM_THREADS. This is the
  // mental model the user has ("I'm 2 of 4 convos in").
  const done = state.threads.filter(t => t.closed).length;
  return done / NUM_THREADS;
}

// Render the ACTIVE thread only. Prior threads live behind as "past threads"
// (rendered in the result screen) — the quiz view stays focused on one chat.
function renderThread({ typing, typingText }) {
  const thread = $("chat-thread");
  thread.innerHTML = "";

  const th = activeThread();
  if (!th) return;

  // Sender header bar — reinforces that this is ONE conversation with ONE
  // person, distinct from the other threads.
  const header = document.createElement("div");
  header.className = "thread-header";
  header.innerHTML =
    `<span class="thread-avatar" aria-hidden="true"></span>` +
    `<span class="thread-sender">${escapeHtml(th.sender)}</span>` +
    `<span class="thread-meta">Chat ${state.activeThreadIdx + 1} of ${NUM_THREADS}</span>`;
  thread.appendChild(header);

  // All turns in THIS thread so far.
  th.turns.forEach((turn, idx) => {
    const isLast = idx === th.turns.length - 1;
    const incoming = document.createElement("div");
    incoming.className = "bubble incoming" + (turn.answered ? " past" : "");
    const bt = document.createElement("span");
    bt.className = "bubble-text";
    if (isLast && typing) {
      bt.textContent = typingText || "…";
      incoming.classList.add("typing");
    } else {
      bt.textContent = turn.text;
    }
    incoming.appendChild(bt);
    thread.appendChild(incoming);

    if (turn.answered) {
      const outgoing = document.createElement("div");
      outgoing.className = "bubble outgoing past" + (turn.skipped ? " skipped" : "");
      outgoing.textContent = turn.skipped ? "(ignored)" : turn.reply;
      thread.appendChild(outgoing);
    }
  });

  $("progress-label").textContent = `Chat ${state.activeThreadIdx + 1} of ${NUM_THREADS}`;
  $("progress-bar").style.width = `${progressFraction() * 100}%`;
  $("error-msg").classList.add("hidden");

  if (!typing) {
    $("reply-input").value = "";
    setInputEnabled(true);
    setTimeout(() => $("reply-input").focus(), 120);
    const last = thread.lastElementChild;
    if (last && typeof last.scrollIntoView === "function") {
      last.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  } else {
    setInputEnabled(false);
  }
}

function recordCurrentTurn({ reply, skipped }) {
  const turn = currentUnansweredTurn();
  if (!turn) return;
  turn.reply = skipped ? "" : reply;
  turn.skipped = !!skipped;
  turn.answered = true;
}

async function advance() {
  const th = activeThread();
  if (!th) { finishQuiz(); return; }

  // Decide: continue this thread, or move to the next thread.
  const answeredTurns = th.turns.filter(t => t.answered).length;
  const canContinue = !th.closed && answeredTurns < MAX_TURNS_PER_THREAD;

  if (canContinue) {
    // Ask the AI if the thread should continue or end.
    // Show typing state inside the current thread while we decide.
    const seed = hash(th.turns.map(t => t.reply || "(skip)").join("|")) + answeredTurns;
    const typingText = TYPING_MSGS[seed % TYPING_MSGS.length];
    // Append a placeholder incoming that's typing.
    th.turns.push({ text: "…", reply: "", skipped: false, answered: false, _placeholder: true });
    renderThread({ typing: true, typingText });

    let decision = null;
    try {
      decision = await fetchContinueThreadAI(
        { sender: th.sender, turns: th.turns.filter(t => !t._placeholder) },
        answeredTurns
      );
    } catch (_) {
      // Fallback: continue with a generic follow-up up to 2 turns, else end.
      if (answeredTurns < 2) {
        decision = { action: 'continue', text: FALLBACK_THREAD_FOLLOWUPS[answeredTurns % FALLBACK_THREAD_FOLLOWUPS.length] };
      } else {
        decision = { action: 'end' };
      }
    }

    // Pop the placeholder before committing the real outcome.
    const placeholderIdx = th.turns.findIndex(t => t._placeholder);
    if (placeholderIdx >= 0) th.turns.splice(placeholderIdx, 1);

    if (decision.action === 'continue') {
      th.turns.push({ text: decision.text, reply: "", skipped: false, answered: false });
      renderThread({ typing: false });
      return;
    }
    // else action === 'end' — fall through to close-thread path
    th.closed = true;
  } else {
    th.closed = true;
  }

  // Thread is closed — advance to next thread (or finish).
  state.activeThreadIdx++;
  if (state.activeThreadIdx >= NUM_THREADS) {
    finishQuiz();
    return;
  }
  await openNextThread();
}

async function openNextThread() {
  // Typing state while we ask the AI for a new sender/opening text.
  const usedSenders = state.threads.map(t => t.sender);
  const seed = hash(usedSenders.join("|")) + state.activeThreadIdx;
  const typingText = TYPING_MSGS[seed % TYPING_MSGS.length];

  // Insert a placeholder thread to render a typing indicator inside.
  const placeholder = {
    sender: "…",
    turns: [{ text: "…", reply: "", skipped: false, answered: false, _placeholder: true }],
    closed: false,
    _placeholder: true,
  };
  state.threads.push(placeholder);
  renderThread({ typing: true, typingText });

  let opened = null;
  try {
    const pastThreads = state.threads.slice(0, state.activeThreadIdx);
    opened = await fetchOpenThreadAI(pastThreads, state.activeThreadIdx, usedSenders);
  } catch (_) {
    // Fallback: pick an unused opener.
    const remaining = FALLBACK_THREAD_OPENERS.filter(p => !usedSenders.includes(p.sender));
    const pool = remaining.length ? remaining : FALLBACK_THREAD_OPENERS;
    const fseed = hash(usedSenders.join("|") + state.activeThreadIdx);
    opened = pool[fseed % pool.length];
  }

  // Replace placeholder with real thread.
  state.threads[state.activeThreadIdx] = {
    sender: opened.sender,
    turns: [{ text: opened.text, reply: "", skipped: false, answered: false }],
    closed: false,
  };
  renderThread({ typing: false });
}

async function submitReply(e) {
  e.preventDefault();
  const val = $("reply-input").value.trim();
  if (!val) {
    const err = $("error-msg");
    err.textContent = "say something, or tap 'leave on read'.";
    err.classList.remove("hidden");
    return;
  }
  recordCurrentTurn({ reply: val, skipped: false });
  advance();
}

function skipReply() {
  if ($("skip-btn").disabled) return;
  recordCurrentTurn({ reply: "", skipped: true });
  advance();
}

async function finishQuiz() {
  showScreen("loading");
  const turns = flattenTurns(state.threads);
  const seed = hash(turns.map(t => (t.skipped ? "(skip)" : t.reply)).join("|"));
  $("loading-copy").textContent = LOADING_MSGS[seed % LOADING_MSGS.length];

  const minDelay = new Promise(r => setTimeout(r, 1200));
  let result;
  try {
    const aiPromise = pickArchetypeAI(state.threads);
    const [aiResult] = await Promise.all([aiPromise, minDelay]);
    result = { name: aiResult.name, tag: aiResult.tag, tells: aiResult.tells };
  } catch (_) {
    await minDelay;
    const local = pickArchetypeLocal(state.threads);
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

  const threadHost = $("result-thread");
  threadHost.innerHTML = "";

  // Render each thread as its own mini-block so the share card matches the
  // "separate DMs" mental model.
  state.threads.forEach((t, i) => {
    const block = document.createElement("div");
    block.className = "result-thread-block";

    const header = document.createElement("div");
    header.className = "result-thread-header";
    header.textContent = t.sender;
    block.appendChild(header);

    t.turns.forEach(turn => {
      const incoming = document.createElement("div");
      incoming.className = "bubble incoming";
      incoming.innerHTML = `<span class="bubble-text">${escapeHtml(turn.text)}</span>`;
      block.appendChild(incoming);

      if (turn.answered) {
        const outgoing = document.createElement("div");
        outgoing.className = "bubble outgoing" + (turn.skipped ? " skipped" : "");
        outgoing.textContent = turn.skipped ? "(left on read)" : turn.reply;
        block.appendChild(outgoing);
      }
    });

    threadHost.appendChild(block);
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
  state.threads = [];
  state.activeThreadIdx = 0;
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
  const skip = $("skip-btn");
  if (skip) skip.addEventListener("click", skipReply);
});
