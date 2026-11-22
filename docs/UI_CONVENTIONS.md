# UI conventions — the SFM app feel

The rules that make an SFM app feel like an SFM app. Written from what Job Manager does today, so a second app built to this list matches it. Each rule says whether Job Manager already does it, and most come with the snippet that enforces it. `ui_base.html` in the repo root holds those snippets as one include.

Status key: **done** = in Job Manager now · **partly** = some places · **todo** = not yet, adopt suite-wide.

## 1. Number fields

1. **Numbers are typed, never scrolled.** The mouse wheel over a number box must scroll the page, not change the value. *done* (the wheel blocker in `script.html`).
2. **No spinner arrows.** The up/down arrows are hidden on every number input. *done* (CSS).
3. **Focus selects the whole value**, so typing replaces it; nobody should have to delete first. *partly* (two places). Adopt globally: on `focus`, `select()` for number inputs and short text inputs with a value.
4. **Right-aligned in tables**, left-aligned in forms. *done* (`td.num`, `input.num`).
5. **Blank means blank.** An empty number box stays empty and saves as blank, never as 0, unless the field is a count. *done* (the `pctOrBlank` family).
6. **Money prints as `$1,234.56`**, two decimals always; percentages as `9.25%` with the sign. Input boxes take plain numbers with no `$` or `%`. *done* (`fmt$`, `fmtPct`).
7. **Step is 0.01 for money and hours**, 1 for counts, so the browser never rejects a decimal. *done*.

## 2. Text fields

8. **One row tall by default, grows with its text.** Description boxes are textareas that grow as you type and never show a scrollbar. *done* (BOM description; `matDescGrow`).
9. **Enter in a single-value box saves**, it does not add a line. In a growing box Enter blurs. *done* in the editor.
10. **Placeholders are examples, not labels.** "2 wks", "https://…", "Net 30". The label sits above the box. *done*.
11. **Required fields show a red asterisk** after the label, nothing else. *done* (`label .req`).
12. **Hints are one line, grey, 11 px, under the label.** No tooltips for things people need to know; tooltips (`title`) only for icon buttons. *done* (`label .hint`).
13. **Pickers that can grow offer "➕ Add new…" as their last option** and open a small modal instead of sending you to another page. *done* (vendors, tax rates, payment terms, material types, deliverables).

## 3. Keyboard

14. **Enter saves without navigating**; the bottom Save button saves and goes back to the list. *done*.
15. **Escape closes the topmost modal** and cancels comment / screenshot modes. *partly*. Adopt globally.
16. **Tab order follows reading order**; no tabindex tricks. *done*.
17. **Keyboard shortcuts are shown**, never assumed: ⌘P style hints in placeholders and button titles. *done*.

## 4. Saving and feedback

18. **One Save button in the sticky title row** saves the whole record and stays on the page; it stamps "Saved 9:34 AM" beside itself. *done* (`#headerSaveBtn`).
19. **Small lists save immediately** (Default Operations, directory contacts, library picks) and say so in grey text: "Changes save immediately." *done*.
20. **Every action gets a toast**, bottom right, 3.5 s: dark grey for info, green for success, red for errors. One line, plain English, names the thing ("Rev 2 sent — estimate frozen"). *done* (`toast`).
21. **Errors say what to do next.** "Took longer than 25 seconds. It may have completed — refresh and check before retrying." Never a bare stack trace. *done*.
22. **Long waits show the loader** (the kangaroo), and a button that starts a long job changes its own label while it runs ("Making PDF…", "Adding page numbers…"). *done*.
23. **Nothing silently fails.** A step that is skipped or falls back says so in the toast. *done* (PDF reuse, server fallback).

## 5. Confirmations and destruction

24. **Deleting something with history asks you to type its name** (a job, an assembly for good). *done*.
25. **Small deletions use a plain confirm** with the name in it: "Remove SVST from the default operations?" *done*.
26. **Prefer archive over delete.** Assemblies archive; vendors and contacts retire with Active = No; nothing with a paper trail is removed. *done*.
27. **Reversible things do not confirm.** Reordering, toggling, ticking a box: just do it and toast. *done*.

## 6. Locking and who is here

