// OFFICIAL playbook content — extracted from Corgi's internal docs (Rev. 2026):
// Cold_Calling_Best_Practices, Coverage_Manual, Direct_to_Fleets_Playbook,
// Sales_Playbook. Verbatim where the docs script it. Supersedes the
// telegram-mined approximations (2026-07-06).

export interface Script {
  tag: string;
  name: string;
  when: string;
  opener: string; // THE line — ONE short natural sentence, an open question. Never a recital.
  then: string; // the one move after they respond
  hook: string; // reference only
  notes: string[]; // reference only
}

// ---------- FLEET (trucking) scripts — official trigger-based openers ----------

export const SCRIPTS: Script[] = [
  {
    tag: "RS",
    name: "Rescue — non-renewed / cancelled",
    when: "Carrier non-renewed, cancelled, or lapse showing on L&I. Opens the window ANY time — they can't legally run without coverage.",
    opener:
      "Hi {name} — Corgi Insurance. I saw your insurance filing's dropping with the FMCSA — what's going on there?",
    then: "Listen. Then: 'If the trucks need to stay on the road, we move same-day. Dec page and your MC or DOT — that's all I need.'",
    hook: "You may be getting non-renewed or priced up — that is exactly what we fix. New authorities and rough records are squarely what we write.",
    notes: [
      "OFFICIAL: 'We write the classes carriers are dropping. Send your dec page and loss runs, we'll have a number same day.'",
      "Non-renewal = immediate action. Same-day/next-day cycle on a scramble.",
      "Goal: dec page + MC/DOT + loss runs. Never quote a number blind.",
    ],
  },
  {
    tag: "RW",
    name: "Renewal wire — rate hike window",
    when: "Renewal 30–60 days out (sweet spot 45d). This is when carriers actually shop.",
    opener:
      "Hi {name} — Corgi Insurance, we only do trucking. What's your renewal been looking like the last couple years?",
    then: "Let them tell the story (rate hike = your opening). Then: 'Let me have a number ready before you re-sign — dec page and DOT is all I need.'",
    hook: "Your clean record and safety tech pull our number down. Let me show you what you'd actually pay with us. Rates rose 18.6% from 2021 to 2024 even as crashes fell — a lot of fleets are getting non-renewed or hit with big jumps. Has that hit you yet?",
    notes: [
      "Lead with THEIR renewal or THEIR pain, not Corgi.",
      "Get the exact renewal date even on a no — log it, call back 45 days out.",
      "Defense costs paid ON TOP of the auto limit — the biggest coverage edge vs cheap quotes.",
    ],
  },
  {
    tag: "NA",
    name: "New authority",
    when: "Authority <12–24 months old — hardest to insure elsewhere, Corgi's biggest opening",
    opener:
      "Hi {name} — Corgi Insurance. You've got fresh authority — how's insurance shopping been treating you?",
    then: "They'll vent (everyone declines them). Then: 'New authorities are exactly who we want. What are you running? Let me get you a path to coverage.'",
    hook: "We work with newer operations where most insurers just decline. That gap is the reason we exist. Per-trip cargo fits if you're running spot.",
    notes: [
      "New ventures: full loss history for what exists; 'market interest' where runs don't.",
      "Broker pressure angle stacks: 'we write to $1M and file the AI and MCS-90 immediately.'",
    ],
  },
  {
    tag: "PL",
    name: "Per-trip cargo / spot market",
    when: "Spot/seasonal haulers, owner-ops — broker requires cargo on the certificate",
    opener:
      "Hi {name} — Corgi Insurance. Quick one: when a broker wants cargo on the certificate, what do you do today?",
    then: "Listen for passed loads / eaten risk. Then: 'We do cargo per registered trip — pay per load. What's a typical load worth?'",
    hook: "Most freight brokers won't tender without cargo. A loss on someone else's freight comes out of your pocket. Per-trip satisfies the broker requirement load by load.",
    notes: [
      "Per-trip: register EVERY trip before loading — no registration, no coverage. $2,500 annual minimum.",
      "Trips over $250K declared value need prior underwriting approval.",
    ],
  },
  {
    tag: "GEN",
    name: "General — broker pressure / bad claims / agent gone quiet",
    when: "No live signal — pick the trigger from qualifying",
    opener:
      "Hi {name} — Corgi Insurance, we only do trucking. Walk me through your operation — what are you running and where?",
    then: "Their answer picks the angle: renewal pain → RW ask · broker pressure → $1M/AI/MCS-90 · bad claims → trucking-only claims team. One trigger, one ask.",
    hook: "Broker pressure: 'We write to $1M and file the AI and MCS-90 immediately — tell me what the broker is asking for.' Bad claims: 'Our claims team handles only trucking. Different speed, different attitude.' Agent stopped helping: 'We'll work through your broker if you want, or come direct — either way you get a human who answers.'",
    notes: [
      "Freeze fallback: 'We're trucking-only. We can usually quote in about ten minutes, our pricing is built to hold at renewal, and we write the classes a lot of carriers are dropping.'",
      "Lost a key customer: 'Tight times are when stable pricing matters most.'",
    ],
  },
];

