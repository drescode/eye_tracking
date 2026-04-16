import { STUDY_CONFIG, TOTAL_STEPS } from "./config.js?v=20260416h";
import {
  appendGazePoint,
  appendTrackingStatus,
  beginStimulusPage,
  buildHeatmapExport,
  buildSessionJson,
  buildSummaryCsv,
  completeCalibration,
  completeStimulusPage,
  computeAggregateStats,
  createSession,
  getAllSessions,
  getImportedSessions,
  loadCurrentSession,
  markExportTime,
  markRemoteSubmissionError,
  markRemoteSubmissionPending,
  markRemoteSubmissionSuccess,
  markStudyCompleted,
  markTrackingDenied,
  markTrackingInitialized,
  parseImportedJson,
  resetCurrentSession,
  saveCurrentSession,
  updateCalibrationPoint,
  updateConsent,
  updateStimulusSelection,
  upsertImportedSessions,
} from "./data-store.js?v=20260416h";
import { WebgazerController } from "./webgazer-controller.js?v=20260416h";
import { CalibrationSequence } from "./calibration.js?v=20260416h";
import { HeatmapRenderer } from "./heatmap.js?v=20260416h";
import {
  getSupabaseConfigurationMessage,
  isSupabaseConfigured,
  submitSessionToSupabase,
} from "./supabase-store.js?v=20260416h";

const query = new URLSearchParams(window.location.search);
const state = {
  adminMode: query.get("admin") === "1",
  view: "intro",
  stimulusIndex: 0,
  previewPageId: null,
  previewReturnView: "final",
  previewReturnStimulusIndex: 0,
  session: loadCurrentSession(STUDY_CONFIG),
  importedSessions: getImportedSessions(),
  activeStimulusPageId: null,
  currentPageStartedAt: 0,
  currentSelection: null,
  gateTimer: null,
  gateRemainingMs: STUDY_CONFIG.stimulus.minimumViewingTimeMs,
  remoteSubmissionInFlight: false,
  debugRefreshTimer: null,
  debug: {
    showLiveDot: false,
    showRawPoints: false,
    heatmapMode: "none",
    selectedSessionId: "current",
    selectedPageId: STUDY_CONFIG.stimulusPages[0].id,
  },
};

const app = document.getElementById("app");
const adminDrawer = document.getElementById("admin-drawer");
const titleEl = document.getElementById("study-title");
const subtitleEl = document.getElementById("study-subtitle");
const progressLabelEl = document.getElementById("progress-label");
const pageLabelEl = document.getElementById("page-label");
const progressBarEl = document.getElementById("progress-bar");
const statusEl = document.getElementById("tracking-status");
const alertEl = document.getElementById("global-alert");

const heatmapRenderer = new HeatmapRenderer();
const webgazerController = new WebgazerController({
  sampleIntervalMs: STUDY_CONFIG.tracking.sampleIntervalMs,
  smoothingFactor: STUDY_CONFIG.tracking.smoothingFactor,
  missingFaceTimeoutMs: STUDY_CONFIG.tracking.missingFaceTimeoutMs,
  onSample: handleGazeSample,
  onStatusChange: handleTrackingStatus,
  onError: handleTrackingError,
});

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function setAlert(message = "", type = "error") {
  if (!message) {
    alertEl.classList.add("hidden");
    alertEl.textContent = "";
    delete alertEl.dataset.type;
    return;
  }

  alertEl.classList.remove("hidden");
  alertEl.textContent = message;
  alertEl.dataset.type = type;
}

function updateHeader() {
  titleEl.textContent = STUDY_CONFIG.studyTitle;
  subtitleEl.textContent = STUDY_CONFIG.studySubtitle;

  const stepData = getStepData();
  progressLabelEl.textContent = `Step ${stepData.current} of ${TOTAL_STEPS}`;
  pageLabelEl.textContent = stepData.label;
  progressBarEl.style.width = `${(stepData.current / TOTAL_STEPS) * 100}%`;
}

function getStepData() {
  if (state.view === "intro" || state.view === "declined") {
    return { current: 1, label: "Introduction" };
  }

  if (state.view === "calibration") {
    return { current: 2, label: "Calibration" };
  }

  if (state.view === "stimulus") {
    return {
      current: 3 + state.stimulusIndex,
      label: `Stimulus ${state.stimulusIndex + 1}`,
    };
  }

  if (state.view === "preview") {
    const previewIndex = STUDY_CONFIG.stimulusPages.findIndex(
      (page) => page.id === state.previewPageId,
    );
    return {
      current: Math.max(3, previewIndex + 3),
      label: "Admin Preview",
    };
  }

  return {
    current: TOTAL_STEPS,
    label: state.adminMode ? "Debrief and Dashboard" : "Debrief",
  };
}

