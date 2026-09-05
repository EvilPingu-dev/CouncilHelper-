CouncilHelper
=============

Browser script for Tribal Wars / Plemiona that exports tribe council data in this CSV shape:

```csv
gracz;pkt;zbierak;farma;suma;komendy;
```

Files:

- `tribe_council_export.js` is the full script to upload to GitHub.
- `scriptbar-loader.txt` is the short script-bar/bookmarklet loader.

Usage:

1. Push this repo to `https://github.com/EvilPingu-dev/CouncilHelper-`.
2. Put the one-line code from `scriptbar-loader.txt` into the Tribal Wars script bar.
3. Open a tribe page, run the loader, and click `Start export`.

The script reads members from the currently open tribe page when possible, scans daily scavenge and farm rankings, and reads command access from `screen=ally&mode=members_troops` when your account has own-tribe access.