export const FIVE_BEAT =
  "They talk 70%. Ask, then SHUT UP. Goal = dec page + MC/DOT. Never quote a price.";

// ---------- objections — OFFICIAL 16-turn bank (Hear It → Turn It → Ask) ----------

export interface Turn {
  name: string;
  hear: string;
  turn: string;
  ask: string;
}

export const OBJECTIONS: Turn[] = [
  { name: "I'm already covered", hear: "Fair, most owners I call are.", turn: "The question is renewal. Even good fleets are seeing 7 to 15% jumps this year. You're built to hold.", ask: "When's your renewal? Let me have a number ready to compare. Costs nothing to look." },
  { name: "You're not the cheapest", hear: "I hear you, margins are thin.", turn: "The cheap quote is usually the one that spikes or non-renews next year, then you're parked. We price per truck, your clean record and cameras pull the number down.", ask: "What safety tech are you running? Let me build a number that reflects how you operate." },
  { name: "Just send me an email", hear: "Happy to, and I'll send something useful, not a flyer.", turn: "So I send the right thing, two quick questions.", ask: "What do you haul, and when's renewal? I'll send a tailored note and follow up." },
  { name: "I'm driving / slammed", hear: "Won't keep you, I know you're working.", turn: "Thirty seconds. Two facts and I do the rest on my end.", ask: "Renewal date and what you're hauling? I'll pull your DOT, build it, and call back when it's good." },
  { name: "Never heard of Corgi", hear: "Fair, we're focused, not flashy.", turn: "Corgi Insurance, trucking only, owned by the operators we insure, with a claims team that does trucking all day. We can usually quote in about ten minutes.", ask: "Worth two minutes to see if we beat what you've got? When's renewal?" },
  { name: "Got burned by an unknown carrier", hear: "That's real, and it's why a lot of owners are wary.", turn: "We're not a fly-by-night quote. Claims go to a dedicated trucking team, you keep your authority, and because owners run this, we're built to stay.", ask: "Let me earn it with a number, no obligation. What's your renewal date?" },
  { name: "I'm just one truck", hear: "Not too small at all.", turn: "Owner-operators are core to what we write, and a single-truck policy is quick. Your clean record earns the same credits a big fleet gets.", ask: "What are you hauling, and when's renewal? Let me get you a number." },
  { name: "How do I know you'll pay claims?", hear: "Smart question, it's your livelihood.", turn: "Claims go to a dedicated trucking adjusting team, and because the company is owned by its insureds, paying fair claims is the whole point, not a cost to dodge.", ask: "Happy to walk you through how a claim works. First, let me get you a number." },
  { name: "I only work with people I know", hear: "Trust matters in this business, I respect that.", turn: "Most of our fleets came in skeptical too. You build trust through a fair number and a claim handled right, not a logo you already recognize.", ask: "Let me earn a spot on your comparison sheet. When's renewal?" },
  { name: "Money's tight", hear: "Everybody's feeling the squeeze right now.", turn: "That's the reason to look. A lower, stable rate is a cut you keep, and your clean record and cameras are leverage we can actually price in.", ask: "What are you paying now? Let me see if I can beat it." },
  { name: "My agent handles my insurance", hear: "Good, a sharp insurance broker is worth having.", turn: "We work through your broker or direct. Most brokers don't have a trucking-only market like us in their lineup, so it's worth a look.", ask: "Who's your broker? I'll loop them in, or get you a number to bring to them." },
  { name: "I don't need cargo", hear: "Could be, depends what you move.", turn: "Most freight brokers won't tender without cargo on the certificate, and a loss on someone else's freight comes out of your pocket. If you run spot, we can do per-trip.", ask: "What do you haul, and what's a load worth? I'll show you what cargo runs." },
  { name: "My record isn't clean", hear: "Appreciate you being straight.", turn: "We write the full range, clean to rough, we just price it. A claim doesn't disqualify you, and the markets that dropped you are exactly who we replace.", ask: "Don't count yourself out. Send your loss runs and dec page and let underwriting look." },
  { name: "Just give me a price now", hear: "I get it, you want a number, not a pitch.", turn: "I won't guess — a made-up number helps neither of us. It's priced per truck off your record, radius, and safety setup, and I want it accurate, not a bait number.", ask: "Get me your dec page and MC or DOT and I'll have a real quote fast, usually same day." },
  { name: "New authority — nobody'll write me", hear: "That's the hardest spot to be in.", turn: "New authorities are squarely what we do. We work with newer operations where most insurers just decline. That gap is the reason we exist.", ask: "How long have you had authority, and what are you running? Let me get you a path to coverage." },
  { name: "Call me back at renewal", hear: "Smart, that's when it matters.", turn: "I'll do exactly that, and I'll have your number prepped so it's ready the day you need it, not started from scratch.", ask: "What's the exact renewal date? I'll lock it and reach out about 45 days ahead." },
];

