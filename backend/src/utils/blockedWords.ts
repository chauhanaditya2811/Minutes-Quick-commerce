// Words that can't appear in public product requests. Written the way people type them in
// English letters: lowercase, letters only. Add new ones here as you spot them (for example
// after hiding or deleting a request); every spelling trick is handled by profanity.ts.
//
// Kept deliberately to unambiguous abuse: words that are also real products or everyday
// words (maggi, gud, poori, patti, chakka, condom, …) are left out on purpose.

/** Blocked when they appear as a whole word, e.g. "bc" or "kutta". */
export const BLOCKED_WORDS = [
  // English
  "anal", "arse", "arsehole", "ass", "asshole", "bastard", "bitch", "bitches", "blowjob", "bollocks",
  "boner", "boob", "boobs", "bullshit", "butthole", "cock", "cocks", "cum", "cumshot", "cunt", "dick",
  "dickhead", "dildo", "douche", "dumbass", "fag", "faggot", "fuck", "handjob", "horny", "jackass",
  "jerkoff", "milf", "nigga", "nigger", "nude", "nudes", "orgasm", "penis", "piss", "porn", "prick",
  "pussy", "rape", "rapist", "retard", "sex", "sexy", "shit", "shithead", "shitty", "slut", "stfu",
  "tits", "titty", "twat", "vagina", "wank", "wanker", "whore", "wtf",
  // Hindi / Hinglish / Haryanvi
  "bc", "mc", "bkl", "bkc", "mkc", "tmkc", "bsdk", "behenchod", "bhenchod", "bhencho", "benchod",
  "bhosda", "bhosdi", "bhosdike", "bhosadike", "bhosdiwale", "bhosri", "chod", "chodu", "chudai",
  "chut", "choot", "chutia", "chutiya", "chutiye", "chootiya", "gaand", "gand", "gandu", "gaandu",
  "harami", "haramkhor", "haramzada", "haramzade", "haramzaade", "jhaat", "jhant", "jhatu", "kamina",
  "kamine", "kutta", "kutte", "kutti", "kuttiya", "lauda", "laude", "lavda", "lavde", "lawda", "loda",
  "lode", "lodu", "lund", "madarchod", "maderchod", "madharchod", "maadarchod", "raand", "randi",
  "randwa", "randibaaz", "saala", "saali", "tatti",
  // Punjabi
  "fuddi", "kanjar", "kanjri", "lun", "pencho", "penchod", "phuddi",
  // Marathi
  "aaighalya", "bhadva", "bhadve", "bhadvya", "bhadwa", "lavdya", "zavadya", "zhavadya", "zavnya",
  // Bengali
  "banchod", "bokachod", "bokachoda", "khanki", "khankir", "maagi",
  // Gujarati
  "bhadvo", "bhosdina", "bhosrina", "randina",
  // Tamil
  "koothi", "ommala", "oombu", "otha", "oththa", "punda", "pundai", "sunni", "thayoli", "thevdiya",
  "thevidiya", "thevudiya",
  // Telugu
  "denga", "dengey", "dengu", "kojja", "lanja", "lanjakodaka", "lanjakoduka", "modda", "puku", "sulli",
  // Kannada
  "bolimaga", "bolimagane", "ninnamman", "soole", "sulemagane", "tullu", "tunne",
  // Malayalam
  "kunna", "mairu", "myran", "myre", "myru", "pooru", "thendi",
];

/** Blocked at the start of a word, so endings can't slip past ("fucking", "bitchy"). */
export const BLOCKED_PREFIXES = ["fuck", "motherfuck", "cunt", "bitch", "nigg", "whore", "slut", "wank", "porn"];

/**
 * Blocked anywhere, even run together with other letters ("xxmadarchodxx", "terimaaki").
 * Only long, unmistakable words and phrases belong here, never anything that can sit inside
 * a real product name.
 */
export const BLOCKED_ANYWHERE = [
  "fuck", "motherfuck", "nigger", "madarchod", "maderchod", "madharchod", "behenchod", "bhenchod",
  "benchod", "bhosdike", "bhosadike", "bhosdiwale", "chutiya", "chutiye", "gaandu", "randibaaz",
  "terimaaki", "terimaaka", "terimaki", "maakichut", "teribehen", "teribhen", "bokachoda", "khankir",
  "thevidiya", "lanjakoduka", "bolimagane", "sulemagane",
];