function handleTrackingStatus(status) {
  const className =
    status === "tracking active" || status === "webcam active"
      ? "status-pill status-pill--active"
      : status === "calibrating" || status === "face not detected"
        ? "status-pill status-pill--warning"
        : "status-pill status-pill--idle";

  statusEl.className = className;
  statusEl.textContent = status;
  state.session = appendTrackingStatus(state.session, status);
}

function handleTrackingError(error) {
  const baseMessage =
    error instanceof Error ? error.message : "WebGazer failed to initialize.";
  const browserHint = /safari/i.test(navigator.userAgent) && !/chrome|chromium|crios/i.test(navigator.userAgent)
    ? " Safari is less reliable for WebGazer; Chrome or Edge on desktop is recommended."
    : "";
  const message = `${baseMessage}${browserHint}`;
  console.error("WebGazer startup error:", error);
  statusEl.className = "status-pill status-pill--danger";
  statusEl.textContent = "tracking unavailable";
}

function downloadTextFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function formatDuration(ms) {
  if (!ms) {
    return "0.0s";
  }
  return `${(ms / 1000).toFixed(1)}s`;
}

function getRemoteSubmissionUiState() {
  const submission = state.session.remoteSubmission || {};

  if (!isSupabaseConfigured(STUDY_CONFIG)) {
    return {
      label: "Not configured",
      detail: getSupabaseConfigurationMessage(STUDY_CONFIG),
      canRetry: false,
    };
  }

  if (state.remoteSubmissionInFlight || submission.status === "uploading") {
    return {
      label: "Uploading now",
      detail: "Participant data is being sent to your Supabase project automatically.",
      canRetry: false,
    };
  }

  if (submission.status === "submitted") {
    return {
      label: submission.duplicate ? "Already submitted" : "Upload complete",
      detail: submission.duplicate
        ? "This participant session was already present in Supabase, so it was not inserted twice."
        : `Submitted automatically${submission.submittedAt ? ` on ${new Date(submission.submittedAt).toLocaleString()}` : ""}.`,
      canRetry: false,
    };
  }

  if (submission.status === "failed") {
    return {
      label: "Upload failed",
      detail:
        submission.lastError ||
        "Supabase submission failed. Download the JSON backup or retry the upload.",
      canRetry: true,
    };
  }

  return {
    label: "Ready to submit",
    detail: "This page will submit the participant session automatically.",
    canRetry: true,
  };
}

async function uploadSessionToSupabase(options = {}) {
  const { manual = false } = options;

  if (!isSupabaseConfigured(STUDY_CONFIG)) {
    const message = getSupabaseConfigurationMessage(STUDY_CONFIG);
    if (manual) {
      setAlert(message);
    }
    return;
  }

  if (state.remoteSubmissionInFlight) {
    return;
  }

  state.remoteSubmissionInFlight = true;
  state.session = markRemoteSubmissionPending(state.session);
  if (state.view === "final") {
    render();
  }

  try {
    const result = await submitSessionToSupabase(STUDY_CONFIG, state.session);
    state.session = markRemoteSubmissionSuccess(state.session, {
      duplicate: result.duplicate,
    });
    state.remoteSubmissionInFlight = false;
    if (state.view === "final") {
      render();
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Supabase submission failed.";
    state.session = markRemoteSubmissionError(state.session, message);
    state.remoteSubmissionInFlight = false;
    if (manual) {
      setAlert(message);
    }
    if (state.view === "final") {
      render();
    }
  }
}

function getCurrentStimulus() {
  return STUDY_CONFIG.stimulusPages[state.stimulusIndex];
}

function getSelectedSession() {
  if (state.debug.selectedSessionId === "current") {
    return state.session;
  }

  return (
    state.importedSessions.find(
      (session) => session.participantId === state.debug.selectedSessionId,
    ) || null
  );
}

function getPageRecord(session, pageId) {
  return session?.pages?.[pageId] || null;
}

function getPagePointsForSession(session, pageId) {
  return getPageRecord(session, pageId)?.gazePoints || [];
}

function getAggregatedPoints(pageId) {
  return getAllSessions(state.session).flatMap(
    (session) => getPageRecord(session, pageId)?.gazePoints || [],
  );
}

function scheduleDebugRefresh() {
  window.clearInterval(state.debugRefreshTimer);
  state.debugRefreshTimer = window.setInterval(refreshDebugOverlay, 500);
}

function clearGateTimer() {
  window.clearInterval(state.gateTimer);
  state.gateTimer = null;
}

function preloadImages() {
  STUDY_CONFIG.stimulusPages.forEach((page) => {
    page.options.forEach((option) => {
      const image = new Image();
      image.src = option.image;
    });
  });
}

async function waitForDependency(name, timeoutMs = 6000) {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const tick = () => {
      if (window[name]) {
        resolve(window[name]);
        return;
      }

      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error(`${name} did not load in time.`));
        return;
      }

      window.setTimeout(tick, 120);
    };

    tick();
  });
}

