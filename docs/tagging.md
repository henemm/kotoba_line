# Topic tagging — what the deck can and cannot support

> **This document reached the wrong conclusion, and the rest of it is kept for
> the record.** It argued that most of Kaishi has no topic. It does not. What
> it had no topic in was *the nine topics being measured*, which are situations
> — konbini, school, travel, small talk — and a frequency deck maps badly onto
> situations. Measured against semantic fields instead, coverage went from
> **12.7% to 100%**.
>
> The correction, the two-axis vocabulary and the pass over the whole deck are
> in `import/lib/tagging.js` and `import/tags-llm.tsv`; the reasoning is in
> issue #24. Everything below stands as it was written, including the
> WordNet measurement, which is still sound and still the reason an ontology
> is not the instrument here.
>
> The lesson worth keeping: a low number was read as a fact about the data
> when it was a fact about the question. The giveaway was there to be seen —
> `health` had 52 cards and `konbini` had 3, and 眠る "to sleep" had been filed
> under health because there was nowhere else to put it.

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

**What it would not buy us** — written before the measurement below, and too
optimistic. No ontology assigns a topic to する, なる, これ,
さん, 強い, ちょっと or それぞれ, because they do not have one. The shape of the
answer does not change: most of a frequency deck is topicless, and a semantic
hierarchy cannot invent a topic where none exists.

**Two of the nine topics are not semantic categories at all.** "Small talk" is
pragmatics — the same word is small talk or not depending on how it is used.
"Konbini" is a *situation*, not a class of meaning; no thesaurus has a node for
it. Both stay hand-curated whatever else changes.

### It was tried, against the real deck, and it does not work

The product owner asked the better question: the glosses are English and the
tagger already runs over them, so why reach for a *Japanese* ontology at all?
Princeton WordNet is the direct fit, and — unlike `edrdg.org`, still blocked — it
installs from npm (`wordnet-db`). The earlier note here, that the ontology path
could not be tried in this sandbox, was wrong.

So it was tried: look each gloss up, walk the hypernyms, and tag when the chain
passes through an anchor synset (`body_part`, `relative`, `educational_institution`,
`medium_of_exchange`, …). Part of speech taken from the gloss itself, so "to go"
is only ever looked up as a verb. First sense only.

| | Cards tagged |
|---|---|
| Rules and overrides today | 191 (12.7%) |
| WordNet | 269 (17.9%) |
| Both together | 342 (22.8%) |

Coverage roughly as predicted. **Precision is the problem: of forty-five tags
sampled from those WordNet added, four were right.** Around 10%.

The failures are not noise, they are structural, and both would survive any
amount of tuning:

**A gloss is a translation, not a sense.** "to return" glosses both 帰る (go
home) and 返す (give something back); "back" glosses 後ろ (behind), 背中 (the
body part) and ただいま ("I'm back"). WordNet is asked which sense is meant and
has nothing to answer with. It reproduced the exact false positive this file
already records from the rule-based tagger: 勇気 "courage, nerve" → *nerve* →
body part → health.

**WordNet's own nodes do not mean what our topics mean.** Its `travel` synset is
the root of the entire locomotion hierarchy — "travel, go, move, locomote" — so
every motion verb in the deck lands under travel: 流れる (to flow), 漂う (to
drift), 追う (to chase), 落ちる (to fall). Likewise `study` swallows 比べる (to
compare) and 見上げる (to look up), and *course* in "of course" arrives as
education.

What the ontology cannot see is the one thing the deck does have: **the example
sentence.** Disambiguating a sense from word + gloss + sentence is what §8
proposed in the first place — an LLM pass, run once at import, its output landing
in `tags-overrides.tsv` where it is reviewed as a diff like everything else. A
hierarchy is the wrong instrument for a job that is entirely about context.

The experiment is not in the repository; it proved a negative and its value is
this section. Roughly 150 lines against `wordnet-db@3.1.14`.


## Where the audio comes from

Not synthesised. Kaishi ships native recordings and the import writes them all:

| | |
|---|---|
| Cards with word audio | 1,499 of 1,500 |
| Cards with sentence audio | 1,500 of 1,500 |

254 of the word files are named `私_ワタシ━_0_NHK-2016.mp3` — NHK's 2016
pronunciation dictionary, with the reading and the pitch-accent number in the
filename. 144 sentence files are named `JLPT_Tango_N5_0001.mp3`. **The rest are
content-hashed**, so their source cannot be read off the file; they are whatever
the deck's maintainers assembled.

That 17% is worth knowing for a different reason: the accent number in those
filenames is *not* a shortcut to the pitch-accent feature. It covers 254 cards.
The deck's own Pitch Accent field covers 1,500 — see `design/README.md`.

Speech synthesis is the fallback, not the plan: one card without audio, the
whole personal deck, and any preview that does not ship the deck.

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
