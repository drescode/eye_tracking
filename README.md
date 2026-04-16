# Visual Design and Spending Choice Study

Static research website for GitHub Pages that runs a neuromarketing-style prototype study with browser-based webcam gaze estimation using [WebGazer.js](https://webgazer.cs.brown.edu/) and canvas heatmap rendering with [heatmap.js-fixed](https://cdn.jsdelivr.net/npm/heatmap.js-fixed@2.0.2/build/heatmap.min.js).

The site is implemented with plain HTML, CSS, and JavaScript only. There is no backend. Participant data stays in the browser unless exported manually as JSON or CSV.

## What the project does

- Presents a complete study flow suitable for GitHub Pages:
  - Introduction and informed consent
  - Webcam and privacy notice
  - 9-point calibration
  - 5 stimulus pages with exactly 3 images each
  - Final debrief and export page
- Starts WebGazer only after explicit consent.
- Records gaze predictions per stimulus page with timestamps, page-relative coordinates, validity flags, and choice/timing data.
- Generates heatmap overlays from recorded gaze points.
- Supports individual or aggregated heatmaps in admin mode.
- Supports importing multiple participant JSON files to build combined heatmaps and a lightweight results dashboard.

## Project structure

```text
.
├── .nojekyll
├── index.html
├── README.md
├── assets/
│   └── images/
├── css/
│   └── styles.css
└── js/
    ├── app.js
    ├── calibration.js
    ├── config.js
    ├── data-store.js
    ├── heatmap.js
    └── webgazer-controller.js
```

## Running locally

Because webcam access and browser APIs are most reliable over HTTPS, GitHub Pages is the intended deployment target. For local checks:

1. Serve the folder with a static server instead of opening `index.html` directly.
2. Open the local URL in a modern browser.
3. Grant camera permission when prompted.

Examples:

```bash
python3 -m http.server 8080
```

or

```bash
npx serve .
```

Then open `http://localhost:8080` or the URL printed by the server. If your browser blocks webcam access on plain HTTP, use GitHub Pages or a local HTTPS-capable static server.

## Deploying to GitHub Pages

1. Create a GitHub repository.
2. Copy these files to the repository root.
3. Commit and push to GitHub.
4. In GitHub:
   - Open `Settings`
   - Open `Pages`
   - Set the source to deploy from the main branch root, or from `/docs` if you move the files there
5. Wait for the Pages deployment to finish.
6. Open the published `https://...github.io/...` URL.

`.nojekyll` is included so GitHub Pages serves the static assets without Jekyll processing.

## Study flow

The default participant flow has 8 screens:

1. Introduction and informed consent
2. Calibration
3. Stimulus page 1
4. Stimulus page 2
5. Stimulus page 3
6. Stimulus page 4
7. Stimulus page 5
8. Debrief and export

The pages are implemented in a static single-page application so the project remains simple to host on GitHub Pages while still behaving as a full multi-step study.

## Replacing images

All image paths are centralized in [`js/config.js`](/Users/andre/Documents/New%20project/js/config.js).

Each stimulus page defines exactly 3 options:

```js
{
  id: "stimulus-1",
  options: [
    { id: "s1-a", image: "./assets/images/stimulus-1-a.svg" },
    { id: "s1-b", image: "./assets/images/stimulus-1-b.svg" },
    { id: "s1-c", image: "./assets/images/stimulus-1-c.svg" }
  ]
}
```

To replace the placeholders:

1. Add your final images into `assets/images/`.
2. Update the `image` values in `js/config.js`.
3. Keep exactly 3 options per stimulus page so the layout and tracking assumptions stay aligned.
4. Prefer fixed dimensions or consistent aspect ratios to avoid layout shifts.

## Changing the page count from 5 to 8

Edit the `stimulusPages` array in [`js/config.js`](/Users/andre/Documents/New%20project/js/config.js).

- To use 5 pages, keep 5 entries.
- To expand to 6, 7, or 8 stimulus pages, add more entries with the same shape.
- `TOTAL_STEPS` is computed from the array length, so the progress indicator updates automatically.
- Each added page must still include exactly 3 options/images.

## Data captured

The exported JSON session includes:

- `participantId`
- `consent.timestamp`
- `deviceInfo`
- calibration clicks and completion time
- per-page records with:
  - `pageId`
  - `imageSetId`
  - `selection`
  - `timeOnPageMs`
  - `gazePoints`
- tracking status changes and errors

Each gaze point stores:

- timestamp
- page ID
- validity flag
- raw coordinates
- smoothed coordinates
- page-relative coordinates
- page width and height at capture time
- in-bounds state

## Data export

The final page provides three export formats:

- JSON:
  - Complete participant session record
- CSV:
  - One summary row per stimulus page
- Heatmap JSON:
  - Page-grouped gaze data intended for analysis and heatmap rendering

The app also uses `localStorage` during runtime for:

- the current participant session
- imported participant sessions for admin aggregation

## Admin mode and aggregated heatmaps

Open the site with `?admin=1` to enable hidden researcher tools:

```text
https://your-name.github.io/your-repo/?admin=1
```

Admin mode adds:

- raw gaze point overlay
- live gaze dot
- individual heatmap mode
- aggregated heatmap mode
- participant JSON import
- stimulus page preview
- lightweight results dashboard with:
  - participant count
  - most selected image per page
  - average dwell time per page

To aggregate heatmaps:

1. Run participant sessions and export JSON from each browser session.
2. Open the site in admin mode.
3. Import multiple JSON files from the admin drawer.
4. Choose a page and switch heatmap mode to `Aggregated participants`.
5. Preview the selected page to render the combined heatmap.

## Central configuration

Study content is designed to be editable from [`js/config.js`](/Users/andre/Documents/New%20project/js/config.js), including:

- study title and subtitle
- introduction text
- consent wording
- calibration settings
- minimum page viewing time
- page questions
- image paths
- per-page labels and prompts

## Technical notes

- Framework-free static site suitable for GitHub Pages.
- No backend or server-only features.
- WebGazer is loaded from the official Brown-hosted script URL.
- Heatmaps are rendered client-side with a CDN-hosted heatmap library.
- Layout uses fixed-stage positioning and preloaded images to reduce alignment drift.

## Limitations

Browser-based webcam eye tracking is approximate and sensitive to:

- lighting quality
- camera position
- browser support
- participant movement
- screen size and zoom
- calibration quality

This prototype should be treated as a research or pilot tool, not as a substitute for dedicated eye-tracking hardware.

## Consent and privacy considerations

- Webcam tracking does not begin until the participant explicitly consents.
- Participants can decline before tracking begins.
- The site clearly states that attention is estimated from webcam input.
- Data remains client-side unless manually exported.
- If camera permission is denied or WebGazer fails to initialize, the study does not proceed.

## Future extension points

The code is structured so a later backend integration can be added without changing the participant flow. Likely next steps:

- upload exported JSON to Firebase or a custom API
- push summary rows to Google Sheets
- add researcher authentication for admin mode
- synchronize aggregated datasets across devices