async function initializeTrackingAfterConsent() {
  await waitForDependency("webgazer");
  await waitForDependency("h337");
  await webgazerController.initialize();
  state.session = markTrackingInitialized(state.session);
}

function renderIntro() {
  const intro = STUDY_CONFIG.intro;
  app.innerHTML = `
    <section class="hero-grid">
      <article class="hero-card stack">
        <div>
          <p class="eyebrow">${escapeHtml(STUDY_CONFIG.researcherLabel)}</p>
          <h2>${escapeHtml(STUDY_CONFIG.studyTitle)}</h2>
          <p class="lead">${escapeHtml(intro.lead)}</p>
        </div>
        <div class="info-strip">
          <div class="info-chip">
            <strong>Desktop First</strong>
            <span>${escapeHtml(intro.webcamNotice)}</span>
          </div>
          <div class="info-chip">
            <strong>Tracking Method</strong>
            <span>WebGazer.js estimates on-screen attention from a standard webcam.</span>
          </div>
          <div class="info-chip">
            <strong>Storage</strong>
            <span>Data remains in-browser unless you choose to export JSON or CSV.</span>
          </div>
        </div>
        <div class="notice-card">
          <h3>Study Information</h3>
          <ul class="list-block">
            ${intro.studyInformation
              .map((item) => `<li>${escapeHtml(item)}</li>`)
              .join("")}
          </ul>
        </div>
      </article>

      <aside class="panel stack">
        <div class="notice-card">
          <h3>Webcam and Privacy Notice</h3>
          <p>${escapeHtml(intro.privacyNotice)}</p>
          <p>${escapeHtml(intro.consentCopy)}</p>
        </div>

        <div class="consent-box stack">
          <div class="consent-row">
            <input id="consent-checkbox" type="checkbox" />
            <label for="consent-checkbox">${escapeHtml(
              STUDY_CONFIG.consent.checkboxLabel,
            )}</label>
          </div>
          <div class="button-row">
            <button id="continue-button" class="button" type="button" disabled>
              ${escapeHtml(STUDY_CONFIG.consent.continueLabel)}
            </button>
            <button id="decline-button" class="ghost-button" type="button">
              ${escapeHtml(STUDY_CONFIG.consent.declineLabel)}
            </button>
            <button id="new-session-button" class="secondary-button" type="button">
              Start a fresh browser session
            </button>
          </div>
          <p class="panel-muted">
            Participation only proceeds after explicit consent. WebGazer is not initialized before that point.
          </p>
        </div>
      </aside>
    </section>
  `;

  const checkbox = document.getElementById("consent-checkbox");
  const continueButton = document.getElementById("continue-button");
  const declineButton = document.getElementById("decline-button");
  const newSessionButton = document.getElementById("new-session-button");

  checkbox.addEventListener("change", () => {
    continueButton.disabled = !checkbox.checked;
  });

  continueButton.addEventListener("click", async () => {
    continueButton.disabled = true;
    continueButton.textContent = "Requesting webcam access...";
    setAlert("");

    if (state.session.status === "completed" || state.session.status === "declined") {
      state.session = resetCurrentSession(STUDY_CONFIG);
    }

    try {
      state.session = updateConsent(state.session, true);
      await initializeTrackingAfterConsent();
      state.view = "calibration";
      render();
    } catch (error) {
      console.error("Study startup failed:", error);
      let message = "Study startup failed.";

      if (error?.name === "NotAllowedError" || error?.name === "PermissionDeniedError") {
        message = "Camera access was denied. Please allow webcam permission and reload.";
      } else if (error?.name === "NotFoundError") {
        message = "No webcam was found on this device.";
      } else if (error?.name === "NotReadableError") {
        message = "The webcam is busy in another app or browser tab.";
      } else if (error instanceof Error && error.message) {
        message = error.message;
      } else if (error) {
        message = String(error);
      }

      state.session = markTrackingDenied(state.session, message);
      continueButton.disabled = false;
      continueButton.textContent = STUDY_CONFIG.consent.continueLabel;
      setAlert(message);
      render();
    }
  });

  declineButton.addEventListener("click", () => {
    state.session = updateConsent(state.session, false);
    state.view = "declined";
    render();
  });

  newSessionButton.addEventListener("click", () => {
    state.session = resetCurrentSession(STUDY_CONFIG);
    setAlert("");
    render();
  });
}

function renderDeclined() {
  app.innerHTML = `
    <section class="hero-grid">
      <article class="hero-card stack">
        <div>
          <p class="eyebrow">Participation Ended</p>
          <h2>Exit Message</h2>
          <p class="lead">${escapeHtml(STUDY_CONFIG.intro.declineMessage)}</p>
        </div>
        <div class="exit-card">
          <p>No gaze tracking was started because participation was declined before consent and initialization.</p>
        </div>
      </article>

      <aside class="panel stack">
        <button id="return-home" class="button" type="button">Return to introduction</button>
      </aside>
    </section>
  `;

  document.getElementById("return-home").addEventListener("click", () => {
    state.view = "intro";
    render();
  });
}

