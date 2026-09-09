# Open decisions and questions

_Started 2026-09-09 14:06 UTC_

---

## User

<system-info comment="Only acknowledge these if relevant">
Project title is now "# Claude Design — brief: ことばライン, the screens around the practice loop??## What t"
What `list_files` on the project root returns right now (dotfiles, if any, are not shown here):
📁 uploads
Current date is now September 9, 2026
</system-info>

<default aesthetic_system_instructions>
The user has not attached a design system. If they have ALSO not attached references or art direction, and the project is empty (the auto-managed _ds/ folder doesn't count), ask your opening questions with the ask_user tool. Whenever you ask opening questions in this project, include a design-system question in the form: the user's pick there sets the visual direction, so do NOT also ask about the visual aesthetic (no questions about vibe, colors or palette directions (including color-swatch svg-options questions), typography, mood, or art direction). Spend your other questions on everything else: audience, purpose, content, structure, scope, interactions, tone of copy. Exception: if the request already states the visual direction as a brand or concrete art direction, leave the design-system question out of your own questions (the app may still add one — it's skippable, and a skip doesn't change the stated direction) — but if they name a design system that isn't attached, keep the question: their pick there is what attaches it.

If the design-system question comes back unanswered — skipped without a pick (a "Not sure" / decide-for-me answer counts as a pick: it applies the effective default) — and no references or other art direction arrived either, THEN ask the visual-aesthetic questions before designing: a follow-up round (or one focused question) about vibe, colors, type, and mood is the right move once the design-system ask went unanswered. Do NOT just pick your own. Once you have a direction, use this guidance when creating designs:
- Choose a type pairing from web-safe set or Google Fonts. Helvetica is a good choice. Avoid hard-to-read or overly stylized fonts. Use 1-3 fonts only.
- Foreground and background: choose a color tone (warm, cool, neutral, something in-between). Use subtly-toned whites and blacks; avoid saturations above 0.02 for whites.
- Accents: choose 0-2 additional accent colors using oklch. All accents should share same chroma and lightness; vary hue.
- NEVER write out an SVG yourself that's more complicated than a square, circle, diamond, etc.
- For imagery, never hand-draw SVGs; use subtly-striped SVG placeholders instead with monospace explainers for what should be dropped there (e.g. “product shot”)

CRITICAL: ignore default aesthetic entirely if given other aesthetic instructions like reference images, design systems or guidance, or if there are user-authored files in the project already (the auto-managed _ds/ folder is not user-authored).
</default aesthetic_system_instructions>

<attached_files>
- uploads/files (1)/kotoba-line-spec.md
- uploads/files (1)/claude-code-brief.md
- uploads/files (1)/kotoba-line.html
</attached_files>

<pasted_text name="Pasted text (136 lines)">
# Claude Design — brief: ことばライン, the screens around the practice loop

## What this is

A Japanese vocabulary PWA for a German exchange student living in Tokyo and a
few of her friends. She practises on trains and between classes, on an iPhone
and an iPad, in English.

The practice loop already exists and is not up for redesign: four modes —
pick the meaning, listen only, say it aloud, flip the card — presented as four
Tokyo metro lines, one colour each, with cards as stations along a route and
the progress bar at the top drawn as a strip of station markers.

**Design the screens around that loop.** They have never been designed and
would otherwise be improvised by whoever writes the code.

## The design system is fixed

Do not propose a new direction. Extend this one.

```
--night       #141824    page background
--night-deep  #0D1017    recessed areas
--surface     #1E2433    cards, inactive controls
--surface-hi  #2A3244    raised controls, rails
--ink         #F2F4F8    primary text
--ink-muted   #8A93A8    secondary text

line-choose   #F15A22    pick the meaning
line-listen   #00A7DB    listen only
line-speak    #C7008B    say it aloud
line-flip     #80C241    flip the card

yes           #3DDC84
no            #FF4B4B
```

Type: system sans for the interface, set with a wide weight range — 800 for
display numerals and Japanese headings, 600 for controls, 400 for prose.
Japanese text uses Hiragino Sans / Noto Sans JP and is always noticeably
larger than the Latin text beside it.

Motion is reserved. One orchestrated moment per screen at most, and only
where something actually changed.

**No emoji anywhere.** The visual language is transit signage: colour-coded
lines, dots, rules, plain numerals.

Target width 390px. Everything reachable one-handed, primary actions in the
lower third.

## Screens to design

### 1. Sign in

Two fields, name and a six-digit PIN, on a device she owns and never shares.
Accounts are created by her father on the command line, so there is no
sign-up link, no password reset, no "forgot PIN".

Make the empty state feel like the start of a line rather than a form. Show
what the app is in one line without marketing language.

Include: the error state for a wrong PIN, and the state after too many
attempts (the server rate-limits to five per minute).

### 2. Stats

The screen she opens when she wants to see that the work added up. It carries
more numbers than any other screen, so hierarchy is the whole job.

Must show:

- Total XP, current level, and progress toward the next level
- Current streak in days, longest streak
- **Joker balance** — she earns one joker every five consecutive days, holds
  at most three, and a missed day spends one automatically to keep the streak
  alive. Three slots, filled or empty. This needs to be legible at a glance
  and understandable without explanation.
- Cards seen, and how they distribute across maturity: new, learning, young,
  mature
- Progress per topic tag (school, konbini, food, travel, small talk)

The maturity distribution and the tag progress both want to be visual rather
than tabular. The metro map is an obvious well to draw from — but only if it
genuinely clarifies. A chart that has to be decoded is worse than a list.

### 3. Level up

A moment, not a screen. It appears at the end of a session in which she
crossed a threshold, and it lasts a few seconds.

Restrained. The reward is the number changing, not confetti. Show the new
level, what it took, and get out of the way.

### 4. Joker spent

Shown at the start of the first session after a missed day: her streak is
intact, and it cost her one joker.

The tone matters more than the layout. This is not a scolding and not a
celebration. It states what happened, shows the remaining balance, and lets
her carry on. She should leave it knowing she has two left and how to earn
another.

### 5. Nothing due

She has finished her reviews for the day and comes back anyway.

This is not an error and should not read as one. Offer what is actually
useful: practise ahead, drill a specific tag, or review what she got wrong
recently. Show when the next cards come due.

### 6. Add to home screen

iOS has no install prompt, so this must be taught once. Shown only in Safari,
only when the app is not already running standalone, and dismissible for good.

It has to point at the share button in the browser chrome, which sits outside
the design's control — so the layout has to work with an arrow or a pointer
toward the bottom edge of the screen.

### 7. App icon

192, 512, maskable 512, and a 180 for iOS. The icon lives next to Instagram
and LINE on her home screen and has to hold up at that size. The line-network
motif is the obvious source; resist detail that disappears below 60px.

## What I need back

Static screens I can hand to a developer, with the states named. Where a
screen has variants — error, empty, first-run — show them side by side rather
than describing them.

Annotate anything where the layout depends on data that could be much larger
or much smaller than the example: a streak of 3 and a streak of 340, an empty
tag list and one with twelve entries.
</pasted_text>

<!-- The user explicitly selected the following skills for this project, as attachments to their message. These are not optional context — they define how you work. Use them. -->
<attached-skill name="Design Components">
This project uses Design Components: every design is a single streaming `Name.dc.html` file. The full authoring spec is in your system prompt under "Writing code — Design Components" — follow it. Author and edit `.dc.html` content with the `dc_write`, `dc_html_str_replace`, `dc_js_str_replace`, and `dc_set_props` tools (not `write_file`; `str_replace_edit` works but won't stream); template edits stream into the live preview as you type.
</attached-skill>


<system-reminder>Auto-injected reminder (ignore if not relevant): do not recreate copyrighted or branded UI unless the user's email domain matches that company. Create original designs instead.</system-reminder>

## Assistant

_[tool: read_file]_

_[tool: read_file]_

_[tool: read_file]_

Brief is complete enough to build from. Making a spec board of all seven screens with named states.

_[tool: dc_write]_

_[tool: show_html]_

_[tool: ready_for_verification]_

Seven screens on one canvas, 390 pt, states named above each frame and data-scaling notes under them.

A few decisions worth flagging:
- **Maturity and topic bars are monochrome on purpose** — the four saturated colours stay reserved for the modes.
- **Sign-in rail** runs the four line colours in order and terminates at the Start button.
- **Stats** shown three ways: typical, day one, and long-haul (streak 340, level 23, 12 topics).
- **Joker spent** with no jokers left would be a streak-reset screen; the brief didn't ask for it and I didn't invent one. Say the word if you want it.
- Icons are drawn as live CSS at 512, previewed at 200/60/40 — a developer can trace them, but they're not exported PNGs.

## User

Any questions open decisions?

## Assistant

Yes — five that change the build:

1. **Streak reset (no jokers left).** Not in the brief, but it's the state that actually needs the most care in tone. Design it?

2. **Where does Stats live?** No navigation is specified anywhere in the app. Tab bar, a link from the mode picker, or from the session summary?

3. **Nothing due** — does it replace the mode picker, or sit above it? Right now it replaces it, which means she can't start a session from that screen except through the three offers.

4. **Session summary.** The prototype has one, but it was never designed, and both level-up and joker-spent sit on top of it. Worth doing properly.

5. **Topic list past five entries.** I annotated "expands in place." Alternative is a separate topics screen. Twelve tags is plausible once personal cards land.

Smaller: the joker slots use a grey-to-white ramp like everything else, so a full balance reads as three white blocks — nothing distinguishes a joker from a progress marker at a glance. One reserved shape (a diamond, say) might earn its place.

## User

1. yes
2. Tab bar sounds good
3. make a suggestion
4. yes, creade a design
5. expanding in place sounds sensible
did you create designs for both iPhone (15 Pro) and iPad?

## Assistant

Answering the iPad question first: no — everything so far is 390 pt iPhone only. More on that below. Building 1–4 now.

_[tool: dc_html_str_replace]_

Now the diamond token applied to the earlier screens.

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: ready_for_verification]_

New block **2a** at the top: streak reset, session summary, the revised practise tab, tab bar states, and the diamond joker token (also applied to the earlier stats and joker screens).

On **3**, my suggestion, now built: nothing-due sits as a block on top of the Practise tab rather than replacing it, so the four lines stay one tap away. Screen 05 in block 1a is superseded.

On iPad: no, nothing is designed for it yet. Worth deciding what iPad means here before I draw it — the honest options are (a) the same 390 pt column centred on a wider dark field, which is what the prototype does today and costs nothing, (b) a two-column stats screen and a wider session card, or (c) full iPad layouts including landscape and split view. Given she uses both devices interchangeably, (a) or (b) is probably right. Which?

## User

Can the more space on an iPad be used in a sensible way? Then it should be b) or c)

