<p align="center">
  <img src="docs/readme/banner.png" alt="Opia: photos, pictures, video, music and PDFs in one app, all on your computer" width="100%">
</p>

<h1 align="center">Opia for Mac</h1>

<p align="center">
  <img alt="macOS" src="https://img.shields.io/badge/macOS-Apple%20silicon%20%7C%20Intel-0E0E10?style=for-the-badge&logo=apple&logoColor=F4F1EA">
  <img alt="Python 3.10+" src="https://img.shields.io/badge/Python-3.10%2B-3D5AFE?style=for-the-badge&logo=python&logoColor=white">
  <img alt="Runs offline" src="https://img.shields.io/badge/Runs-offline-1a9c4b?style=for-the-badge">
  <img alt="Five workspaces: Lens, Imagine, Motion, Groove, Folio" src="https://img.shields.io/badge/Lens%20%C2%B7%20Imagine%20%C2%B7%20Motion%20%C2%B7%20Groove%20%C2%B7%20Folio-B57CFF?style=for-the-badge">
</p>

<p align="center">
  <a href="#-lens"><b>Lens</b></a> ·
  <a href="#-imagine"><b>Imagine</b></a> ·
  <a href="#-motion"><b>Motion</b></a> ·
  <a href="#-groove"><b>Groove</b></a> ·
  <a href="#-folio"><b>Folio</b></a> ·
  <a href="#-get-started"><b>Get started</b></a> ·
  <a href="https://kanisakhpara-devs.github.io/Opia-for-Mac/"><b>Website</b></a> ·
  <a href="https://github.com/kanisakhpara-devs/Opia-for-Windows"><b>Opia for Windows</b></a> ·
  <a href="https://github.com/kanisakhpara-devs/Opia-for-Android"><b>Opia for Android</b></a> ·
  <a href="CHANGELOG.md"><b>Changelog</b></a>
</p>

---