function renderCalibration() {
  app.innerHTML = `
    <section class="study-frame">
      <article class="hero-card stack">
        <div>
          <p class="eyebrow">Calibration Step</p>
          <h2>${escapeHtml(STUDY_CONFIG.calibration.title)}</h2>
          <p class="lead">${escapeHtml(STUDY_CONFIG.calibration.instructions)}</p>
        </div>
        <div class="legend">
          <span><i style="background:#875a38"></i> Active point</span>
          <span><i style="background:#2f6f4f"></i> Completed point</span>
        </div>
      </article>

      <div id="calibration-root" class="calibration-layout"></div>
    </section>
  `;

  webgazerController.setCalibrationMode(true);

  const calibration = new CalibrationSequence(STUDY_CONFIG.calibration);
  calibration.mount(document.getElementById("calibration-root"), {
    onProgress: ({ pointId, clicks }) => {
      state.session = updateCalibrationPoint(state.session, pointId, clicks);
    },
    onComplete: () => {
      state.session = completeCalibration(state.session);
      webgazerController.setCalibrationMode(false);
      window.setTimeout(() => {
        state.view = "stimulus";
        state.stimulusIndex = 0;
        render();
      }, 900);
    },
  });
}

function buildStimulusCard(option, selectedId, disabled = false) {
  const selected = selectedId === option.id;
  return `
    <article class="stimulus-card ${selected ? "is-selected" : ""}" data-option-id="${escapeHtml(
      option.id,
    )}">
      <div class="stimulus-card__figure">
        <img
          src="${escapeHtml(option.image)}"
          alt="${escapeHtml(option.title)}"
          width="800"
          height="1000"
          loading="eager"
        />
      </div>
      <button class="choice-button" type="button" ${disabled ? "disabled" : ""}>
        ${selected ? "Selected" : `Choose ${escapeHtml(option.label)}`}
      </button>
    </article>
  `;
}

function attachStimulusInteractions(page, previewMode = false) {
  const stage = document.getElementById("stimulus-stage");
  if (!stage) {
    return;
  }

  if (!previewMode) {
    const cards = Array.from(stage.querySelectorAll(".stimulus-card"));
    cards.forEach((card) => {
      card.addEventListener("click", () => {
        const option = page.options.find(
          (entry) => entry.id === card.dataset.optionId,
        );
        if (!option) {
          return;
        }
        state.currentSelection = option.id;
        state.session = updateStimulusSelection(state.session, page.id, option);
        updateStimulusSelectionUi(stage, page, option.id);
      });
    });

    const nextButton = document.getElementById("next-button");
    if (nextButton) {
      nextButton.addEventListener("click", handleNextStimulus);
    }
  }

  const rectGetter = () => stage.getBoundingClientRect();
  webgazerController.setPageContext(page.id, rectGetter);
  refreshDebugOverlay();
}

function updateStimulusSelectionUi(stage, page, selectedId) {
  const cards = Array.from(stage.querySelectorAll(".stimulus-card"));
  cards.forEach((card) => {
    const button = card.querySelector(".choice-button");
    const selected = card.dataset.optionId === selectedId;
    const option = page.options.find((entry) => entry.id === card.dataset.optionId);
    card.classList.toggle("is-selected", selected);
    if (button) {
      button.textContent = selected
        ? "Selected"
        : `Choose ${option?.label || "option"}`;
    }
  });

  const nextButton = document.getElementById("next-button");
  if (nextButton) {
    nextButton.textContent = "Next page";
    nextButton.disabled =
      state.gateRemainingMs > 0 ||
      (STUDY_CONFIG.stimulus.requireSelectionToAdvance && !selectedId);
  }
}

function startStimulusPageTracking(page) {
  if (state.activeStimulusPageId === page.id) {
    return;
  }

  clearGateTimer();
  state.activeStimulusPageId = page.id;
  state.currentPageStartedAt = Date.now();
  state.currentSelection = state.session.pages?.[page.id]?.selection || null;
  state.session = beginStimulusPage(state.session, page);
  state.gateRemainingMs = STUDY_CONFIG.stimulus.minimumViewingTimeMs;
  state.gateTimer = window.setInterval(() => {
    const elapsed = Date.now() - state.currentPageStartedAt;
    state.gateRemainingMs = Math.max(
      0,
      STUDY_CONFIG.stimulus.minimumViewingTimeMs - elapsed,
    );
    const button = document.getElementById("next-button");
    const timerLabel = document.getElementById("timer-label");
    if (timerLabel) {
      timerLabel.textContent =
        state.gateRemainingMs > 0
          ? `Minimum viewing time remaining: ${(state.gateRemainingMs / 1000).toFixed(1)}s`
          : "Minimum viewing time satisfied";
    }
    if (button) {
      button.disabled =
        state.gateRemainingMs > 0 ||
        (STUDY_CONFIG.stimulus.requireSelectionToAdvance && !state.currentSelection);
    }
  }, 100);
}

