/**
 * Curated quality test cases for de → en translation.
 *
 * Each case describes a German input and expected properties of the English
 * output. Two kinds of checks are expressed:
 *
 * - `expects`: regular expressions (case-insensitive) that MUST all match the
 *   translated text. These are content-level assertions (keywords, structure).
 * - `critical`: optional critical-failure constraints. When present the harness
 *   additionally verifies that the model did not flip a negation, drop/alter
 *   numbers, omit content, or return an empty/reversed string.
 *
 * The suite is intentionally reference-free (no BLEU/chrF). It focuses on
 * catching regressions in the categories listed in ROADMAP Step 8.
 */

type QualityCategory =
  | "chat"
  | "ui"
  | "technical"
  | "numbers"
  | "negations"
  | "typos"
  | "colloquial"
  | "idioms"
  | "longSentence"
  | "liveIncomplete";

interface QualityCase {
  /** Stable id used in test names and reports. */
  id: string;
  category: QualityCategory;
  /** German source text. */
  input: string;
  /**
   * Regular expressions (matched case-insensitively) that MUST all appear in
   * the English output. Keep them loose: prefer keywords over exact phrases
   * because OPUS-MT output varies slightly across builds.
   */
  expects: RegExp[];
  /** Optional critical-failure constraints. */
  critical?: {
    /**
     * When true, the source contains a German negation marker
     * ("nicht" | "kein" | "niemand" | "nie" | "nichts" | "ohne" | "keine")
     * and the output must retain a negation token.
     */
    preserveNegation?: boolean;
    /**
     * Number literals from the source that must all appear in the output.
     * Use string forms (e.g. ["3", "2024"]) to avoid locale formatting drift.
     */
    preserveNumbers?: string[];
    /** Minimum character length of the output. Defaults to input length / 2. */
    minLength?: number;
  };
}

// German negation markers used by the critical-failure detector.
const NEGATION_MARKERS_DE = [
  "nicht",
  "kein",
  "keine",
  "keinen",
  "keiner",
  "keines",
  "niemand",
  "niemanden",
  "nie",
  "nichts",
  "ohne",
] as const;

// English negation tokens expected when the source is negated.
const NEGATION_TOKENS_EN = [
  "not",
  "no ",
  "none",
  "nobody",
  "never",
  "nothing",
  "without",
  "don't",
  "doesn't",
  "isn't",
  "wasn't",
  "aren't",
  "won't",
  "can't",
  "cannot",
  "no-one",
] as const;

/**
 * Returns true when the German source contains a known negation marker.
 * Used by the harness to decide whether the output should contain a negation.
 */
export function hasGermanNegation(source: string): boolean {
  const lower = source.toLowerCase();
  return NEGATION_MARKERS_DE.some((marker) => {
    // Word-boundary-ish check: marker surrounded by non-letter or string edge.
    const re = new RegExp(`(^|[^a-zäöüß])${marker}([^a-zäöüß]|$)`, "i");
    return re.test(lower);
  });
}

/**
 * Returns true when the English output retains a negation token.
 * Used by the harness to detect flipped/lost negations.
 */
export function hasEnglishNegation(output: string): boolean {
  const lower = ` ${output.toLowerCase()} `;
  return NEGATION_TOKENS_EN.some((token) => lower.includes(token));
}