## Assistant

Yes — for Stats especially: at iPad width the whole picture fits without scrolling, which is the one thing the phone version can't do. Building (b), with landscape covered.

_[tool: dc_html_str_replace]_

_[tool: ready_for_verification]_

Block **3a** at the top: iPad Stats (834×1194, two columns, fits without scrolling) and the Practise tab in landscape (1194×834, offers left / lines right, session-length picker finally visible).

Where the space genuinely pays off: Stats, which is the one screen that scrolls on the phone, and the mode picker, where the four lines are the target and can afford to be bigger. Everywhere else it doesn't — the session card, sign-in and the moments keep the 390 pt column centred, and I've written that down as a rule rather than drawing eight more frames. Type goes up ~15%, not double.

One thing to watch: Slide Over is 320 pt, narrower than the iPhone. The PIN cells and the length picker are what break first.

## User

did you create the iPad Screens? If not: do it now

## Assistant

Only two. Building the rest of the iPad set now.

_[tool: dc_html_str_replace]_

_[tool: ready_for_verification]_

Block **4a** at the top now has the rest of the iPad set, drawn rather than described: sign in, practise tab portrait (normal day), the session card, session summary, level up, joker spent, streak reset, and add-to-home-screen in iPad Safari. Stats and the landscape practise tab stay in **3a**.