// Broker/agency partner objections — same facts as AGENT_QA (official answers), phrased as
// call-flow rebuttals. Fleet OBJECTIONS above are carrier-facing and wrong for this audience.
export const BROKER_OBJECTIONS: Turn[] = [
  { name: "We only work with A-rated carriers", hear: "Fair — most standard markets require it.", turn: "We're member-owned RRG paper, Arizona-regulated, reinsured above $100K per occurrence. The trucking accounts your A-rated markets decline or non-renew are exactly what we write, and most quotes come back same day.", ask: "What do you do today with the trucking risks your markets won't touch?" },
  { name: "Never heard of Corgi / CarrierGuard", hear: "Fair — we're a focused trucking program, not a household name.", turn: "Trucking-only, owned by the operators we insure, dedicated trucking claims TPA, digital quote-and-bind portal. We live in the niche your generalist markets treat as an afterthought.", ask: "Send me one hard-to-place account and judge us on the number and the turnaround." },
  { name: "I already have trucking markets", hear: "Keep them — this isn't either-or.", turn: "We're the second market for what they decline: cancellations, new authorities, rough records. A market that says yes where others say no costs you nothing to have appointed.", ask: "How many trucking submissions did your markets decline or non-renew last month?" },
  { name: "What's in it for me / commission?", hear: "Straight question, straight answer.", turn: "Typical commercial-trucking range, roughly 10 to 15%, set in the producer agreement — plus speed: most submissions quote same day, so you stop losing deals to slow turnarounds.", ask: "Want me to send over the producer agreement and appetite guide today?" },
  { name: "RRGs make me nervous / will claims get paid", hear: "That's a real concern and worth answering properly.", turn: "Claims run through a dedicated trucking TPA, we're held to statutory capital and reporting by the Arizona regulator, and a reinsurance program sits behind every $1M limit precisely so one large loss never threatens members.", ask: "Want me to walk you through exactly how a claim flows, start to finish?" },
  { name: "What's your appetite?", hear: "Best question you can ask — it saves us both time.", turn: "Owner-operators and small-to-mid fleets, most commodities. We won't write limits above $1M, placarded hazmat, or the excluded cargo list as primary freight. Almost everything else in trucking is in appetite.", ask: "Got an account on your desk right now that fits that box?" },
  { name: "Your quote came back high", hear: "Understood — nobody binds a number that isn't competitive.", turn: "Pricing reflects the data we get. Connecting the fleet's telematics usually moves the number — clean driving data earns real credits, and underwriting will re-rate with it.", ask: "Will your client connect their ELD or telematics so we can re-run it?" },
  { name: "Send me something / too busy", hear: "Happy to — and I'll keep it useful, not a brochure.", turn: "I'll send the appetite guide and how submissions work. The thirty-second version: trucking-only market, same-day quotes, writes what your standard markets decline.", ask: "While I have you — is there one account you'd test us on this month?" },
];

// brush-offs = questions in disguise (official table)
export const NOT_INTERESTED = [
  { mode: "SEND AN EMAIL", cue: "= I don't see why I'd switch", move: "\"Sure. What would you need to see in it to make it worth your time?\" Make them co-write it — never accept it as a task." },
  { mode: "TOO BUSY", cue: "= this isn't a priority", move: "\"Fair. Is now just bad timing, or is insurance off your mind until renewal?\"" },
  { mode: "WE'RE ALL SET", cue: "= I don't feel any pain", move: "\"Good to hear. What are you set with, if you don't mind me asking?\"" },
  { mode: "CALL ME LATER", cue: "= I'm not ready, or not interested", move: "\"Will do. What changes between now and then that I should know about?\"" },
  { mode: "TALK TO MY PARTNER", cue: "= real blocker, or a stall", move: "\"Smart. What do you think they'll want to know? Let's get them the answer now.\"" },
];