function renderStimulus(previewMode = false) {
  const page = previewMode
    ? STUDY_CONFIG.stimulusPages.find((entry) => entry.id === state.previewPageId)
    : getCurrentStimulus();

  if (!page) {
    state.view = "final";
    render();
    return;
  }

  if (!previewMode) {
    startStimulusPageTracking(page);
  }

  const selectedId =
    state.currentSelection || state.session.pages?.[page.id]?.selection || null;
  const selectionSatisfied =
    previewMode ||
    !STUDY_CONFIG.stimulus.requireSelectionToAdvance ||
    Boolean(selectedId);
  const timeSatisfied =
    previewMode ||
    state.gateRemainingMs <= 0 ||
    STUDY_CONFIG.stimulus.minimumViewingTimeMs === 0;
  const canAdvance =
    previewMode || (selectionSatisfied && timeSatisfied);

  app.innerHTML = `
    <section class="study-frame">
      <div id="stimulus-stage" class="stimulus-stage">
        <div class="stimulus-stage__header">
          <div class="stimulus-stage__meta">
            <p class="stage-kicker">${previewMode ? "Admin Preview" : escapeHtml(page.title)}</p>
          </div>
          <div class="timing-chip">${escapeHtml(page.imageSetId)}</div>
        </div>

        <div class="stimulus-grid">
          ${page.options
            .map((option) => buildStimulusCard(option, selectedId, previewMode))
            .join("")}
        </div>

        <div class="question-block">
          <span class="question-label">Selection Required</span>
          <p><strong>Select one image to continue.</strong></p>
          <div class="timing-row">
            <span id="timer-label" class="timing-chip">
              ${
                previewMode
                  ? "Preview mode"
                  : `Minimum viewing time remaining: ${(
                      STUDY_CONFIG.stimulus.minimumViewingTimeMs / 1000
                    ).toFixed(1)}s`
              }
            </span>
            ${
              previewMode
                ? `<button id="leave-preview" class="ghost-button" type="button">Back to dashboard</button>`
                : `<button id="next-button" class="button" type="button" ${
                    canAdvance ? "" : "disabled"
                  }>
                     Next page
                   </button>`
            }
          </div>
        </div>
      </div>
    </section>
  `;

  if (previewMode) {
    document.getElementById("leave-preview").addEventListener("click", () => {
      state.view = state.previewReturnView;
      state.stimulusIndex = state.previewReturnStimulusIndex;
      render();
    });
  }

  attachStimulusInteractions(page, previewMode);
}

function handleNextStimulus() {
  const page = getCurrentStimulus();
  if (!page) {
    return;
  }

  const elapsed = Date.now() - state.currentPageStartedAt;
  if (elapsed < STUDY_CONFIG.stimulus.minimumViewingTimeMs) {
    return;
  }

  if (STUDY_CONFIG.stimulus.requireSelectionToAdvance && !state.currentSelection) {
    return;
  }

  clearGateTimer();
  state.activeStimulusPageId = null;
  state.session = completeStimulusPage(state.session, page.id, elapsed);
  webgazerController.clearPageContext();

  if (state.stimulusIndex < STUDY_CONFIG.stimulusPages.length - 1) {
    state.stimulusIndex += 1;
    render();
    return;
  }

  state.session = markStudyCompleted(state.session);
  state.view = "final";
  webgazerController.stop();
  render();
}

