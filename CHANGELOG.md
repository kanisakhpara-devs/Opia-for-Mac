# Changelog

Every change to Opia for Mac is listed here, newest first, with what was tested and what was not.
Opia for Mac is made from [Opia for Windows](https://github.com/kanisakhpara-devs/Opia-for-Windows); its changelog has the history of everything before the Mac version.
Work done in a cloud session (no Mac to hand) says so. Those changes were tested in headless Chromium on Linux and by the build on GitHub's Macs, not by a person using a Mac.

## Opia for Mac, first version (cloud session, 2026-10-19)

**Made from** Opia for Windows as of commit `dc9c9ea` (the WhatsApp help number), with all five workspaces: Lens, Imagine, Motion, Groove and Folio.

**What changed for the Mac:**
- **The window** is pywebview on the Mac's own WebKit. Full Screen (F11, the menu, or ⌃⌘F) uses the window's own full screen, because the page's full screen isn't switched on in that web view. If the window can't open, Opia falls back to Chrome or Edge in app mode, then the default browser.
- **Keys:** ⌘ does what Ctrl does, and ⌥ Option is Alt. Shortcuts are shown the Mac way everywhere: menus, tips and help, in English and Spanish (⇧⌘E rather than Ctrl+Shift+E). ⌘Q, ⌘H and ⌘W are left to macOS, so HDR moved from Ctrl+H to ⇧⌘H. Control-click is a right-click, not "add to selection". The delete key deletes photos, pages and clips, as Delete does on Windows.
- **The trackpad:** Safari's pinch events are turned into the Ctrl + wheel that Opia's pinch-to-zoom already listens for.
- **Files:**
  - Deleting from disk moves files to the **Trash** (through macOS's own file manager).
  - **Show in Finder** replaces Show in Explorer.
  - The file browser lists the startup disk and everything under `/Volumes` (other disks, cards and network shares).
  - Picking a program picks a whole `.app`.
- **Other apps:** Opia looks in Applications for Photoshop, Affinity Photo, Pixelmator Pro, GIMP, Krita, Photomator and Preview, and opens files in them with `open -a`. Adobe DNG Converter is found in Applications. ColorSync profiles are offered for soft proofing and export.
- **Motion** plays H.264, HEVC and VP9 directly. MKV, Ogg and AV1 get a preview copy, because WebKit can't play them (AV1 only on the newest chips).
- **CD/DVD burning** says it's only in Opia for Windows and suggests burning from Finder.
- **Updates:** Help › Check for Updates downloads the zip for this Mac's chip from the newest release. It unpacks it with `ditto`, checks the app's bundle ID and signature (`codesign --verify --deep --strict`), and swaps it in after Opia quits. The old app is kept if the swap fails. It refuses, and says why, when Opia is running from the .dmg or a read-only copy macOS made.
- **The build** (`.github/workflows/mac.yml`) runs on GitHub's Apple silicon and Intel Macs. For each, it:
  - builds Opia.app with PyInstaller;
  - fills in Info.plist (version, and the sentences macOS shows when asking for the microphone, camera and folders);
  - signs the app ad hoc;
  - checks that the engine answers;
  - opens the real window with `OPIA_SELFTEST=1`. The page has to start in Lens, with the Mac layer on and no script errors.

  Only then does it publish `Opia-AppleSilicon.dmg`, `Opia-Intel.dmg` and the two zips the updater uses as release v0.1.N (Alpha).
- **The README and website** are for the Mac. They cover which download to pick and macOS's **Open Anyway** step for an app that isn't notarised.

**Tested here (Linux, headless Chromium pretending to be a Mac):** the page starts in Lens with no script errors. The menus show ⇧⌘I, ⇧⌘E, ⌘,, ⌘Z, ⌘[ and so on. The engine answers, and reports this repository for updates.

**Not tested:** anything by a person on a real Mac. That covers importing and editing photos, Groove recording, Motion export, the Trash, Finder, the trackpad pinch and the updater's swap.
