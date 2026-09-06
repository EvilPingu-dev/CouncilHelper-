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

Same-tribe status comes from the tribe's own `members_troops` access list, which is reliable. Friend status is detected from the add/remove-friend link on `screen=info_player`, and shared-commands-for-friends is detected by checking whether that same profile page exposes a troop/command table. This friend-sharing detection is best-effort: if your world's page structure differs, that part may need small adjustments.

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

The script reads complete tribe rosters from Tribal Wars map data (`/map/ally.txt` and `/map/player.txt`), scans all daily scavenge and farm ranking pages until they run out, and reads command access from `screen=ally&mode=members_troops`. For players from other tribes, it also tries the same command page by player id so friend-shared command access can be detected when Tribal Wars exposes it.