**Opia for Mac** is the Mac version of [Opia for Windows](https://github.com/kanisakhpara-devs/Opia-for-Windows): a desktop app for the things you make, in five workspaces: **Lens** (a photo organiser and raw-style editor), **Imagine** (a layered picture editor), **Motion** (a video editor), **Groove** (a music studio) and **Folio** (a PDF editor). You switch between them with one click. Everything runs on your own computer: no account, no uploads, no subscription. A Python engine handles the files, catalogs, colour management and exports. The interface runs in the Mac's own WebKit and draws every photo edit on the graphics card (WebGL 2).

> **Alpha, and not yet tried on a real Mac.** Every build is made on GitHub's Macs (Apple silicon and Intel), where it is opened in a real window and checked to start without errors before it is published. Nobody has used it on their own Mac yet. Please report problems as [issues](https://github.com/kanisakhpara-devs/Opia-for-Mac/issues), with a screenshot.

Every workspace has a **Beginner** mode that shows the essentials in bigger controls, and an **Advanced** mode with every panel and tool. Opia also comes in four themes, in English and Spanish, and has trackpad-friendly controls: pinch to zoom, two fingers to pan.

The screenshots below were taken in Opia for Windows. On a Mac it looks the same, inside a Mac window, with shortcuts shown the Mac way (⇧⌘E rather than Ctrl+Shift+E).

<br>

## <img src="web/img/opia-icon.svg" width="34" align="top"> Lens

<img src="docs/readme/photos.png" alt="The Lens library: a grid of landscape photos with ratings, flags and colour labels, the catalog and folders on the left and keywording on the right">

Import, sort and find your photos, then edit them without ever changing the original files.

| | |
| --- | --- |
| **Library** | Grid, Loupe, Compare and Survey views. Star ratings, pick / reject flags and colour labels. Collections, smart collections, keywords, metadata presets and a filter bar. Stacks, virtual copies, a duplicate finder and "pick the sharpest". **People**: on-device face detection and grouping. |
| **Develop** | White balance, tone, presence, tone curve, HSL, detail, lens corrections, transform / Upright, effects and calibration. Presets, snapshots, before / after, soft proofing. Crop, healing, red eye and masks (brush, linear, radial). Panorama, HDR and focus-stack merges. |
| **Map · Book · Slideshow · Print · Web** | Place photos on a map, lay out a photo book (export to PDF), run a slideshow, print contact sheets and packages, and build a web gallery. |
| **Export** | JPEG, PNG, TIFF, WebP and AVIF with resizing, sharpening, watermarks, ICC profiles and naming templates. Export to a folder, an FTP server or a CD/DVD. XMP sidecars, tethered capture and plug-ins. |

<p align="center"><img src="docs/readme/develop.png" alt="Develop: a sunset photo with exposure, contrast, highlights, shadows, clarity and vibrance adjusted" width="88%"></p>

Your photos are never modified. Edits live in the catalog, and optionally in `.xmp` sidecars.

<br>

## <img src="web/img/opia-image-icon.svg" width="34" align="top"> Imagine

<img src="docs/readme/image.png" alt="Imagine, the picture editor: a photo with a caption box shape layer and two editable text layers, tools on the left and the layers panel on the right">

A layered picture editor in the spirit of Photoshop.

- **Layers:** opacity, 16 blend modes, drag to reorder, merge, flatten. **Text and shape layers stay editable**, even after transforming them.
- **Selections:** rectangle, oval, lasso and magic wand (Shift adds, ⌥ Option takes away). Feather, invert, fill, copy / cut / paste, layer via copy.
- **Tools:** brush and eraser (with pen pressure), fill bucket, gradient, eyedropper, text, shapes, crop and **Free Transform** (⌘T).
- **Adjustments with a live preview:** levels, curves, hue / saturation, brightness / contrast, colour balance, auto tone, black & white, posterize and threshold. **Filters:** blur, sharpen, noise and pixelate.
- Opens PNG, JPEG, WebP, GIF, BMP, TIFF, HEIC and RAW. Exports PNG, JPEG, WebP or TIFF, straight into your Lens catalog if you like. Projects (`.opiaimg`) keep every layer.
- In Lens, *Photo › Edit in Imagine* opens a photo with its Develop edits applied.

<br>

## <img src="web/img/opia-video-icon.svg" width="34" align="top"> Motion

<img src="docs/readme/video.png" alt="Motion, the video editor: a title over a sunset photo in the preview, and a timeline with a title track, eight photo clips with crossfades and a music track">

A timeline editor that exports MP4.

- **Any number of video and audio tracks.** Drag clips along and between tracks with snapping, trim either end, split at the playhead (S), and delete with or without closing the gap.
- **Fades, crossfades and titles**, with volume per clip and per track, picture-in-picture (size, position, opacity), and fit or fill.
- **Live preview**, then **export to MP4** (H.264 + AAC) at the project size, 1080p, 720p or 480p.
- **Make a video from selected photos** in one click: 4 seconds each, with crossfades.
- Files the window can't play itself (AVI, WMV, HEVC, 10-bit…) get a preview copy in the background. The export always uses your originals.

<br>

## <img src="web/img/opia-music-icon.svg" width="34" align="top"> Groove

<img src="docs/readme/music.png" alt="Groove, the music studio, in Advanced mode: drums, bass, chords and melody riffs over ten bars, an ambient audio track, and the melody's note grid below">

A small studio for people who don't read music, which still has the tools for those who do.

- **Beginner** is a jam board: riff cards for drums, bass, chords and melody that loop together. *Start me off* drafts a song in a style, and *New idea* rewrites one part to fit the rest. Notes stay in the song's scale, so nothing sounds wrong.
- **Advanced** puts the song on a timeline with a mixer. **Drag sound files onto the timeline** exactly where you want them, move clips between tracks, and trim them by their ends. Range editing, a spectrogram, and effects: fades, compressor, filters, echo, reverb, pitch, tempo, speed and noise reduction.
- Record from the microphone, import audio or MIDI, use your own samples, and export WAV, MP3, FLAC, OGG, stems or MIDI.
- Ten instruments are real recordings (from the Fluid R3 GM SoundFont, CC BY 3.0); the rest are synthesised.

<br>

## <img src="web/img/opia-pdf-icon.svg" width="34" align="top"> Folio

<img src="docs/readme/pdf.png" alt="Folio, the PDF editor: an itinerary with highlighted text, ticks and a red note with an arrow, page thumbnails on the left">

Read, fill in, sign and rearrange PDFs.

- **Edit:** type anywhere, highlight, draw, tick and cross, **sign** (draw your signature once), cover things up, add shapes, arrows and pictures, and fill in real form fields. Find text across the document.
- **Pages:** drag pages into order, rotate, duplicate, delete, insert blanks, extract, and **combine several PDFs and pictures into one**.
- Page numbers, watermarks, passwords, smaller files, split into several files, save pages as pictures, and save all the text.
- The files you open are never changed: saving makes a new PDF.

<br>

## 🚀 Get started

1. Download Opia for your Mac:
   - **[Opia-AppleSilicon.dmg](https://github.com/kanisakhpara-devs/Opia-for-Mac/releases/latest/download/Opia-AppleSilicon.dmg)** for Macs with an M1, M2, M3, M4 or later chip (most Macs from 2021 on).
   - **[Opia-Intel.dmg](https://github.com/kanisakhpara-devs/Opia-for-Mac/releases/latest/download/Opia-Intel.dmg)** for older Macs with an Intel processor.
   - Not sure? Apple menu  → **About This Mac**: it says "Chip: Apple M…" or "Processor: …Intel…".
2. Open the .dmg and drag **Opia** onto **Applications**.
3. Open Opia from Applications. **The first time, macOS stops it**, because Opia isn't notarised by Apple (that costs $99 a year). To allow it:
   - macOS says Opia "can't be opened" or "Apple could not verify" it. Click **Done** (not Move to Bin).
   - Open **System Settings → Privacy & Security**, scroll down to the message about Opia, and click **Open Anyway**. Enter your password.
   - Open Opia again and click **Open Anyway**. From then on it opens like any other app.
   - If macOS ever says Opia "is damaged", run `xattr -dr com.apple.quarantine /Applications/Opia.app` in Terminal, then open it again.
4. macOS asks once before Opia can use your Pictures, Desktop or Documents folders, the microphone (Groove) or a camera (tethered capture). Say yes to the ones you use.

Only download Opia from this repository's [Releases](https://github.com/kanisakhpara-devs/Opia-for-Mac/releases). Each release is built from this code on GitHub's own Macs.

**From source:** install Python 3.10 or newer (for example from python.org), then

```bash
git clone https://github.com/kanisakhpara-devs/Opia-for-Mac
cd Opia-for-Mac
pip3 install -r requirements.txt
python3 run.py
```

Opia opens in its own window. Closing the window (or ⌘Q) stops it and, if one is due, backs up your catalog.

**On other computers:** there's **[Opia for Windows](https://github.com/kanisakhpara-devs/Opia-for-Windows)**, which this version is made from, and **[Opia for Android](https://github.com/kanisakhpara-devs/Opia-for-Android)** for phones.

<details>
<summary><b>Requirements and options</b></summary>

<br>

Python 3.10 or newer, with:

```bash
pip install -r requirements.txt
```

`run.py` options: `--port N`, `--no-window` (open the printed address yourself), `--catalog path/to/file.opiacat`, `--home folder`.

The packaged app (`dist/Opia.app`) is built with PyInstaller; the exact command is in `.github/workflows/mac.yml`.

</details>

<details>
<summary><b>A few keyboard shortcuts</b></summary>

<br>

| Where | Keys |
| --- | --- |
| Everywhere | **F10** menus · **⌘Z / ⌘Y** undo / redo · **⌘/** all shortcuts · **⌃⌘F** or **F11** full screen · **⌘Q** quit |
| Lens | **1–5** rating · **P / X / U** pick, reject, unflag · **G / E** grid / loupe · **D** Develop · **⇧⌘H** HDR |
| Imagine | **V M L W B E G T U C** tools · **[ ]** brush size · **⌘T** transform · **⌘J** layer via copy |
| Motion | **Space** play · **S** split · **T** title · **⌥← →** nudge a clip · **⇧⌘E** export |
| Folio | **⌘F** find · **⌘S** save · **Delete** remove the selected item or page |

Everywhere Opia for Windows uses Ctrl, the Mac uses ⌘, and Alt is ⌥ Option. Three are left to macOS: ⌘Q quits, ⌘H hides and ⌘W closes the window, so HDR is ⇧⌘H here. Control-click is a right-click. Help › Customize Shortcuts lets you change them.

</details>

<details>
<summary><b>Where things are kept</b></summary>

<br>

| What | Where |
| --- | --- |
| Catalogs (`.opiacat`, SQLite) | `~/Pictures/Opia/<Name>/<Name>.opiacat` |
| Previews / Smart Previews | `<Name> Previews.opiadata`, `<Name> Smart Previews.opiadata` beside the catalog |
| Backups | `Backups/<date>/<Name>.opiacat.zip` beside the catalog (or the folder set in Catalog Settings) |
| Presets, preferences, recent catalogs | `~/Pictures/Opia/config.json` |
| Groove songs | `~/Pictures/Opia/Music/<song>` |
| Motion projects, preview copies, thumbnails | `~/Pictures/Opia/Video/<project>`, `~/Pictures/Opia/Video/.cache` |
| Imagine projects | wherever you save them (`.opiaimg`) |
| Extra ICC profiles | `~/Pictures/Opia/Profiles`, plus the Mac's own ColorSync profiles |
| Plug-ins | `plugins/` here, plus any folders added in the Plug-in Manager |

</details>

<details>
<summary><b>Writing a plug-in</b></summary>

<br>

A folder with `plugin.json` and a Python file:

```json
{ "id": "me.example", "name": "Example", "version": "1.0", "entry": "plugin.py",
  "commands": [{ "id": "hello", "title": "Say Hello" }] }
```

```python
def run(command, ctx):            # File > Plug-in Extras; ctx.photos is the selection
    return '%d photos selected' % len(ctx.photos)

def on_export(paths, settings, folder, ctx):   # after every export
    ...

def on_import(photos, ctx):                    # after every import
    ...
```

`ctx` offers `photos`, `catalog`, `home`, `image(photo_id, size)` (RGB array), `import_files(paths)`, `open(path)`, `reveal(path)`, `log(text)`.
See `plugins/contact_sheet` and `plugins/export_manifest`.

</details>

<br>

## 🔄 Updates

**Help → Check for Updates…** keeps Opia current. The first time, it asks whether Opia may go online to check GitHub; nothing about you or your files is sent. If you allow it, it can also check once a day by itself. When there's something new, it shows what changed and offers **Update now**, then restarts. How it updates depends on how you run Opia:

- **Opia.app** (from [Releases](https://github.com/kanisakhpara-devs/Opia-for-Mac/releases)): downloads the new version for your Mac's chip, checks that it really is Opia and that its signature is intact, and swaps it in when Opia closes. It needs Opia to be in a folder you can write to, such as Applications. If you opened it straight from the .dmg, it tells you to drag it to Applications first. Updates don't bring back the "Open Anyway" step.
- **A git copy** (cloned from this repository): pulls the changes with `git pull --ff-only`, then installs any new Python packages from `requirements.txt`. It won't touch a copy with its own changes; it tells you to update that one yourself.
- **A plain folder** (downloaded as a zip): downloads the newest code and copies it over the folder.

Every push to `main` builds Opia.app on GitHub's Macs, both Apple silicon and Intel (`.github/workflows/mac.yml`). Each build is checked before it is published as a release: the engine has to answer, and the real window has to open in Lens without script errors.

## ♿ Accessibility

Everything you can click can also be reached with **Tab** and pressed with **Enter** or **Space**, and a visible ring shows where the keyboard is. **F10** opens the menus, which you can move through with the arrow keys. Dialogs keep the keyboard inside them until they close. Every control has a name for screen readers, and text meets the WCAG 4.5:1 contrast ratio in all four themes. Painting, drawing and dragging on a canvas still need a mouse, pen or touch. More detail is in the [changelog](CHANGELOG.md).

<br>

## 🧭 Honest limits

<details>
<summary><b>Lens</b></summary>

<br>

- **`.opiacat` catalogs** are Opia's own SQLite schema and cannot be opened by other photo applications. Catalogs saved under the earlier `.lrcat` extension (with `.lrdata` previews) are renamed automatically the first time they are opened.
- **Editing is 8-bit sRGB.** RAW files are decoded through LibRaw to 8-bit before editing, so there is less highlight/shadow latitude than a true raw pipeline.
- **Smart Previews** are 2560 px JPEGs (not lossy DNG). They keep photos editable while the originals are offline.
- **Tethering** is a watched folder (point your camera maker's utility at it) plus direct capture from any camera macOS exposes as a webcam. There is no direct USB camera control.
- **CD/DVD**: burning and `.iso` images are only in Opia for Windows. On a Mac, export to a folder and burn it from Finder.
- **Lens profiles**: a few generic profiles are built in; you can save your own or import Adobe `.lcp` files. There is no bundled per-lens database.
- **Camera calibration profiles** are saved looks plus primary adjustments, not DCP camera profiles.
- **Depth range masks** use a depth map estimated from focus, haze and position. Treat it as approximate.
- **Content-Aware Remove** borrows the best-matching nearby patch and blends it. It works well on textures and small objects, less so on large structured areas.
- **Upright** relies on detected straight lines; on scenes without architecture use Guided or Level.
- **DNG conversion** calls Adobe's free DNG Converter, which must be installed separately.
- **Map** tiles come from OpenStreetMap and need an internet connection (a coordinate grid is shown offline). This is the only network access the app makes, apart from FTP uploads you start.
- **Slideshow video** is recorded in real time and has no soundtrack.

</details>

<details>
<summary><b>Imagine</b></summary>

<br>

Editing is 8 bits per channel in sRGB, in the browser engine, so very large pictures (well over 100 megapixels) are slow. There are no layer masks, adjustment layers, layer styles, smart objects, healing or clone brushes, or PSD support. Adjustments and filters change the layer's pixels (undo takes them back).

</details>

<details>
<summary><b>Motion</b></summary>

<br>

No speed changes, keyframed motion, colour correction or effects on video clips, no text animation, and only MP4 output. The preview drops frames on slow machines or with many tracks at once; the export is always frame-accurate. Clips that overlap on the same track (other than a crossfade) both show, the later one on top.

</details>

<details>
<summary><b>Folio</b></summary>

<br>

What you add is drawn into the page, so it looks the same in every viewer, and it cannot be edited again after the saved file is reopened. Existing text in a PDF cannot be rewritten, scanned pages are not read (no OCR), and Cover Up hides what is under it without removing it from the file.

</details>

<details>
<summary><b>On a Mac</b></summary>

<br>

- **Not tried on a real Mac yet.** Builds are checked on GitHub's Macs: the app starts, the window opens in Lens and there are no script errors. Importing, editing, Groove recording, Motion export and the updater haven't been used on a real Mac.
- **Not notarised by Apple**, so the first launch needs **Open Anyway** in System Settings (see [Get started](#-get-started)). Notarising needs a paid Apple Developer account.
- **Two downloads**, one for Apple silicon and one for Intel, because some of the libraries Opia uses don't come as a single universal build.
- **The window is Safari's engine (WebKit)**, where Opia for Windows uses Edge's. Opia was written and checked in Chromium, so some details may differ. Motion plays H.264, HEVC (iPhone video) and VP9 directly; MKV, Ogg and AV1 files get a preview copy first.
- **Pen pressure** from drawing tablets hasn't been tried.
- **Not here:** burning CDs and DVDs, and Windows' "Open with" list of installed editors. Opia looks for Photoshop, Affinity Photo, Pixelmator Pro, GIMP, Krita, Photomator and Preview in Applications, and you can add any other app.

</details>

<br>

## 💬 Need help?

Message Opia's help number on WhatsApp: **[+91 8450973767](https://wa.me/918450973767)**. Messages are preferred; calls may not be answered. The app has it too, under Help › Get Help on WhatsApp.

## 📜 Credits and licences

- **FFmpeg** (Motion) comes from the [imageio-ffmpeg](https://github.com/imageio/imageio-ffmpeg) package. Its Python code is BSD-2-Clause, but the `ffmpeg` program inside it is a separate program under its own licence. Its builds are usually GPL builds (they include x264; run `ffmpeg -version` to check). That is fine for using Opia yourself. If you distribute `Opia.exe` with that ffmpeg inside, the GPL applies to the ffmpeg part. To use a different ffmpeg, put its full path in `config.json` as `"ffmpeg": "C:\\path\\to\\ffmpeg.exe"`; Help › About shows which one is in use.
- **Instrument samples:** Fluid R3 GM SoundFont, CC BY 3.0. See [`web/samples/CREDITS.md`](web/samples/CREDITS.md).
- **Font:** Nunito, SIL Open Font License. See [`web/fonts/OFL.txt`](web/fonts/OFL.txt).
- **Folio:** pypdf (BSD) and pypdfium2 (Apache-2.0 / BSD), chosen over AGPL alternatives.
- The pictures in these screenshots were generated for this page; they are not real photos.

Opia's own code has no licence file yet, so by default all rights are reserved.
