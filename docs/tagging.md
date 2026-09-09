# Topic tagging — what the deck can and cannot support

§5a makes topic filtering a first-class feature: filter a session by topic, a
topic picker behind "Drill a topic", per-topic progress on the Stats screen.
§8 says Kaishi ships without tags and proposes an LLM pass to add them.

Kaishi ships without tags — verified, **0 of 1,501 notes**. But the deeper
problem is not that the tags are missing. It is that **most of this deck has no
topic to be tagged with.**

## What was measured

Rules over the English glosses plus a hand-checked override file, run against
the current release:

| | |
|---|---|
| Cards | 1,500 |
| Carrying at least one topic | **191 (12.7%)** |
| Decided by hand in the override file | 18 |

| Topic | Cards |
|---|---|
| health | 52 |
| time | 43 |
| family | 27 |
| small talk | 22 |
| food | 18 |
| school | 12 |
| money | 9 |
| travel | 6 |
| konbini | 3 |

## Why it is only an eighth of the deck

Kaishi 1.5k is a **frequency deck**. Its first hundred entries are する, なる,
ある, いる, 思う, 言う, 私, これ, その, もう, ちょっと, そして. Further in it is
すっかり, 示す, ますます, わざわざ, それぞれ, 潰す.

None of those belong to school, konbini, food, travel, small talk, family,
health, money or time — not because the tagger is weak, but because they have
no topic. They are the grammatical and general core of the language.

The topics that *do* fill up are the ones with concrete vocabulary: body parts
and ailments, temporal words, kinship terms. The topics the designs lean on
hardest — konbini above all — are nearly empty, because a frequency deck has
little reason to teach 店員 or レシート early.

## Is there an ontology we could use instead?

Yes, several, and they would help — but less than one would hope, and not with
the real problem.

**What exists and is relevant:**

- **JMdict/EDICT** carries curated *field* tags (`med`, `food`, `finc`, `bus`).
  High precision, but it tags specialist terminology. Everyday words like 腕 or
  買う carry no field tag at all, so the yield on a beginner frequency deck is
  small.
- **Japanese WordNet** (NICT), linked to Princeton WordNet synsets, gives real
  hypernym chains: 腕 → limb → body part, 町 → municipality → region. This is
  the right tool for the *semantic* topics.
- **分類語彙表 (Bunrui Goihyo)**, the NINJAL thesaurus, is a proper semantic
  hierarchy for Japanese and would serve the same purpose.

**What an ontology would actually buy us here.** Comparing the rules against the
untagged remainder by hand, the words a hypernym walk would newly catch are:
声, 涙, 汗, 眠る (body and physiology), 町, 国, 海, 山, 村, 川 (geography),
友達, 結婚, 大人 (social and kinship). Perhaps another 150–200 cards. That
would take coverage from ~13% to roughly 25%.

**What it would not buy us.** No ontology assigns a topic to する, なる, これ,
さん, 強い, ちょっと or それぞれ, because they do not have one. The shape of the
answer does not change: most of a frequency deck is topicless, and a semantic
hierarchy cannot invent a topic where none exists.

**Two of the nine topics are not semantic categories at all.** "Small talk" is
pragmatics — the same word is small talk or not depending on how it is used.
"Konbini" is a *situation*, not a class of meaning; no thesaurus has a node for
it. Both stay hand-curated whatever else changes.

**Practical note.** `edrdg.org` and the Japanese WordNet download host are both
unreachable from the sandbox this was built in, so the ontology path could not
be tried against real data here. It is reachable from an ordinary workstation,
which is where imports run. It is a worthwhile improvement, not a rewrite: the
override file is exactly where an ontology's output would land.

## What this means for the designs

The designs assume topics partition the deck. Stats shows five topics with bars
like "school 84 / 120"; the topic picker offers "22 / 80 travel". Against the
real deck those numbers are an order of magnitude smaller and lopsided — 3
konbini cards, 52 health cards, and 1,309 cards in no topic at all.

Recorded in `design/next-brief.md`. The screens need to say honestly that
topics cover a minority of the deck rather than implying full coverage, and
"Drill a topic" has to behave sensibly when a topic holds three cards.

## Where topics will actually pay off

§8's second deck. Personal cards — the words she meets at school, in the
konbini, with her host family — are topical by construction, because she
collects them in a situation. That is the vocabulary §5a's filters were really
designed for, and it is where konbini stops being three cards.

The Kaishi tagging is worth having anyway: "drill the 52 body and health words"
is a genuine session, and so is "the 43 time words".

## Improving it

Both halves are plain files reviewed as diffs.

- `import/lib/tagging.js` — the rules. Patterns, not judgement.
- `import/tags-overrides.tsv` — judgement. `word<TAB>tags`, an empty tag list
  cancels a wrong rule match, `#` comments explain why.

```sh
npm run tag -- --dry-run --report   # coverage, per-topic counts, samples
npm run tag                         # rebuild the tags table
```

Tags are rebuilt from scratch on every run, so removing a line removes its tag.

**Spot-checking found real errors and will again.** Roughly one health match in
five was wrong before correction: 勇気 "courage, nerve" matched *nerve*, 武器
"weapon, arms" matched *arms*, 渡す "to hand over" matched *hand*. Fourteen such
cases are cancelled in the override file. Any new rule keyword should be
followed by a look at what it caught.