// ---------- gatekeeper + craft (official Best Practices) ----------

export const GATEKEEPER = [
  "Gatekeeper line (official): \"I help fleets keep their auto and cargo competitive at renewal. Is [owner] the right person, and when's a good time?\" Be friendly, get the owner's name and best time.",
  "THE 70/30 RULE: on a good call the owner talks 70%. Trust builds when you listen; their pain tells you exactly which angle closes them; commitment comes from their mouth, not yours.",
  "Open questions, not yes/no: \"What's your renewal been like the last couple years?\" beats \"Is your renewal coming up?\"",
  "Follow-up probe — go one level deeper: \"Tell me more about that.\" The second answer is always more honest.",
  "Label the emotion: \"Sounds like that rate hike really stung.\" · Mirror their last few words · Use silence as a tool — ask, then wait.",
  "Openers that work: \"Walk me through your operation — what are you running and where?\" · \"What's renewal season usually like for you?\" · \"What's the biggest headache with your current coverage?\" · \"What do your freight brokers give you the most grief about?\"",
  "NEVER open with: \"Do you have a few minutes?\" (invites a no) · \"Are you happy with your insurance?\" (yep, all set) · \"Can I tell you about Corgi?\" (makes it about you) · anything answerable in one word.",
  "Trucking-specific: ask a flatbed guy about his heaviest haul, a reefer operator about a load that almost spoiled, an owner-op how he got his authority. Two minutes of that and they're talking to a person who gets trucking.",
];

// ---------- qualifying — official 10-question bank ----------

export interface QualQ {
  q: string;
  listen: string;
}

export const QUALIFYING: QualQ[] = [
  { q: "Walk me through what happened at your last renewal. Did your price hold, jump, or did you switch carriers?", listen: "Real owners tell a specific story with numbers. 'It was fine' = they don't know or won't say. Renewal pain is your strongest opener." },
  { q: "What's the one thing your carrier does well, and the one thing that drives you nuts?", listen: "Forced opinion on both halves = engaged. 'Everything's fine' = polite no." },
  { q: "Last five years — how many at-fault claims, and how did your carrier handle the worst one?", listen: "Honesty on loss history + claims trauma (the biggest reason fleets switch)." },
  { q: "How often is a freight broker holding up a load over your certificate — limits, additional insureds, MCS-90?", listen: "Real owners have a story. Tire-kickers don't know what an AI endorsement is." },
  { q: "How many other quotes have you gotten for this renewal, and what did you make of them?", listen: "'You're my first call' + real renewal date = ideal. Five quotes = ask why nobody's closed them." },
  { q: "If we come back 10% under, what does it take to actually move — and what could still hold you back?", listen: "The 'hold back' half is gold: agent loyalty, contracts, financing, a partner who won't move." },
  { q: "When can I get your loss runs and dec page — today, this week, or is that tough?", listen: "THE commitment test. Buyers send them today or tomorrow. 'I'll look for it' then silence = your answer." },
  { q: "Who else signs off — partner, accountant, insurance broker — and where do they sit today?", listen: "'My agent of 20 years handles it' = hard displace. 'Just me' = clean shot." },
  { q: "If we're not the right fit on price, would you rather know today or after a week of back-and-forth?", listen: "Real buyers want efficiency: 'today.' 'No rush' = not actually buying." },
  { q: "If you stay put and it gets worse — another hike, a non-renewal, broker drops you — what does that look like?", listen: "Engaged owners name specifics ('I'd lose two contracts'). 'Probably fine' = no stakes, no intent." },
  { q: "EARN THE RIGHT first: \"Before I get something on your calendar, can I ask a few quick questions so the conversation is actually useful for you?\"", listen: "Then pick 3–5 that fit. GREEN → book + prep. YELLOW → push to disqualify: 'Honestly, sounds like timing isn't right — want me to circle back closer to renewal?' RED → graceful out. A bad meeting hurts the pipeline more than no meeting." },
];

// ---------- meeting setup — official (the 15-minute meeting machine) ----------

