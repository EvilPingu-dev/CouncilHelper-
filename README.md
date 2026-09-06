CouncilHelper
=============

Browser script for Tribal Wars / Plemiona that exports tribe council data in this shape:

```csv
plemie;gracz;pkt;zbierak;farma;suma;komendy;status_komend;
```

It can also download a colored `.xls` HTML table for LibreOffice. The XLS has one full member list per tribe you enter (every member from the tribe roster, not only players found in rankings), with scavenge, farm, sum, and command status joined onto each player. Cells are colored by tribe.

Command status (`status_komend`) is one of 5 real states:

- `Plemię: udostępnia` — same tribe, player shares command/troop access
- `Plemię: brak` — same tribe, player has not shared command/troop access
- `Poza plemieniem: nie znajomy` — different tribe, not a friend
- `Poza plemieniem: znajomy, brak` — different tribe, friend, no shared commands
- `Poza plemieniem: znajomy, udostępnia` — different tribe, friend, shares commands

Same-tribe and friend status both come from the game's own `Ustawienia > Dzielenie się komendami` (Settings > Command sharing) page (`screen=settings&mode=command_sharing`), which lists exactly who currently shares commands with the viewer. This is the real signal Tribal Wars uses, not a guess.

Files:

- `tribe_council_export.js` is the full script to upload to GitHub.
- `scriptbar-loader.txt` is the short script-bar/bookmarklet loader.

Usage:

1. Push this repo to `https://github.com/EvilPingu-dev/CouncilHelper-`.
2. Put the one-line code from `scriptbar-loader.txt` into the Tribal Wars script bar.
3. Open a tribe page, run the loader, enter only the tribe tags you want, and click `Start export`.
4. Use `Download colored XLS` for LibreOffice colors, or `Copy CSV` / `Download CSV` for plain data.

Enter tags one per line, for example:

```text
:G:
;G;
```

The script reads complete tribe rosters from Tribal Wars map data (`/map/ally.txt` and `/map/player.txt`), detects the real number of scavenge/farm ranking pages per world (via an offset that TW clamps to the last page) instead of guessing a fixed limit, and reads command sharing status from `screen=settings&mode=command_sharing` (`type=ally` for tribe members, `type=buddy` for friends). In the colored XLS, `Komendy` is an actual checkbox instead of text.
