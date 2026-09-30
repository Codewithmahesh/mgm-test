// Spots text that looks like random typing ("rgjbbrebh", "asdfgh", "hehehehe") so the form can ask
// "are you sure?". It only warns: technical terms, acronyms and names can look odd, so the person can
// always continue. Used in the browser; no server dependencies.

const VOWELS = /[aeiouy]/
// Consonant pairs that are common in English (and in Indian names typed in English: bh, dh, kh…).
const COMMON_PAIRS = new Set((
  'bb bh bj bl br bs by cc ch ck cl cr cs ct cy dd dg dh dj dl dm dn dr ds dw dy ff fl fr fs ft gg gh gl gm gn gr gs ' +
  'hl hm hn hr hs ht hw jh kh kk kl km kn kr ks kw ll lb lc ld lf lg lk lm ln lp lr ls lt lv lw ly mb mm mn mp ms mt my ' +
  'nc nd ng nk nl nm nn ns nt nv nw nx ny nz pf ph pl pm pn pp pr ps pt py rb rc rd rf rg rh rk rl rm rn rp rr rs rt rv rw ' +
  'sc sh sk sl sm sn sp sq ss st sw sy th tl tm tn tr ts tt tw ty vv wd wk wl wn wr ws xc xp xt zz'
).split(' '))
// Terms and acronyms often typed in lower case that would otherwise look like gibberish.
const KNOWN = new Set((
  'dbms rdbms sql nosql html css http https tcp udp ftp smtp dns dhcp bfs dfs cpp jsx tsx npm mvc crud nlp cnn rnn ' +
  'lstm gpt dsp vlsi plc pcb cmos ttl fsm pld fpga xml json yaml ssh ssl tls cpu gpu ram rom bst avl lru lifo fifo ' +
  'dfa nfa cfg jvm jdk jre sdk ide oops ooad dsa daa toc cn os ml dl ai iot mcq pdf csv png jpg svg ' +
  'strcmp strncmp strcpy strncpy strcat strlen memcpy memset fscanf fprintf sprintf fgets fputs getch getchar putchar ' +
  'rhythm rhythms nymph lynx myth myths crypt glyph gypsy tryst pygmy synth sync'
).split(' '))
const KEYBOARD = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm', '1234567890']

/** Whether a single word looks like random typing. */
function oddWord(raw: string): boolean {
  const word = raw.toLowerCase()
  if (word.length < 4 || KNOWN.has(word)) return false
  // ALL-CAPS words are usually acronyms (DBMS, RAID, TCP).
  if (raw.length <= 6 && raw === raw.toUpperCase()) return false
  // Internal capitals mean a product or code name (NextJS, MongoDB, getElementById).
  if (/[a-z][A-Z]/.test(raw)) return false
  if (!VOWELS.test(word)) return true
  if (/(.)\1\1/.test(word)) return true // aaa, lll
  if (/(.{2,3})\1\1/.test(word)) return true // hehehe, lalala
  for (const row of KEYBOARD) for (let i = 0; i + 4 <= row.length; i++) {
    const run = row.slice(i, i + 4)
    if (word.includes(run) || word.includes([...run].reverse().join(''))) return true
  }
  if (/[^aeiouy]{6,}/.test(word)) return true
  if (word.length >= 5) {
    let odd = 0
    for (let i = 0; i + 1 < word.length; i++) {
      const pair = word.slice(i, i + 2)
      if (!VOWELS.test(pair) && !COMMON_PAIRS.has(pair)) odd++
    }
    if (odd / (word.length - 1) >= 0.35) return true
  }
  return false
}

/**
 * The words in `text` that look like random typing, if there are enough of them to call the whole text
 * meaningless; otherwise []. Short text needs half its words to look random, longer text a third.
 */
export function gibberishWords(text: string): string[] {
  const value = text.trim()
  if (!value) return []
  // Mostly symbols and digits (e.g. text copied out of a scanned PDF).
  const letters = (value.match(/\p{L}/gu) ?? []).length
  if (value.length >= 20 && letters / value.replace(/\s/g, '').length < 0.4) return [value.slice(0, 30)]
  // Only Latin-script words are judged; other scripts (Marathi, Hindi) are left alone.
  const words = value.match(/[A-Za-z]{2,}/g) ?? []
  const judged = words.filter(w => w.length >= 4)
  if (!judged.length) return []
  const odd = judged.filter(oddWord)
  const share = odd.length / judged.length
  return share >= (judged.length >= 12 ? 0.34 : 0.5) ? [...new Set(odd)].slice(0, 4) : []
}