export const MEETING_SETUP = {
  hollowYes: [
    "THE HOLLOW YES — tells: flat fast agreement ('yeah sure, whatever works') · no questions back · won't pin a specific time · takes the meeting but won't share basics (renewal date, current carrier).",
    "A little resistance is a GOOD sign. Don't fear the friction — fear the easy yes.",
  ],
  realYesSequence: [
    "1. Surface the pain — get them to SAY it out loud (rate hike, non-renewal, broker pressure). Don't move until you hear it.",
    "2. Connect value to that pain in one line: 'Since your rate jumped, the thing worth your time is seeing a number built on your clean record.'",
    "3. Micro-commitment: 'Does it make sense to see if we can beat that?'",
    "4. Then, and only then, ask for the time.",
  ],
  testBeforeBook:
    "Before locking the time: \"Before we put something on the calendar, what's the one thing you'd want to get out of it?\" If they can answer, the yes is real. If they fumble — rebuild value or disqualify. A booked ghost is worse than an honest no.",
  prepList: [
    "The moment they agree: \"Great. So I can actually get you a real number when we talk, have a few things handy:\"",
    "· Current declarations page (so I can match and beat what you've got)",
    "· Loss runs, last five years — the single thing that moves your price",
    "· Your MC or DOT number",
    "· Be at a computer, or have your phone ready to send photos/documents",
    "· If your spouse or partner handles the books, have them on too",
  ],
  agenda:
    "\"It's about 15 minutes. I'll ask a few questions about your operation, pull your DOT, and walk you through a real number. If it beats what you've got, we move on it. If not, no harm done and you've got a number for your file.\"",
  confirm:
    "\"Looking forward to [day] at [time]. So I can get you a real number on the spot, have your current dec page, loss runs, and MC/DOT handy, and be near a computer. Anything changes, just text me. — Corgi Insurance\"",
  lockIn: [
    "Before you hang up: confirm the best number + exactly who will be on.",
    "Send the confirmation right after the call + a nudge the day before.",
    "Make rescheduling easy: 'if something comes up, just text me, we'll move it.' A reschedule beats a ghost.",
  ],
};

// ---------- traps + self-audit (official) ----------

export const TRAPS = [
  { trap: "Happy ears", tell: "Buying signals that aren't there", fix: "Confirm with a real question: 'When exactly does it renew?'" },
  { trap: "Talking past the close", tell: "They said yes, you kept selling", fix: "Got the yes? Stop. Lock the next step, get off the phone." },
  { trap: "Feature-dumping", tell: "Listing coverages; they've gone quiet", fix: "Trade every fact for a question." },
  { trap: "Quoting blind", tell: "Guessing a number to seem helpful", fix: "Never. 'I won't bait you with a fake number. Send me the dec page.'" },
  { trap: "Arguing the objection", tell: "Defending instead of listening", fix: "Acknowledge first, then turn. You can't win the argument AND the sale." },
  { trap: "Vague next step", tell: "'I'll follow up' — no time, no task", fix: "Concrete step + date + what each side brings." },
  { trap: "Wrong person", tell: "Pitching dispatch or the office", fix: "'Who else weighs in on this?' Find the decision-maker early." },
  { trap: "Ignoring the clock", tell: "Forcing a 6-months-out prospect", fix: "Work the 30–60 day window. Log the date, circle back." },
  { trap: "Premature pitch", tell: "Presenting before you qualified", fix: "Qualify first — you can't sell value to a need you haven't found." },
];

export const RUN_THE_TAPE = [
  "Did THEY talk more than I did?",
  "Did I get the real, exact renewal date?",
  "Do they actually know WHY the next step matters?",
  "Did I lock a concrete next step with a time?",
  "Is that next step PREPPED — do they know what to bring?",
];

// ---------- voicemail (official) ----------

export const VOICEMAIL_SCRIPTS = [
  { name: "Fleet — official", text: "Hi {name}, Corgi Insurance, we only do trucking. Fleets are getting hit hard at renewal, and we can usually quote auto and cargo in about ten minutes. I pulled your DOT and think we can help. Quick callback at [number]." },
  { name: "Broker/agency", text: "Hi {name}, Corgi Insurance — trucking-only market. We've got real appetite for the accounts your other carriers are dropping. Fifteen minutes and I'll show you the appetite and the quote turnaround. [number]." },
];

// ---------- BROKER/AGENCY desk — official channel motion ----------