function renderFinal() {
  const sessionPages = STUDY_CONFIG.stimulusPages.map((page) => ({
    page,
    record: state.session.pages?.[page.id] || null,
  }));
  const stats = computeAggregateStats(getAllSessions(state.session), STUDY_CONFIG);
  const remoteSubmissionUi = getRemoteSubmissionUiState();
  const submissionConfigured = isSupabaseConfigured(STUDY_CONFIG);

  app.innerHTML = `
    <section class="final-grid">
      <article class="hero-card stack">
        <div>
          <p class="eyebrow">Study Complete</p>
          <h2>${escapeHtml(STUDY_CONFIG.debrief.title)}</h2>
          <p class="lead">${escapeHtml(STUDY_CONFIG.debrief.copy)}</p>
          <p>${escapeHtml(STUDY_CONFIG.debrief.reminder)}</p>
        </div>

        <div class="summary-card">
          <h3>Participant Summary</h3>
          <div class="metric-grid">
            <div class="metric">
              <span class="panel-muted">Participant ID</span>
              <strong>${escapeHtml(state.session.participantId.slice(0, 8))}</strong>
            </div>
            <div class="metric">
              <span class="panel-muted">Stimulus pages</span>
              <strong>${sessionPages.filter((entry) => entry.record).length}</strong>
            </div>
            <div class="metric">
              <span class="panel-muted">Valid gaze samples</span>
              <strong>${sessionPages.reduce(
                (total, entry) => total + (entry.record?.validSampleCount || 0),
                0,
              )}</strong>
            </div>
          </div>
        </div>

        <div class="dashboard-card">
          <h3>Recorded Pages</h3>
          <table class="results-table">
            <thead>
              <tr>
                <th>Page</th>
                <th>Selection</th>
                <th>Time</th>
                <th>Samples</th>
              </tr>
            </thead>
            <tbody>
              ${sessionPages
                .map(({ page, record }) => {
                  const label =
                    page.options.find((option) => option.id === record?.selection)?.label ||
                    "No selection";
                  return `
                    <tr>
                      <td>${escapeHtml(page.title)}</td>
                      <td>${escapeHtml(label)}</td>
                      <td>${escapeHtml(formatDuration(record?.timeOnPageMs || 0))}</td>
                      <td>${escapeHtml(
                        String((record?.validSampleCount || 0) + (record?.invalidSampleCount || 0)),
                      )}</td>
                    </tr>
                  `;
                })
                .join("")}
            </tbody>
          </table>
        </div>
      </article>

      <aside class="panel stack">
        <div class="upload-card">
          <h3>Automatic Submission</h3>
          <p>${
            submissionConfigured
              ? "Participant data is uploaded automatically to your Supabase project when this page loads."
              : "Automatic upload is disabled until you add your Supabase URL, anon key, and table in js/config.js and run the SQL schema in supabase/schema.sql."
          }</p>
          <div class="pill">${escapeHtml(remoteSubmissionUi.label)}</div>
          <p class="panel-muted" style="margin-top:12px;">${escapeHtml(
            remoteSubmissionUi.detail,
          )}</p>
          ${
            remoteSubmissionUi.canRetry
              ? `<div class="button-row"><button id="retry-upload" class="button" type="button">${
                  submissionConfigured ? "Retry upload" : "Show setup reminder"
                }</button></div>`
              : ""
          }
        </div>

        <div class="upload-card">
          <h3>Export Study Data</h3>
          <p>Download the current participant session as a backup copy in JSON, CSV summary, or heatmap-ready JSON format.</p>
          <div class="export-row">
            <button id="export-json" class="button" type="button">Download JSON</button>
            <button id="export-csv" class="secondary-button" type="button">Download CSV</button>
            <button id="export-heatmap" class="ghost-button" type="button">Heatmap JSON</button>
          </div>
        </div>

        ${
          state.adminMode
            ? `
              <div class="upload-card">
                <h3>Session Control</h3>
                <p>You can start a fresh browser session for the next participant after exporting the current data.</p>
                <div class="button-row">
                  <button id="restart-study" class="button" type="button">Start new participant session</button>
                </div>
              </div>
            `
            : ""
        }

        ${
          state.adminMode
            ? `
              <div class="upload-card">
                <h3>Dashboard Snapshot</h3>
                <p>${escapeHtml(STUDY_CONFIG.admin.importHelp)}</p>
                <div class="metric-grid">
                  <div class="metric">
                    <span class="panel-muted">Participants</span>
                    <strong>${stats.participantCount}</strong>
                  </div>
                  <div class="metric">
                    <span class="panel-muted">Completed</span>
                    <strong>${stats.completedSessions}</strong>
                  </div>
                  <div class="metric">
                    <span class="panel-muted">Tracked pages</span>
                    <strong>${stats.perPage.length}</strong>
                  </div>
                </div>
                <div class="dashboard-table" style="margin-top:16px;">
                  <table class="results-table">
                    <thead>
                      <tr>
                        <th>Page</th>
                        <th>Most selected</th>
                        <th>Avg dwell</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${stats.perPage
                        .map(
                          (pageStat) => `
                            <tr>
                              <td>${escapeHtml(pageStat.pageTitle)}</td>
                              <td>${escapeHtml(pageStat.topChoiceLabel)} <span class="panel-muted">${escapeHtml(pageStat.topChoiceTitle)}</span></td>
                              <td>${escapeHtml(formatDuration(pageStat.averageTimeMs))}</td>
                            </tr>
                          `,
                        )
                        .join("")}
                    </tbody>
                  </table>
                </div>
              </div>
            `
            : ""
        }
      </aside>
    </section>
  `;

  document.getElementById("export-json").addEventListener("click", () => {
    downloadTextFile(
      `${state.session.participantId}.json`,
      buildSessionJson(state.session),
      "application/json",
    );
    state.session = markExportTime(state.session, "json");
  });

  document.getElementById("export-csv").addEventListener("click", () => {
    downloadTextFile(
      `${state.session.participantId}-summary.csv`,
      buildSummaryCsv(state.session, STUDY_CONFIG),
      "text/csv;charset=utf-8",
    );
    state.session = markExportTime(state.session, "csv");
  });

  document.getElementById("export-heatmap").addEventListener("click", () => {
    downloadTextFile(
      `${state.session.participantId}-heatmaps.json`,
      buildHeatmapExport(state.session, STUDY_CONFIG),
      "application/json",
    );
    state.session = markExportTime(state.session, "heatmap");
  });

  const retryUploadButton = document.getElementById("retry-upload");
  if (retryUploadButton) {
    retryUploadButton.addEventListener("click", () => {
      uploadSessionToSupabase({
        manual: true,
      });
    });
  }

  const restartButton = document.getElementById("restart-study");
  if (restartButton) {
    restartButton.addEventListener("click", () => {
      clearGateTimer();
      heatmapRenderer.clear();
      state.session = createSession(STUDY_CONFIG);
      state.session = saveCurrentSession(state.session);
      state.activeStimulusPageId = null;
      state.view = "intro";
      state.stimulusIndex = 0;
      setAlert("");
      render();
    });
  }

  if (
    STUDY_CONFIG.remoteStorage?.autoSubmitOnDebrief &&
    submissionConfigured &&
    !state.remoteSubmissionInFlight &&
    state.session.remoteSubmission?.status === "idle"
  ) {
    uploadSessionToSupabase();
  }
}