28. **One editor per record**, a green "Checked out to you · since 9:33 AM" pill; everyone else sees read-only with a yellow banner naming the holder and a Take over button for the owner. *done* (job lock, record locks).
29. **Read-only means visibly disabled**, not hidden: controls stay where they are, greyed, so the layout does not jump. *done*.

## 7. Layout

30. **White sidebar, 220 px, blue active bar on the left.** Top-level pages in catalogue order; a thin purple bar marks owner-only pages with a legend "purple = only you see this yet". *done*.
31. **The test bench is amber.** `/dev` turns the sidebar amber with a DEV tag; `/exec` stays white. Nobody mistakes the test copy for the team's. *done*.
32. **Page title row is sticky** with the record key, name, lock pill, revision pill and Save. *done*.
33. **Tabs are an underlined row** (`.view-tabs`), a second row for sub-tabs of the thing selected (assembly pill + its tabs). Never more than two rows. *done*.
34. **Cards, 6 px radius, 1 px grey border, 20 px padding.** Sub-headings inside a card are 15 px bold with a rule above. *done* (`.card`, `.pd-sub`).
35. **Tables fit the card.** Fixed column widths for the known columns, the text column takes the rest; no sideways scrolling; description cells wrap and the row grows. *done* (BOM, v2.30.0).
36. **Empty states are one italic grey line** centred in the card: "No tooling yet." *done* (`.empty`).
37. **Action buttons in a cell are icon tiles**, 17 px glyph, light border, a blue dot in the corner when something is set, the detail in the tooltip. *done* (`.mat-ic`).
38. **Drag handles are ⋮⋮**, grey, at the start of the row; the ▲ ▼ buttons stay for people who prefer them. *done* (Default Operations).

## 8. Buttons

39. **One primary (blue) button per card**; everything else is `secondary` (white, blue text) or `ghost` (transparent, grey border). Red `danger` only for destruction. *done*.
40. **Disabled buttons fade to 50 %** and keep their width, so nothing shifts. *done*.
41. **Icon + word on buttons**, never an icon alone, except in table cells: "⬇ Download PDF", "🖨 Print", "+ Add Material". *done*.
42. **Buttons say what they do, in the user's words.** "Freeze & file PDF", not "Submit". *done*.

## 9. Colour and type

43. **System font stack** (San Francisco / Segoe / Roboto), 14 px body, 13 px in tables, 12 px for tab chrome, 11 px hints. *done*.
44. **Palette**: ink `#1c2433`, text `#374151`, muted `#6b7280`, faint `#9ca3af`, lines `#e5e7eb`, page `#f3f4f6`, card white; brand blue `#2E75B6` (hover `#235d92`); success `#047857`, warning `#b45309` on `#fef3c7`, danger `#b91c1c`; purple `#4c1d95` for owner-only; amber `#c2410c` on `#fff7ed` for the dev bench. *done*.
45. **Pills**, 999 px radius, 12 px, for status words; a colour per state, never a colour for decoration. *done* (`.pill`).
46. **Printed pages use Arial**, 12 px base, letter size, with the footer stamped per page. *done* (quote PDF).

## 10. Dates and units

47. **Dates display as `Nov 16, 2026`** everywhere; inputs are native date pickers. *done*.
48. **Date inputs are parsed as local midnight**, never UTC, so a date never shows as the day before. *done* (`_parseLocalDate_`).
49. **Times show as `9:33 AM`**, no seconds. *done*.
50. **Lead times are free text** ("2 wks", "3 days"); hours are decimals. *done*.

## 11. Help and change

51. **Every UI change lights up with a NEW tag** until the person ticks it; the sidebar counts the unread ones. *done* (What's new).
52. **The version sits in the sidebar footer**, monospace, with the build date. *done*.
53. **Owner tools live at the bottom of the sidebar** in orange: What's new, Screenshot, Comment, View as, Dev Mode, Links. *done*.

## Adopting this in a new app

Copy `ui_base.html` (styles + the behaviour snippets) and `styles.html`'s first 130 lines (layout, inputs, buttons, tables, tabs), keep the palette block as is, and work through the **partly** and **todo** rules first: select-on-focus (3) and Escape-closes-modal (15) are the only two Job Manager has not finished.