export const BROKER_SCRIPTS: Script[] = [
  {
    tag: "PARTNER",
    name: "Retail agent pitch (official)",
    when: "Independent commercial P&C agencies with trucking books — the appointment motion",
    opener:
      "Hi {name} — Corgi Insurance, we're a trucking-only market. Who are you placing your hard trucking accounts with right now?",
    then: "Listen for the pain market. Then the pitch: 'We've got real appetite for what others are dropping — fast quotes, we file MCS-90 and AI, and we never compete with you for the client. Worth 15 minutes?'",
    hook: "Most submissions quote INSTANTLY through our new rater; the rest get underwritten at 11am and 4pm Pacific daily. You keep the client and the renewal — we underwrite and pay claims. The better the risk profile you bring, the better the rate comes back. The 15-minute ask: appetite walkthrough + how to get appointed.",
    notes: [
      "What agents need from us: fast turnaround · real appetite for hard-to-place · reliable COI/AI issuance · a market that won't poach at renewal.",
      "Good partner: existing trucking book, clean complete submissions, understands appetite, repeat submitter.",
      "Appointment: short producer agreement + onboarding to submission process. Then start sending trucking risks.",
    ],
  },
  {
    tag: "PARTNER",
    name: "Freight brokerage pitch (official)",
    when: "3PLs / load boards — embed at carrier onboarding (compliance hook)",
    opener:
      "Hi {name} — Corgi Insurance. How do your carriers handle it when they can't clear your insurance requirements?",
    then: "Then: 'We quote and issue certificates fast, even new authorities. Embed us at onboarding and your carriers clear compliance faster.'",
    hook: "You reduce your own exposure and add value for your network. Per-trip cargo fits your spot-market carriers. No certificate, no load — that's stronger intent than any cold call.",
    notes: ["Economics per referral agreement.", "New/small carriers struggling to get insured = exactly our appetite."],
  },
];

export const AGENT_QA: Turn[] = [
  { name: "Will you go direct to my client?", hear: "(Official answer, verbatim)", turn: "No. We are a market, not a competitor. The client stays yours; we underwrite and pay claims.", ask: "Send us the trucking risks giving you trouble." },
  { name: "How fast is a quote?", hear: "(Official + floor update Jul 6)", turn: "Most submissions are instant through our automated rater. Anything needing a human gets underwritten at 11am and 4pm Pacific, every day. Send the dec page, loss runs, and schedule.", ask: "Got one on your desk right now?" },
  { name: "What won't you write?", hear: "(Official)", turn: "Limits above $1M, placarded hazmat, and the excluded cargo list as primary freight (pharma, tobacco, cannabis, blood/organs). Almost everything else in trucking is in appetite.", ask: "What's the hardest-to-place account in your book?" },
  { name: "How do I get appointed?", hear: "(Official)", turn: "A short producer agreement and onboarding to our submission process. Then start sending trucking risks.", ask: "Want me to send the agreement today?" },
  { name: "Are you backed by a state guaranty fund?", hear: "True that RRGs aren't — disclosed on every policy. This question is a BUYING SIGNAL, not an objection.", turn: "RRGs trade guaranty-fund participation for the ability to operate nationally and be owned by their insureds. We're held to statutory capital, surplus, and reporting standards by the Arizona regulator, file annual financials, and run a reinsurance program precisely so a single large loss never threatens the members.", ask: "Answer it straight, then return to value: stability, appetite, trucking-only claims." },
  { name: "What's your AM Best rating?", hear: "Not rated — don't dodge it.", turn: "We're a member-owned carrier regulated by Arizona DIFI with statutory capital and a reinsurance program behind every $1M limit. If a contract strictly requires A-rated paper, we're honestly not the fit for that account.", ask: "Do your contracts require a rating, or proof of coverage?" },
  { name: "Who actually carries the risk?", hear: "(For sophisticated agents only — never lead with this)", turn: "CarrierGuard Transportation RRG, Arizona-domiciled, nationwide under the federal LRRA. Corgi Insurance is the program brand and administrator; claims run through a dedicated trucking TPA. Reinsurance covers the layer above $100K per occurrence.", ask: "" },
  { name: "What commission?", hear: "(Set by producer agreement)", turn: "Typical commercial-trucking range — roughly 10 to 15% — spelled out in the producer agreement along with appetite and submission process.", ask: "" },
];

// ---------- coverage quick facts (official Coverage Manual) ----------