function renderAdminDrawer() {
  if (!state.adminMode) {
    adminDrawer.classList.add("hidden");
    adminDrawer.innerHTML = "";
    return;
  }

  const selectedSession = getSelectedSession();
  const sessions = [
    { participantId: "current", label: "Current browser session" },
    ...state.importedSessions.map((session) => ({
      participantId: session.participantId,
      label: `${session.participantId.slice(0, 8)}${session.status === "completed" ? " (completed)" : ""}`,
    })),
  ];

  adminDrawer.classList.remove("hidden");
  adminDrawer.innerHTML = `
    <div>
      <p class="eyebrow">Admin Mode</p>
      <h3>Debug and Heatmaps</h3>
      <p class="panel-muted">Hidden from participants by default. Toggle live gaze, raw points, individual heatmaps, or aggregated overlays with the <code>?admin=1</code> query parameter.</p>
    </div>

    <div class="stack">
      <label><input id="toggle-live-dot" type="checkbox" ${
        state.debug.showLiveDot ? "checked" : ""
      } /> Show live gaze dot</label>
      <label><input id="toggle-raw-points" type="checkbox" ${
        state.debug.showRawPoints ? "checked" : ""
      } /> Show raw gaze points</label>
      <label><input id="toggle-heatmap" type="checkbox" ${
        state.debug.heatmapMode !== "none" ? "checked" : ""
      } /> Show heatmap overlay</label>
    </div>

    <div class="stack">
      <label for="heatmap-mode">Heatmap mode</label>
      <select id="heatmap-mode">
        <option value="none" ${state.debug.heatmapMode === "none" ? "selected" : ""}>No heatmap</option>
        <option value="individual" ${state.debug.heatmapMode === "individual" ? "selected" : ""}>Individual participant</option>
        <option value="aggregated" ${state.debug.heatmapMode === "aggregated" ? "selected" : ""}>Aggregated participants</option>
      </select>
    </div>

    <div class="stack">
      <label for="session-picker">Participant dataset</label>
      <select id="session-picker">
        ${sessions
          .map(
            (entry) => `
              <option value="${escapeHtml(entry.participantId)}" ${
                state.debug.selectedSessionId === entry.participantId ? "selected" : ""
              }>
                ${escapeHtml(entry.label)}
              </option>
            `,
          )
          .join("")}
      </select>
    </div>

    <div class="stack">
      <label for="page-picker">Stimulus page</label>
      <select id="page-picker">
        ${STUDY_CONFIG.stimulusPages
          .map(
            (page) => `
              <option value="${escapeHtml(page.id)}" ${
                state.debug.selectedPageId === page.id ? "selected" : ""
              }>
                ${escapeHtml(page.title)}
              </option>
            `,
          )
          .join("")}
      </select>
    </div>

    <div class="toolbar-row">
      <button id="preview-page-button" class="button" type="button">Preview selected page</button>
      <button id="clear-overlays-button" class="ghost-button" type="button">Clear overlays</button>
    </div>

    <div class="upload-card">
      <h3>Import participant JSON</h3>
      <p>${escapeHtml(STUDY_CONFIG.admin.importHelp)}</p>
      <input id="import-files" type="file" accept=".json,application/json" multiple />
    </div>

    <div class="upload-card">
      <h3>Selection Snapshot</h3>
      <p class="panel-muted">
        Selected session: ${escapeHtml(
          selectedSession?.participantId || "none",
        )}<br />
        Available imported sessions: ${state.importedSessions.length}
      </p>
    </div>
  `;

  document.getElementById("toggle-live-dot").addEventListener("change", (event) => {
    state.debug.showLiveDot = event.target.checked;
    refreshDebugOverlay();
  });

  document.getElementById("toggle-raw-points").addEventListener("change", (event) => {
    state.debug.showRawPoints = event.target.checked;
    refreshDebugOverlay();
  });

  document.getElementById("toggle-heatmap").addEventListener("change", (event) => {
    if (!event.target.checked) {
      state.debug.heatmapMode = "none";
      document.getElementById("heatmap-mode").value = "none";
    } else if (state.debug.heatmapMode === "none") {
      state.debug.heatmapMode = "individual";
      document.getElementById("heatmap-mode").value = "individual";
    }
    refreshDebugOverlay();
  });

  document.getElementById("heatmap-mode").addEventListener("change", (event) => {
    state.debug.heatmapMode = event.target.value;
    document.getElementById("toggle-heatmap").checked =
      state.debug.heatmapMode !== "none";
    refreshDebugOverlay();
  });

  document.getElementById("session-picker").addEventListener("change", (event) => {
    state.debug.selectedSessionId = event.target.value;
    refreshDebugOverlay();
  });

  document.getElementById("page-picker").addEventListener("change", (event) => {
    state.debug.selectedPageId = event.target.value;
    refreshDebugOverlay();
  });

  document
    .getElementById("preview-page-button")
    .addEventListener("click", () => {
      state.previewReturnView = state.view;
      state.previewReturnStimulusIndex = state.stimulusIndex;
      state.previewPageId = state.debug.selectedPageId;
      state.view = "preview";
      render();
    });

  document
    .getElementById("clear-overlays-button")
    .addEventListener("click", () => {
      heatmapRenderer.clear();
    });

  document.getElementById("import-files").addEventListener("change", async (event) => {
    const files = Array.from(event.target.files || []);
    const payloads = await Promise.all(files.map((file) => file.text()));
    const sessions = payloads.flatMap((rawText) => parseImportedJson(rawText));
    upsertImportedSessions(sessions);
    state.importedSessions = getImportedSessions();
    setAlert(`${sessions.length} participant dataset(s) imported.`, "success");
    render();
  });
}

