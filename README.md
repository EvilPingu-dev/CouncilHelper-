CouncilHelper
=============

Browser script for Tribal Wars / Plemiona that exports tribe council data in this shape:

```csv
plemie;gracz;pkt;zbierak;farma;suma;komendy;
```

It can also download a colored `.xls` HTML table for LibreOffice. Cells are colored by tribe, and a separate table above the main export lists players who still need friend/shared command access.

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

The script reads complete tribe rosters from Tribal Wars map data (`/map/ally.txt` and `/map/player.txt`), scans up to 200 daily scavenge and farm ranking pages by default, and reads command access from `screen=ally&mode=members_troops`. For players from other tribes, it also tries the same command page by player id so friend-shared command access can be detected when Tribal Wars exposes it.