export const COVERAGE_QUICK = [
  "TWO LINES ONLY, both occurrence-form, both primary: Commercial Auto Liability (CAL) + Motor Truck Cargo (CLIP).",
  "AUTO limits: $250K / $500K / $750K / $1M CSL (each with $1M aggregate). Default $1M — what freight brokers require.",
  "AUTO defense costs PAID ON TOP of the limit — the single biggest coverage edge. Cheap competitor policies pay defense inside the limit.",
  "CARGO limits: $100K–$1M. Defense INSIDE the limit (opposite mechanic — explaining this clearly marks you as someone who knows the product).",
  "Retentions: auto $25K(+8%) / $50K(base) / $75K(−6%) / $100K(−12%) · cargo $1K(+10%) → $10K(−7%), base $5K.",
  "Endorsements: NTL +10% · HNOA (hired $95/$100K rev, min $3.5K) · Trailer Interchange (drayage standard) · Additional Insured (broker contracts) · TRIA +1%.",
  "Minimums: auto $5K single / $9K 2–5 units / $25K floor 6+ · cargo $2K single / $12K floor 6+ · per-trip $2.5K annual.",
  "Per-trip cargo: register EVERY trip BEFORE loading or no coverage. >$250K declared value needs UW pre-approval.",
  "MCS-90 filed by Corgi for interstate. Federal minimums: $750K general freight (since 1980) / $1M oil / $5M placarded hazmat (we don't write it).",
  "CARGO EXCLUDED: placarded hazmat, pharma/controlled substances, tobacco, cannabis/CBD/hemp, blood/organs. Kills the CARGO line only — auto usually still writable.",
  "NOT written: physical damage (own truck), workers comp, GL, warehouse storage, pollution, >$1M limits. Territory: US + Canada claims; Mexico = refer.",
  "Commodity classes: I general 1.00 · II reefer 1.15 · III high-value/theft 1.30 · IV bulk/ag 0.92 · V specialized 1.10.",
];

export const EDGE_ANSWERS: Array<[string, string]> = [
  ["I'm just one truck", "YES — owner-ops are core. Single-unit mins: $5K auto / $2K cargo. Add NTL if leased on."],
  ["I just got my authority", "YES — explicitly welcome. The segment most insurers decline."],
  ["Mixed fleet, different trucks", "YES — schedule each unit and class."],
  ["I run team drivers", "YES — it's about the unit and operation."],
  ["I lease my truck to a carrier", "LIKELY — owner-op under member authority; add NTL for off-dispatch."],
  ["About to add five trucks", "YES — schedule adjusts mid-term; flag growth up front."],
  ["I haul a little hazmat", "CAREFUL — non-placarded may be fine; placarded excluded. Don't promise — refer."],
  ["My trailer is borrowed", "ADD Trailer Interchange — non-owned trailer liability."],
  ["Cover my truck if I total it?", "NO — that's physical damage, separate policy we don't write."],
  ["My driver's injuries?", "NO — workers' comp, separate statutory coverage."],
  ["I store freight in my warehouse", "LIMITED — CLIP covers transit + temporary storage in ordinary course only."],
  ["Canada?", "YES — US/Canada in territory. Mexico needs specific handling."],
  ["Anything you're not sure of", "\"Good question. Let me get the exact details to underwriting and come back with a real answer — I'd rather be right than fast.\""],
];

// ---------- email templates ----------

export interface EmailTpl {
  key: string;
  label: string;
  audience: "fleet" | "broker" | "both";
  subject: string;
  body: string;
}

export const EMAIL_TEMPLATES: EmailTpl[] = [
  {
    key: "docs",
    label: "Post-call docs ask (official prep list)",
    audience: "fleet",
    subject: "Corgi Insurance — your number ({company})",
    body: "{name} — good talking. So I can get you a real number:\n\n• Current declarations page\n• Loss runs, last five years (the single thing that moves your price)\n• Your MC or DOT number\n\nSend those over and I'll have a quote back fast, usually same day. We're the carrier — trucking only.\n\nCorgi Insurance",
  },
  {
    key: "confirm",
    label: "Meeting confirmation (official)",
    audience: "both",
    subject: "Confirmed — [day] at [time]",
    body: "{name} — looking forward to [day] at [time]. It's about 15 minutes: a few questions about your operation, then a real number on the spot.\n\nHave handy: current dec page, loss runs, MC/DOT — and be near a computer.\n\nAnything changes, just text me.\n\nCorgi Insurance",
  },
  {
    key: "renewal",
    label: "Renewal timing",
    audience: "fleet",
    subject: "{company} — before you re-sign in {month}",
    body: "{name} — even clean fleets are seeing 7–15% jumps this year. Worth a carrier-direct number to compare before {month}? Dec page + DOT is all I need — quote back same day.\n\nCorgi Insurance (trucking only)",
  },
  {
    key: "partner",
    label: "Agency appointment (official pitch)",
    audience: "broker",
    subject: "Trucking-only market for {agency}",
    body: "{name} — Corgi Insurance is a trucking-only market with real appetite for the accounts your other carriers are dropping or slow-walking: new authorities, reefer, drayage, hotshot, rough records.\n\nFast quotes (minutes on a complete file), we file the MCS-90 and AI, and we never compete with you for the client.\n\nWorth 15 minutes? I'll walk you through appetite and the producer agreement.\n\nCorgi Insurance",
  },
  {
    key: "missed",
    label: "Missed you",
    audience: "both",
    subject: "Tried you — {company}",
    body: "{name} — left you a voicemail. Corgi is trucking-only: ~10-minute quotes on a complete file, MCS-90 and certificates same day, claims team that does nothing but trucking.\n\nTwo minutes when you're free?\n\nCorgi Insurance",
  },
];

