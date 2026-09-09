# Screen designs

Exported from Claude Design. `Kotoba Line - Screens.dc.html` is one canvas holding
26 numbered screens with their states named above each frame, and notes underneath
flagging where a layout depends on data that can grow or vanish.

Open it in a browser; `support.js` is the canvas runtime it loads. The screens are
prototypes — recreate the visual output, not the internal markup.

`chats/chat1.md` is the conversation the designs came out of. It records why things
are the way they are and which decisions were made deliberately.

## What is covered

Five blocks, newest first on the canvas.

| Block | Screens |
|---|---|
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

## Known gaps

Designed but not drawn, or drawn but not exported:

- The browse-and-star screen from §5a of the spec has no design yet.
- The expanded twelve-topic list is drawn (24) but only for the stats card.
- Personal-deck states assume zero cards; nothing shows a populated personal deck.
