# Screen designs

Exported from Claude Design. `Kotoba Line - Screens.html` is one canvas holding
**52 numbered screens** with their states named above each frame, and notes
underneath flagging where a layout depends on data that can grow or vanish.

Open it in a browser — it is self-contained, so there is no longer a separate
runtime file beside it. The screens are prototypes: recreate the visual output,
not the internal markup.

The second round (screens 27–52) also corrected three annotations that
contradicted the build: the new-card range now reads 5–40 with the minus going
inert at 5, the topic list is described as nine Kaishi topics rather than a
partition of the deck, and the day-one frame's threshold for level 2 is 300 XP.

`chats/chat1.md` is the conversation the designs came out of. It records why things
are the way they are and which decisions were made deliberately.

## What is covered

Five blocks, newest first on the canvas.

| Block | Screens |
|---|---|
| **7a** §5a — letting her choose | 31 Browse idle, 32 results, 33 nothing matches, 34 starred only, 35 Browse iPad, 36–38 Choose a set, 39 a chosen session running, 40 its summary, 41 めくる's four ratings, 42 話す for comparison, 43–46 話す's four states, 47 聞く with no recording, 48 選ぶ with no sound, 49 first run, 50 leaving, 51 resuming, 52 session expired |
| **6a** Adding her own words | 27 entry point, 28 add a word, 29 filled with the example open, 30 your own deck |
| **5a** The gaps closed | 22 Settings (iPhone), 23 Topic picker, 24 Topics expanded (12 entries), 25 Offline indicator (3 states), 26 Settings (iPad) |
| **4a** iPad — remaining screens | 14 Sign in, 15 Practise tab portrait, 16 Session, 17 Session summary, 18 Level up, 19 Joker spent, 20 Streak reset, 21 Add to home screen (iPad Safari) |
| **3a** iPad — the two that re-flow | 12 Stats portrait (two columns, no scroll), 13 Practise tab landscape |
| **2a** Open decisions resolved | 08 Streak reset, 09 Session summary, 10 Practise tab / nothing due, 11 Tab bar (3 states), joker token |
| **1a** The original seven | 01 Sign in (default, wrong PIN, rate limited), 02 Stats (typical, day one, long haul), 03–05 Level up / Joker spent / Nothing due, 06 Add to home screen, 07 App icon |

Frame sizes: 390 × 844 (iPhone), 834 × 1194 (iPad portrait), 1194 × 834 (landscape).

## Decisions a developer should not have to infer

- **Nothing-due sits on top of the Practise tab**, it does not replace it. The four
  lines stay one tap away. Screen 05 in block 1a is superseded by 10.
- **A drill is a normal session with a filtered queue** — the mode is still chosen
  afterwards, on the next screen.
- **The offline bar never appears during a session**, so a card is never covered.
  It belongs to the tab screens only.
- **The four saturated line colours are reserved for the modes.** Maturity bands and
  topic bars are a grey-to-white ramp on purpose.
- **A diamond is the only diamond in the app**, and it means a joker. Circles are
  stations, bars are progress.
- **iPad is a 560 pt column centred**, except Stats and the Practise tab, which
  genuinely re-flow. Type goes up ~15%, not double. Split view (507 pt) and Slide
  Over (320 pt) fall back to the phone layout.

## Icons

`icons/` holds the four exported PNGs — 192, 512, maskable 512 (mark at 66% inside
the safe circle), and a 180 for iOS. Square, no rounding, no transparency; iOS
masks them itself.

## Where the build departs from the canvas

The practice loop was built from the prototype while the second round was in
flight, and the drawings overruled several states decided in code. Those are
now corrected — 話す no longer scores what it heard, めくる prints the interval
under each rating, the two sound-absent cards behave as 47 and 48 draw them,
and the × asks once. What remains is deliberate, and short.

- **The six bars in 43 do not follow the microphone's level.** They are a loop
  that says "listening" rather than "this loud". `SpeechRecognition` hands over
  no audio stream, and opening a second one with `getUserMedia` to measure it
  is unreliable alongside recognition on iOS — the risk is breaking the feature
  to animate it honestly. Worth revisiting if the API ever exposes a level.
- **Two rows in Settings are still not built**, and now have designs behind
  them: the per-deck toggles and "Topics in a session". The deck toggles are
  worth building now that there are two decks to toggle.
- **29's topic field is inline, not a native prompt.** The design does not say
  which; a browser dialog in a standalone PWA looks like the browser's, so it
  is a field.
- **30's rows do not swipe to edit or delete.** The delete endpoint is built
  and tested; the gesture is not, and a swipe that only deletes is worse than
  no swipe.
- **Pitch accent is still not built.** The deck carries it on 1,500 of its
  1,501 notes as inline-styled spans, and nothing in this round changes that.
- **52's paragraph does not say "from this morning".** The drawing reads "the
  14 answers from this morning are safe on this device"; the screen has no idea
  when she practised, and at nine in the evening that would be a small lie in
  the middle of a reassurance. It says "the 14 answers waiting here" instead,
  which keeps the count — the part of the sentence that is doing the work.
- **52's dismissal is the session's ×.** The drawn frame is cropped, so the
  control the note calls for ("she can dismiss it") is not in it. The app
  already has one word for leaving a screen, and a second one here would teach
  her two.

**Not yet built:** nothing from this round. The expired cookie (52) closed the
last of it. §5a is complete — browse (31–34) and choose-a-set (36–40)
— and so is the personal deck (27–30); its deck and topic chips are
deliberately left to 36, where all three dimensions are offered together, and
the route out of an empty search into "add it as your own word" waits on the
personal deck.

**Confirmed by a drawing, having first been guessed:** the new-card floor of 5,
the personal deck row at zero cards, and dropping an unlistenable card from 聞く
— 47 draws exactly that, strip and all.

## Known gaps

None outstanding. The second round closed §5a, the practice-loop states and the
lifecycle screens, and added the personal deck, which no brief had asked for.

`next-brief.md` holds the full analysis and a ready-to-paste brief for the next
design round. In short:

- **Blocking** — the browse-and-star screen, the deck and `only=` dimensions at
  session start, any indication that a filtered session is running, めくる's four
  rating buttons, all of 話す, and a card with no audio in 聞く.
- **Important** — first-run deck download, leaving and resuming a session, an
  expired session cookie (distinct from offline, which 25 covers).
- **Smaller** — a populated personal deck, the topic picker at twelve entries,
  pitch accent switched on, sign-out confirmation.