// ---------- misc shared ----------

export const OUTCOMES_V2 = [
  { key: "A", code: "NA", label: "No answer" },
  { key: "G", code: "GK", label: "Gatekeeper" },
  { key: "D", code: "DM", label: "Decision-maker" },
  { key: "B", code: "BM", label: "Meeting booked" },
  { key: "I", code: "NI", label: "Not interested" },
  { key: "C", code: "CB", label: "Callback set" },
  { key: "V", code: "VM", label: "Voicemail" },
  { key: "N", code: "BN", label: "Bad #" },
  { key: "@", code: "EMAIL", label: "Emailed" },
  { key: "X", code: "DNC", label: "Do-not-call" },
] as const;

export const DAILY_RITUAL = [
  "Pre-dial homework (60s): DOT pulled (SAFER + L&I) · renewal noted · cargo screened for exclusions · ONE clear angle chosen.",
  "Best windows: early morning before dispatch · late afternoon once the day is set. Avoid mid-day — they're moving freight.",
  "70/30: the owner talks. Ask, then STOP. Most reps talk over the most valuable three seconds of the call.",
  "After every call, run the tape: Did they talk more? Real renewal date? Concrete prepped next step?",
  "Post-call: SEND the tailored note same day · LOG the exact renewal date + 45-day callback · HAND OFF complete file to UW.",
  "Booked? Prep them THE MOMENT they say yes: dec page, 5yr loss runs, MC/DOT, near a computer. Confirmation text right after + day-before nudge.",
];

export const LOSS_REASONS = ["price", "incumbent renewed", "coverage-fit gap", "went dark", "timing"];

export const MANUAL_REVIEW_FLAGS = [
  { id: "fleet10", label: "Fleet of more than 10 power units", check: "units > 10" },
  { id: "vin", label: "VIN(s) missing or could not be decoded", check: "manual" },
  { id: "violations", label: "6+ FMCSA roadside violations in past 24 months", check: "manual" },
  { id: "oos", label: "FMCSA vehicle out-of-service rate over 10%", check: "manual" },
  { id: "bipd", label: "For-hire carrier with NO BIPD insurance on file (FMCSA/L&I)", check: "insurer blank" },
  { id: "roster", label: "A VIN in FMCSA inspections not on the submitted roster", check: "manual" },
  { id: "fleetdelta", label: "Declared fleet size differs from FMCSA by >25%", check: "manual" },
  { id: "age20", label: "A power unit or trailer over 20 years old", check: "manual" },
  { id: "driverrisk", label: "A driver's combined risk loading ≥ +50%", check: "manual" },
  { id: "losses", label: "Highly adverse loss history", check: "manual" },
  { id: "partialruns", label: "Multiple prior carriers with partial loss-run coverage", check: "manual" },
];

// OFFICIAL submission requirements (Sales Playbook p.12)
export const SUBMISSION_PACKET = [
  "Signed application",
  "Current dec page",
  "Five years of loss runs (full history for newer authorities) — missing loss runs = #1 reason a quote stalls",
  "Fleet schedule: units / VINs / values",
  "MC / DOT number",
  "Description of operations: radius, commodities, lanes",
  "Safety profile: ELD, cameras, driver program",
  "Full $1M limit, schedule rating beyond ±25%, or unusual/high-severity exposure = SENIOR UW REFERRAL — set the expectation: referred quote, not instant",
];

export const PRICE_DRIVERS = [
  "Hazard class (what they haul) + average load value on cargo",
  "Operating radius (local 0.88 · regional base · OTR 1.15–1.20) + city congestion",
  "Fleet size (small-fleet factor 1.15 — scale erases it), 5-year loss record, driver experience, vehicle age",
  "Safety program, in-cab cameras, telematics — each pulls the rate DOWN (the good-news angle)",
  "Retention choice (higher SIR = lower premium)",
  "Multi-line: auto + cargo together earns a discount, one renewal, one contact",
];


// ---------- floor intel — live facts from the telegram KB (dated; KB updates daily 18:15) ----------

export const FLOOR_INTEL = [
  "Wire your team's floor intel here — UW cadence, live product notes, current decline flags.",
  "This list renders on the Today view; keep it short and current (see README).",
];