Two of these actually differ rather than just re-centring: the install hint, where iPad's Share control is in the top toolbar so the sheet and pointer flip upward, and the session, where the station strip runs the full 834 pt while the answer column stays 560 pt and sits low. Everything else is the 560 pt column centred.

## User

so everything is done?

## Assistant

Everything you asked for, yes. But adding the tab bar created two gaps I should name rather than let a developer improvise:

- **Settings.** The tab bar has a third tab and there's no screen behind it. The spec puts the daily new-card limit there, plus deck/tag filtering and presumably sign out.
- **Drill a topic.** That offer has to lead to a topic picker, which doesn't exist.

Also undesigned, lower stakes: the expanded twelve-topic list state (annotated, not drawn), the offline indicator — nothing anywhere shows that events are queued in the outbox — and the icons are live CSS, not exported PNGs.

Want Settings and the topic picker? They're the two that block the build.

## User

ok, go on and finalize your work

## Assistant

_[tool: dc_html_str_replace]_

_[tool: ready_for_verification]_

Block **5a** closes the gaps: Settings (iPhone and iPad), the topic picker behind "Drill a topic", the expanded twelve-topic list, and the offline indicator in its three states.

That's the full set — 26 numbered screens across five blocks, newest at the top. Two decisions in there a developer shouldn't have to infer: a drill is a normal session with a filtered queue, so the mode is still chosen afterwards; and the offline bar never appears during a session, so a card is never covered.

Still outstanding, and deliberately so: the icons are live CSS rather than exported PNGs — say the word if you want them rendered at 192/512/180.

## User

go

## Assistant

_[tool: run_script]_

_[tool: view_image]_

_[tool: present_fs_item_for_download]_

Four PNGs above: `icon-192`, `icon-512`, `maskable-512` (mark at 66% inside the safe circle) and `apple-touch-icon-180`, all square with no rounding and no transparency, so iOS masks them itself.