function refreshDebugOverlay() {
  const stage = document.getElementById("stimulus-stage");
  if (!stage) {
    heatmapRenderer.clear();
    return;
  }

  const session = getSelectedSession();
  const pageId =
    state.view === "stimulus"
      ? getCurrentStimulus()?.id || state.debug.selectedPageId
      : state.previewPageId || state.debug.selectedPageId;
  const points =
    state.debug.heatmapMode === "aggregated"
      ? getAggregatedPoints(pageId)
      : getPagePointsForSession(session, pageId);

  if (state.debug.heatmapMode !== "none") {
    heatmapRenderer.renderHeatmap(stage, points);
  } else {
    heatmapRenderer.ensureLayers(stage);
  }

  if (state.debug.showRawPoints) {
    heatmapRenderer.drawRawPoints(stage, points);
  } else if (heatmapRenderer.rawCanvas) {
    const context = heatmapRenderer.rawCanvas.getContext("2d");
    if (context) {
      context.clearRect(
        0,
        0,
        heatmapRenderer.rawCanvas.width,
        heatmapRenderer.rawCanvas.height,
      );
    }
  }

  if (state.debug.showLiveDot) {
    heatmapRenderer.updateLiveDot(stage, webgazerController.getLatestPoint());
  } else if (heatmapRenderer.liveDot) {
    heatmapRenderer.liveDot.classList.add("hidden");
  }
}

function handleGazeSample(sample) {
  if (!sample.pageId) {
    return;
  }

  state.session = appendGazePoint(state.session, sample.pageId, sample);

  if (state.adminMode && state.view !== "final") {
    refreshDebugOverlay();
  }
}

function render() {
  updateHeader();
  renderAdminDrawer();

  if (state.view === "intro") {
    renderIntro();
  } else if (state.view === "declined") {
    renderDeclined();
  } else if (state.view === "calibration") {
    renderCalibration();
  } else if (state.view === "stimulus") {
    renderStimulus(false);
  } else if (state.view === "preview") {
    renderStimulus(true);
  } else {
    renderFinal();
  }

  refreshDebugOverlay();
  scheduleDebugRefresh();
}

window.addEventListener("beforeunload", () => {
  clearGateTimer();
  window.clearInterval(state.debugRefreshTimer);
});

preloadImages();
handleTrackingStatus("awaiting consent");
render();
