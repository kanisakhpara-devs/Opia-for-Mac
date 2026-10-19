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

**Tested here (Linux, headless Chromium pretending to be a Mac):** the page starts in Lens with no script errors. The menus show ⇧⌘I, ⇧⌘E, ⌘,, ⌘Z, ⌘[ and so on, also in Spanish. ⌘Z arrives as Ctrl+Z, and the delete key arrives as Delete. The engine answers, and reports this repository for updates.

**Tested on GitHub's Macs:**
- **Apple silicon:** Opia.app opened in a real window. Lens started on the Apple GPU (WebGL 2) with no script errors, and the first-run tour came up. The screenshot showed no permission prompts.
- **Intel:** Opia.app builds and its engine answers. The window opens with its menus, but Lens can't start there: GitHub's Intel Macs are virtual machines whose WebGL is lost before Opia starts. A real Intel Mac has a graphics card, but this build hasn't been seen running Lens. The build shows a warning for this case and still publishes.

**Fixed on the way, from what the builds showed:**
- **OpenCV wouldn't load inside the app** ("recursion is detected during loading of cv2 binary extensions"). A small start-up hook (`tools/rthook_cv2.py`) now loads OpenCV's compiled module directly. Every OpenCV function Opia uses is in it.
- **macOS asked "Allow Opia to find devices on local networks?"** The engine's web server looked up the computer's network name when it started. It no longer does, and the prompt didn't come back.
- **"Opia could not start" showed only a stack in Safari's engine**, which leaves the message out. It now shows the message first.
- **If WebGL is lost**, Opia says it needs WebGL 2, instead of failing inside the graphics code.

**First release:** v0.1.5 (Alpha), with `Opia-AppleSilicon.dmg` (149 MB), `Opia-Intel.dmg` (146 MB) and the two zips the updater uses.

**Not tested:** anything by a person on a real Mac. That covers:
- importing and editing photos;
- Groove recording and Motion export;
- the Trash and Finder;
- the trackpad pinch;
- the Open Anyway step;
- the updater's swap, since there was nothing older to update from yet.