export const qualityCases: QualityCase[] = [
  // --- chat ---------------------------------------------------------------
  {
    id: "chat-01",
    category: "chat",
    input: "Hallo, wie geht es dir heute?",
    expects: [/hello/, /how/, /(today|going|are)/],
  },
  {
    id: "chat-02",
    category: "chat",
    input: "Danke für deine Hilfe, ich melde mich später.",
    expects: [/thank/, /(help|assist)/, /(later|reach|contact)/],
  },
  {
    id: "chat-03",
    category: "chat",
    input: "Können wir uns morgen um drei Uhr treffen?",
    expects: [/meet|see/, /tomorrow/, /three|3/],
  },

  // --- ui -----------------------------------------------------------------
  {
    id: "ui-01",
    category: "ui",
    input: "Einstellungen öffnen",
    expects: [/settings|preferences/, /open/],
  },
  {
    id: "ui-02",
    category: "ui",
    input: "Bitte bestätigen Sie Ihre Eingabe.",
    expects: [/confirm|verify|approve/, /input|entry/],
  },
  {
    id: "ui-03",
    category: "ui",
    input: "Abbrechen und zurück zur Startseite.",
    expects: [/cancel/, /back|home|start/],
  },

  // --- technical ----------------------------------------------------------
  {
    id: "tech-01",
    category: "technical",
    input: "Die Variable wird vor der ersten Verwendung initialisiert.",
    expects: [/variable/, /init/, /(before|prior)/],
  },
  {
    id: "tech-02",
    category: "technical",
    input: "Der Cache wird bei jedem Speichervorgang aktualisiert.",
    expects: [/cache/, /update|refresh/],
  },
  {
    id: "tech-03",
    category: "technical",
    input: "Ein Syntaxfehler verhindert die Ausführung des Skripts.",
    expects: [/syntax|error/, /(prevent|block|stop)/, /script/],
  },

  // --- numbers ------------------------------------------------------------
  {
    id: "num-01",
    category: "numbers",
    input: "Der Vertrag läuft über 24 Monate und kostet 1500 Euro pro Monat.",
    expects: [/24/, /1500/, /euro|month/],
    critical: { preserveNumbers: ["24", "1500"] },
  },
  {
    id: "num-02",
    category: "numbers",
    input: "Es wurden 42 Fehler in 3 Modulen gefunden.",
    expects: [/42/, /3/, /(error|bug|fault)/],
    critical: { preserveNumbers: ["42", "3"] },
  },
  {
    id: "num-03",
    category: "numbers",
    input: "Die Temperatur beträgt minus 10 Grad Celsius.",
    expects: [/10/, /degree|celsius|-10|minus/],
    critical: { preserveNumbers: ["10"] },
  },

  // --- negations ----------------------------------------------------------
  {
    id: "neg-01",
    category: "negations",
    input: "Ich kenne den Weg nicht.",
    expects: [/i|way|know/, /not|don't|n't/],
    critical: { preserveNegation: true },
  },
  {
    id: "neg-02",
    category: "negations",
    input: "Die Datei ist nicht leer und enthält keine Fehler.",
    expects: [/file/, /(not|empty|error)/],
    critical: { preserveNegation: true },
  },
  {
    id: "neg-03",
    category: "negations",
    input: "Ohne gültiges Zertifikat ist kein Zugriff möglich.",
    expects: [/certificate|valid/, /access|without|not/],
    critical: { preserveNegation: true },
  },

  // --- typos --------------------------------------------------------------
  {
    id: "typo-01",
    category: "typos",
    input: "Das ist ein Tset mit geknicktem Wrod.",
    expects: [/test|word|broken|typo|tset|wrod/],
  },
  {
    id: "typo-02",
    category: "typos",
    input: "Bitte immmer wiederr melden.",
    expects: [/please|always|again|report|contact|melden/],
  },

  // --- colloquial ---------------------------------------------------------
  {
    id: "coll-01",
    category: "colloquial",
    input: "Na, alles klar bei dir?",
    expects: [/all|clear|ok|fine|you/],
  },
  {
    id: "coll-02",
    category: "colloquial",
    input: "Mach's gut, bis dann.",
    expects: [/take|care|goodbye|see|then|until|bis/],
  },
  {
    id: "coll-03",
    category: "colloquial",
    input: "Kein Ding, kein Problem.",
    expects: [/no|problem|thing|worry|issue/],
    critical: { preserveNegation: true },
  },

  // --- idioms -------------------------------------------------------------
  {
    id: "idiom-01",
    category: "idioms",
    input: "Das ist ein Fass ohne Boden.",
    expects: [/bottomless|barrel|endless|fass|boden|without/],
  },
  {
    id: "idiom-02",
    category: "idioms",
    input: "Er hat den Bogen raus.",
    expects: [/hang|knack|figure|got|bow|bogen|raus|learn|master/],
  },
  {
    id: "idiom-03",
    category: "idioms",
    input: "Da liegt der Hase im Pfeffer.",
    expects: [/catch|problem|issue|rabbit|hase|pepper|pfeffer|trouble/],
  },

  // --- long sentence ------------------------------------------------------
  {
    id: "long-01",
    category: "longSentence",
    input:
      "Obwohl die Entwicklung neuer Übersetzungsmodelle in den letzten Jahren erhebliche Fortschritte gemacht hat, bleibt die Übersetzung umgangssprachlicher Ausdrücke eine besondere Herausforderung, die sowohl kontextuelles Wissen als auch kulturelle Feinfühligkeit erfordert.",
    expects: [/translation|model|develop|progress|challenge|colloquial|context|cultural/],
    critical: { minLength: 40 },
  },
  {
    id: "long-02",
    category: "longSentence",
    input:
      "Die Implementierung eines effizienten Caching-Mechanismus, der sowohl große Modelldateien als auch kleine Konfigurationsdateien zuverlässig speichert und bei unterbrochenen Downloads eine nahtlose Wiederaufnahme ermöglicht, ist entscheidend für eine gute Nutzererfahrung.",
    expects: [/cache|model|config|download|resume|experience|implement/],
    critical: { minLength: 40 },
  },

  // --- incomplete live input ----------------------------------------------
  {
    id: "live-01",
    category: "liveIncomplete",
    input: "Hallo wie",
    expects: [/hello|how|wie/],
  },
  {
    id: "live-02",
    category: "liveIncomplete",
    input: "Ich möchte das",
    expects: [/i|want|would|like|das/],
  },
  {
    id: "live-03",
    category: "liveIncomplete",
    input: "Wann kommst du",
    expects: [/when|come|arrive|du/],
  },
];