# Baseline — Design tokens

Extracted from live app pixel samples (✅) + reference knowledge (📖). Dark is default; light theme follows the video's look (white #ffffff canvas, #f7f8f8-ish panels, same accents).

## Surfaces (dark)
| Token | Value | Source |
|---|---|---|
| bg-main | `#121213` | ✅ sampled flat across issue view |
| bg-sidebar | `#09090a` | ✅ |
| bg-overlay (modals, board cards) | `#1a1a1b` | ✅ create modal + board card |
| bg-menu (menus, palette, toasts) | `#212122` | ✅ palette + toast samples |
| bg-active-item | `#232325` | ✅ sidebar active row |
| bg-hover | `rgba(255,255,255,0.04)` | 📖 |
| bg-input | `#0f0f10` | 📖 (comment composer slightly darker than card) |
| board-column-bg | transparent (columns delimited by 16px gutters, faint 1px separators `rgba(255,255,255,0.06)`) | ✅ |

## Text
| Token | Value |
|---|---|
| text-primary | `#f7f8f8` 📖 |
| text-secondary | `#8a8f98` 📖 (labels, dates, keys dimmer variant `#62666d`) |
| text-disabled | `#575b60` 📖 |

## Border / shadow
- border: `rgba(255,255,255,0.08)`; subtle border `rgba(255,255,255,0.06)`
- shadow-overlay: `0 8px 24px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.06)`; modal: stronger, radius 14px
- radius: input/pill 6px (pills full-round for labels), rows 4px, cards 8px, menus/palette 10-12px, modal 14px

## Brand & status colors
| Token | Value | Note |
|---|---|---|
| brand | `#5e6ad2` | buttons, links, done-state icon, selection |
| brand-hover | `#6e79d6` | |
| status/backlog | `#b4b9bd`-gray, dashed circle icon | ✅ shape |
| status/todo | `#8a8f98`, outline circle | |
| status/started | `#f2c94c` yellow, half-filled circle | ✅ menu |
| status/completed | `#5e6ad2` filled circle + white check | ✅ menu |
| status/canceled | `#7d8084`, circle + x | ✅ menu |
| priority/urgent | orange-red `#f2994a`-family, filled square icon | ✅ menu shape; hue verify in loop |
| priority/high | orange bars ×3 | ✅ |
| priority/medium | yellow bars ×2 | ✅ |
| priority/low | gray bar ×1 | ✅ |
| priority/none | dashed bars "…" gray | ✅ |
| label/bug | red dot (`#eb5757` family) | ✅ |
| label/feature | purple dot (`#8e4ffa` family) | ✅ |
| label/improvement | blue dot (`#3b82f6` family) | ✅ |
| label pill | bg `rgba(color,0.12)` + colored dot + name `#c9cdd3`, full radius | ✅ board cards |
| toast/success | green check `#4cb782` | ✅ "Issue created" toast |

## Typography
- Font: Inter Variable (bundled, OFL); code: JetBrains Mono
- Base UI: 13px / line 20px(1.45); small/dim 12px; issue page title ~20px 590wt tracking -0.02em; modal title 15px 560wt; group headers 13px 590wt; nav 13px; menu item 13px; keycaps 11px
- Letter-spacing: -0.01em globally-ish, tighter on large titles

## Layout metrics (measured off captures, logical px)
- Sidebar ~240px wide (live: 213px content + padding → 240 total); main content full-bleed, max ~1200 for issue page text column
- Top bar height ~46px; sub-nav row ~44px; group header ~36px; issue row ~40px
- Create-issue modal: width ~700px, vertically centered w/ margin-top ~10vh
- Cmd+K palette: width ~640px, top ~15vh; item height 40px
- Board: column width ~470px (3 visible at 1470), gutter 16px, card padding 12-14px
- Icons: 15-16px, stroke 1.5, round caps; status/priority glyphs drawn custom

## Light theme (from video frames)
- canvas `#ffffff`, sidebar `#f9f9f9`-ish, text `#0d0e10`/`#62666d`, borders `rgba(0,0,0,0.08)`, same accents; group header bg `#f7f7f8`
