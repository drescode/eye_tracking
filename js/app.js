import {
  STUDY_CONFIG,
  TOTAL_STEPS,
  getStimulusPlan as resolveStimulusPlan,
} from "./config.js?v=20260418c";
import {
  appendGazePoint,
  appendTrackingStatus,
  beginSelectionPopupPhase,
  beginStimulusPage,
  completeCalibration,
  completeStimulusPage,
  computeAggregateStats,
  createSession,
  getAllSessions,
  getImportedSessions,
  loadCurrentSession,
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
  updateParticipantProfile,
  updateStimulusSelection,
  upsertImportedSessions,
} from "./data-store.js?v=20260418c";
import { WebgazerController } from "./webgazer-controller.js?v=20260418c";
import { CalibrationSequence } from "./calibration.js?v=20260418c";
import { HeatmapRenderer } from "./heatmap.js?v=20260418c";
import {
  getSupabaseConfigurationMessage,
  isSupabaseConfigured,
  submitSessionToSupabase,
} from "./supabase-store.js?v=20260418c";

const query = new URLSearchParams(window.location.search);
const initialSession = loadCurrentSession(STUDY_CONFIG);
const initialStimulusPlan = resolveStimulusPlan(initialSession, STUDY_CONFIG);
const state = {
  adminMode: query.get("admin") === "1",
  view: "intro",
  stimulusIndex: 0,
  previewPageId: null,
  previewReturnView: "final",
  previewReturnStimulusIndex: 0,
  session: initialSession,
  importedSessions: getImportedSessions(),
  activeStimulusPageId: null,
  currentPageStartedAt: 0,
  currentSelection: null,
  gateTimer: null,
  gateRemainingMs: STUDY_CONFIG.stimulus.minimumViewingTimeMs,
  selectionPhaseOpen: false,
  stimulusViewingElapsedMs: 0,
  selectionPopupStartedAt: 0,
  currentGazePhase: "stimulus",
  remoteSubmissionInFlight: false,
  qualityCheckTimer: null,
  qualityCheck: {
    status: "idle",
    startedAt: 0,
    remainingMs: 0,
    validSamples: 0,
    invalidSamples: 0,
  },
  debugRefreshTimer: null,
  debug: {
    showLiveDot: false,
    showRawPoints: false,
    heatmapMode: "none",
    selectedSessionId: "current",
    selectedPageId: initialStimulusPlan[0]?.id || "",
  },
  lastScrollKey: null,
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
const siteShellEl = document.querySelector(".site-shell");
const siteHeaderEl = document.querySelector(".site-header");

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

  if (state.view === "calibration" || state.view === "quality-check") {
    return { current: 2, label: "Calibration" };
  }

  if (state.view === "stimulus-instructions") {
    return { current: 3, label: "Before You Begin" };
  }

  if (state.view === "stimulus") {
    return {
      current: 4 + state.stimulusIndex,
      label: `Stimulus ${state.stimulusIndex + 1}`,
    };
  }

  if (state.view === "preview") {
    const previewIndex = getAvailableStimulusPages().findIndex(
      (page) => page.id === state.previewPageId,
    );
    return {
      current: Math.max(4, previewIndex + 4),
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
      : status === "calibrating" || status === "face not detected" || status === "tracking unstable"
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
      participantNumber: result.participantNumber,
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
  return getCurrentStimulusPlan()[state.stimulusIndex];
}

function getCurrentStimulusPlan() {
  return resolveStimulusPlan(state.session, STUDY_CONFIG);
}

function getAvailableStimulusPages() {
  const pages = new Map();

  [state.session, ...state.importedSessions]
    .filter((session) => !session?.studyId || session.studyId === STUDY_CONFIG.studyId)
    .forEach((session) => {
    resolveStimulusPlan(session, STUDY_CONFIG).forEach((page) => {
      if (!pages.has(page.id)) {
        pages.set(page.id, page);
      }
    });
    });

  if (!pages.size) {
    resolveStimulusPlan(null, STUDY_CONFIG).forEach((page) => {
      pages.set(page.id, page);
    });
  }

  return Array.from(pages.values());
}

function getPageDefinitionById(pageId) {
  return (
    getAvailableStimulusPages().find((page) => page.id === pageId) ||
    getCurrentStimulusPlan().find((page) => page.id === pageId) ||
    null
  );
}

function getSelectedSession() {
  if (state.debug.selectedSessionId === "current") {
    return state.session;
  }

  return (
    state.importedSessions.find(
      (session) =>
        session.studyId === STUDY_CONFIG.studyId &&
        session.participantId === state.debug.selectedSessionId,
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

function clearQualityCheckTimer() {
  window.clearInterval(state.qualityCheckTimer);
  state.qualityCheckTimer = null;
}

function preloadImages() {
  getAvailableStimulusPages().forEach((page) => {
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

function ensureBrowserScript(src, globalName, timeoutMs = 15000) {
  if (window[globalName]) {
    return Promise.resolve(window[globalName]);
  }

  const existing = Array.from(document.scripts).find((script) =>
    script.src.includes(src),
  );

  return new Promise((resolve, reject) => {
    const startedAt = Date.now();

    const finishIfReady = () => {
      if (window[globalName]) {
        resolve(window[globalName]);
        return true;
      }
      return false;
    };

    if (finishIfReady()) {
      return;
    }

    const script = existing || document.createElement("script");
    if (!existing) {
      script.src = src;
      script.defer = true;
      document.head.appendChild(script);
    }

    const poll = window.setInterval(() => {
      if (finishIfReady()) {
        window.clearInterval(poll);
        return;
      }

      if (Date.now() - startedAt > timeoutMs) {
        window.clearInterval(poll);
        reject(new Error(`${globalName} did not load in time.`));
      }
    }, 150);

    script.addEventListener(
      "error",
      () => {
        window.clearInterval(poll);
        reject(new Error(`${globalName} failed to load from ${src}.`));
      },
      { once: true },
    );
  });
}

async function initializeTrackingAfterConsent() {
  await ensureBrowserScript("./js/lib/webgazer.js?v=20260417c", "webgazer");
  await waitForDependency("h337");
  await webgazerController.initialize();
  state.session = markTrackingInitialized(state.session);
}

function getParticipantProfileFields() {
  return STUDY_CONFIG.participantProfile?.fields || [];
}

function isParticipantProfileComplete(session) {
  const profile = session.participantProfile || {};
  return getParticipantProfileFields()
    .filter((field) => field.required)
    .every((field) => String(profile[field.id] || "").trim().length > 0);
}

function buildParticipantProfileField(field, value) {
  if (field.type === "select") {
    return `
      <label class="profile-field">
        <span class="profile-field__label">
          ${escapeHtml(field.label)}
          ${field.required ? '<span class="profile-field__required">Required</span>' : ""}
        </span>
        <select data-profile-field="${escapeHtml(field.id)}">
          ${field.options
            .map(
              (option) => `
                <option value="${escapeHtml(option)}" ${
                  option === value ? "selected" : ""
                }>
                  ${escapeHtml(option || "Select an option")}
                </option>
              `,
            )
            .join("")}
        </select>
      </label>
    `;
  }

  return `
    <label class="profile-field">
      <span class="profile-field__label">
        ${escapeHtml(field.label)}
        ${field.required ? '<span class="profile-field__required">Required</span>' : ""}
      </span>
      <input
        type="text"
        value="${escapeHtml(value || "")}"
        data-profile-field="${escapeHtml(field.id)}"
      />
    </label>
  `;
}

function renderIntro() {
  const intro = STUDY_CONFIG.intro;
  const participantProfile = STUDY_CONFIG.participantProfile;
  const profile = state.session.participantProfile || {};
  const profileComplete = isParticipantProfileComplete(state.session);
  app.innerHTML = `
    <section class="intro-layout">
      <article class="hero-card intro-hero stack">
        <div>
          <p class="eyebrow">${escapeHtml(STUDY_CONFIG.researcherLabel)}</p>
          <h2>${escapeHtml(STUDY_CONFIG.studyTitle)}</h2>
          <p class="lead">${escapeHtml(intro.lead)}</p>
        </div>
        <div class="intro-steps">
          <div class="info-chip">
            <strong>1. Profile</strong>
            <span>Complete a short audience profile before consent.</span>
          </div>
          <div class="info-chip">
            <strong>2. Consent and webcam</strong>
            <span>Review the webcam notice and only continue if you agree.</span>
          </div>
          <div class="info-chip">
            <strong>3. Calibrate and view</strong>
            <span>Calibrate, review the product stimuli, then make your selections.</span>
          </div>
        </div>
        <div class="intro-summary-grid">
          <div class="notice-card">
            <h3>What you will do</h3>
            <ul class="list-block">
              ${intro.studyInformation
                .map((item) => `<li>${escapeHtml(item)}</li>`)
                .join("")}
            </ul>
          </div>
          <div class="notice-card">
            <h3>Works best when</h3>
            <p>${escapeHtml(intro.webcamNotice)}</p>
            <p class="panel-muted">Stable lighting, a centered face, and minimal movement usually produce the best gaze data.</p>
          </div>
        </div>
      </article>

      <aside class="panel intro-sidebar stack">
        <div class="consent-box stack">
          <div>
            <p class="eyebrow">Before consent</p>
            <h3>${escapeHtml(participantProfile.title)}</h3>
            <p>${escapeHtml(participantProfile.intro)}</p>
            <p class="panel-muted">${escapeHtml(participantProfile.helper)}</p>
          </div>
          <div class="profile-grid">
            ${getParticipantProfileFields()
              .map((field) => buildParticipantProfileField(field, profile[field.id] || ""))
              .join("")}
          </div>
          <div class="profile-status ${profileComplete ? "profile-status--complete" : ""}">
            ${
              profileComplete
                ? "Profile complete. You can now review consent and continue."
                : "Please complete all required profile fields before continuing."
            }
          </div>
        </div>

        <div class="consent-box stack">
          <div class="notice-card">
            <h3>Webcam and Privacy Notice</h3>
            <p>${escapeHtml(intro.privacyNotice)}</p>
            <p>${escapeHtml(intro.consentCopy)}</p>
          </div>
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
            Participation only proceeds after the required profile fields are completed and explicit consent is given. WebGazer is not initialized before that point.
          </p>
        </div>
      </aside>
    </section>
  `;

  const checkbox = document.getElementById("consent-checkbox");
  const continueButton = document.getElementById("continue-button");
  const declineButton = document.getElementById("decline-button");
  const newSessionButton = document.getElementById("new-session-button");
  const profileInputs = Array.from(document.querySelectorAll("[data-profile-field]"));

  const syncContinueState = () => {
    continueButton.disabled = !checkbox.checked || !isParticipantProfileComplete(state.session);
  };

  profileInputs.forEach((input) => {
    input.addEventListener("change", (event) => {
      state.session = updateParticipantProfile(
        state.session,
        event.target.dataset.profileField,
        event.target.value,
      );
      syncContinueState();
      render();
    });
  });

  checkbox.addEventListener("change", syncContinueState);
  syncContinueState();

  continueButton.addEventListener("click", async () => {
    continueButton.disabled = true;
    continueButton.textContent = "Requesting webcam access...";
    setAlert("");

    if (state.session.status === "completed" || state.session.status === "declined") {
      state.session = resetCurrentSession(STUDY_CONFIG);
      render();
      return;
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
    <section class="study-frame study-frame--calibration">
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

  if (window.webgazer?.clearData) {
    window.webgazer.clearData();
  }

  webgazerController.setCalibrationMode(true);

  const calibration = new CalibrationSequence(STUDY_CONFIG.calibration);
  calibration.mount(document.getElementById("calibration-root"), {
    onProgress: ({ pointId, clicks }) => {
      state.session = updateCalibrationPoint(state.session, pointId, clicks);
    },
    onComplete: () => {
      state.session = completeCalibration(state.session);
      window.setTimeout(() => {
        state.view = "quality-check";
        render();
      }, 900);
    },
  });
}

function startTrackingQualityCheck() {
  clearQualityCheckTimer();
  state.qualityCheck = {
    status: "running",
    startedAt: Date.now(),
    remainingMs: STUDY_CONFIG.tracking.qualityCheckDurationMs,
    validSamples: 0,
    invalidSamples: 0,
  };

  const stage = document.getElementById("quality-check-stage");
  if (stage) {
    webgazerController.setPageContext("__quality-check__", () =>
      stage.getBoundingClientRect(),
    );
  }

  state.qualityCheckTimer = window.setInterval(() => {
    const elapsed = Date.now() - state.qualityCheck.startedAt;
    state.qualityCheck.remainingMs = Math.max(
      0,
      STUDY_CONFIG.tracking.qualityCheckDurationMs - elapsed,
    );

    const remainingEl = document.getElementById("quality-check-remaining");
    if (remainingEl) {
      remainingEl.textContent =
        state.qualityCheck.remainingMs > 0
          ? `${(state.qualityCheck.remainingMs / 1000).toFixed(1)}s remaining`
          : "Checking complete";
    }

    const validEl = document.getElementById("quality-check-valid");
    if (validEl) {
      validEl.textContent = String(state.qualityCheck.validSamples);
    }

    const invalidEl = document.getElementById("quality-check-invalid");
    if (invalidEl) {
      invalidEl.textContent = String(state.qualityCheck.invalidSamples);
    }

    if (state.qualityCheck.remainingMs > 0) {
      return;
    }

    clearQualityCheckTimer();
    const passed =
      state.qualityCheck.validSamples >=
      STUDY_CONFIG.tracking.minimumValidSamplesForStudy;

    if (passed) {
      state.qualityCheck.status = "passed";
      webgazerController.setCalibrationMode(false);
      webgazerController.clearPageContext();
      state.view = "stimulus-instructions";
      render();
      return;
    }

    state.qualityCheck.status = "failed";
    render();
  }, 100);
}

function renderTrackingQualityCheck() {
  const threshold = STUDY_CONFIG.tracking.minimumValidSamplesForStudy;
  const failed = state.qualityCheck.status === "failed";

  app.innerHTML = `
    <section class="study-frame">
      <article class="hero-card stack">
        <div>
          <p class="eyebrow">Tracking Check</p>
          <h2>Confirming webcam tracking quality</h2>
          <p class="lead">
            Keep your face centered, look at the screen naturally, and stay relatively still for a few seconds.
          </p>
        </div>
        <div class="metric-grid">
          <div class="metric">
            <span class="panel-muted">Valid samples</span>
            <strong id="quality-check-valid">${state.qualityCheck.validSamples}</strong>
          </div>
          <div class="metric">
            <span class="panel-muted">Invalid samples</span>
            <strong id="quality-check-invalid">${state.qualityCheck.invalidSamples}</strong>
          </div>
          <div class="metric">
            <span class="panel-muted">Progress</span>
            <strong id="quality-check-remaining">${
              failed
                ? "Check failed"
                : `${(state.qualityCheck.remainingMs / 1000).toFixed(1)}s remaining`
            }</strong>
          </div>
        </div>
        <div class="notice-card">
          <p>
            The study will only continue after at least ${threshold} valid gaze samples are detected.
          </p>
          ${
            failed
              ? `<p><strong>Tracking quality is still too weak to continue.</strong> Improve lighting, keep your face centered in the webcam, and retry.</p>`
              : `<p>Webcam feedback remains visible here so you can adjust your position before the first stimulus page.</p>`
          }
        </div>
      </article>

      <div id="quality-check-stage" class="calibration-stage"></div>

      ${
        failed
          ? `
            <div class="button-row">
              <button id="retry-quality-check" class="button" type="button">Retry tracking check</button>
              <button id="restart-calibration" class="ghost-button" type="button">Run calibration again</button>
            </div>
          `
          : ""
      }
    </section>
  `;

  if (state.qualityCheck.status === "idle") {
    startTrackingQualityCheck();
  } else if (state.qualityCheck.status === "failed") {
    webgazerController.clearPageContext();
    document
      .getElementById("retry-quality-check")
      ?.addEventListener("click", () => {
        state.qualityCheck.status = "idle";
        state.qualityCheck.remainingMs = STUDY_CONFIG.tracking.qualityCheckDurationMs;
        render();
      });

    document
      .getElementById("restart-calibration")
      ?.addEventListener("click", () => {
        state.qualityCheck.status = "idle";
        state.view = "calibration";
        render();
      });
  }
}

function renderStimulusInstructions() {
  app.innerHTML = `
    <section class="study-frame">
      <article class="hero-card stack focus-card">
        <div>
          <p class="eyebrow">Before You Begin</p>
          <h2>${escapeHtml(STUDY_CONFIG.stimulusInstructions.title)}</h2>
          <p class="lead">${escapeHtml(STUDY_CONFIG.stimulusInstructions.copy)}</p>
          <p>${escapeHtml(STUDY_CONFIG.stimulusInstructions.reminder)}</p>
        </div>

        <div class="notice-card">
          <p><strong>Viewing period:</strong> Each stimulus page will remain on screen for ${Math.round(
            STUDY_CONFIG.stimulus.minimumViewingTimeMs / 1000,
          )} seconds before you can select directly from the page.</p>
        </div>

        <div class="button-row">
          <button id="begin-stimulus-pages" class="button" type="button">
            ${escapeHtml(STUDY_CONFIG.stimulusInstructions.buttonLabel)}
          </button>
        </div>
      </article>
    </section>
  `;

  document.getElementById("begin-stimulus-pages")?.addEventListener("click", () => {
    state.view = "stimulus";
    state.stimulusIndex = 0;
    render();
  });
}

function buildStimulusCard(option, selectedId, page) {
  const selected = selectedId === option.id;
  const useRetailCard = page?.cardTheme === "sixtysixty";
  const selectable = state.selectionPhaseOpen;

  if (useRetailCard) {
    return `
      <article class="stimulus-card stimulus-card--retail ${selectable ? "is-selectable" : ""} ${selected ? "is-selected" : ""}" data-option-id="${escapeHtml(
        option.id,
      )}">
        <div class="stimulus-card__figure stimulus-card__figure--retail">
          <img
            src="${escapeHtml(option.image)}"
            alt="${escapeHtml(option.title)}"
            loading="eager"
          />
        </div>
        <div class="stimulus-card__details">
          <div class="stimulus-card__product-block">
            <h3 class="stimulus-card__product-name">${escapeHtml(option.productName || option.title)}</h3>
            ${
              option.sizeLabel
                ? `<p class="stimulus-card__size">${escapeHtml(option.sizeLabel)}</p>`
                : ""
            }
          </div>
          ${
            option.price
              ? `<div class="stimulus-card__price">${escapeHtml(option.price)}</div>`
              : ""
          }
          ${
            option.retailerLabel
              ? `<div class="stimulus-card__retailer">${escapeHtml(option.retailerLabel)}</div>`
              : ""
          }
          <div
            class="stimulus-card__cta"
            style="background:${escapeHtml(option.accentColor || "#D71920")}; color:${escapeHtml(option.accentTextColor || "#ffffff")};"
          >
            ${escapeHtml(option.ctaLabel || "ADD TO CART")}
          </div>
        </div>
      </article>
    `;
  }

  return `
    <article class="stimulus-card ${selectable ? "is-selectable" : ""} ${selected ? "is-selected" : ""}" data-option-id="${escapeHtml(
      option.id,
    )}">
      <div class="stimulus-card__figure">
        <img
          src="${escapeHtml(option.image)}"
          alt="${escapeHtml(option.title)}"
          loading="eager"
        />
      </div>
    </article>
  `;
}

function buildStimulusSelectionModal(page, selectedId) {
  return "";
}

function attachStimulusInteractions(page, previewMode = false) {
  const stage = document.getElementById("stimulus-stage");
  if (!stage) {
    return;
  }

  if (!previewMode) {
    const optionCards = Array.from(stage.querySelectorAll("[data-option-id]"));
    optionCards.forEach((card) => {
      card.addEventListener("click", () => {
        if (!state.selectionPhaseOpen) {
          return;
        }

        const option = page.options.find(
          (entry) => entry.id === card.dataset.optionId,
        );
        if (!option) {
          return;
        }
        state.currentSelection = option.id;
        state.session = updateStimulusSelection(state.session, page.id, option);
        renderStimulus(false);
      });
    });

    document
      .getElementById("advance-stimulus-button")
      ?.addEventListener("click", handleNextStimulus);
  } else {
    document
      .getElementById("leave-preview")
      ?.addEventListener("click", () => {
        state.view = state.previewReturnView;
        state.stimulusIndex = state.previewReturnStimulusIndex;
        render();
      });
  }

  const rectGetter = () => stage.getBoundingClientRect();
  webgazerController.setPageContext(page.id, rectGetter);
  refreshDebugOverlay();
}

function activateSelectionPhase(page) {
  if (state.selectionPhaseOpen) {
    return;
  }

  clearGateTimer();
  state.gateRemainingMs = 0;
  state.selectionPhaseOpen = true;
  state.stimulusViewingElapsedMs =
    Date.now() - state.currentPageStartedAt;
  state.selectionPopupStartedAt = Date.now();
  state.currentGazePhase = "selectionPopup";
  state.session = beginSelectionPopupPhase(state.session, page.id);
  renderStimulus(false);
}

function startStimulusPageTracking(page) {
  if (state.activeStimulusPageId === page.id) {
    return;
  }

  clearGateTimer();
  state.activeStimulusPageId = page.id;
  state.currentPageStartedAt = Date.now();
  state.currentSelection = null;
  state.selectionPhaseOpen = false;
  state.stimulusViewingElapsedMs = 0;
  state.selectionPopupStartedAt = 0;
  state.currentGazePhase = "stimulus";
  state.session = beginStimulusPage(state.session, page);
  state.gateRemainingMs = STUDY_CONFIG.stimulus.minimumViewingTimeMs;
  state.gateTimer = window.setInterval(() => {
    const elapsed = Date.now() - state.currentPageStartedAt;
    state.gateRemainingMs = Math.max(
      0,
      STUDY_CONFIG.stimulus.minimumViewingTimeMs - elapsed,
    );
    const timerLabel = document.getElementById("timer-label");
      if (timerLabel) {
        timerLabel.textContent =
          state.gateRemainingMs > 0
            ? `Minimum viewing time remaining: ${(state.gateRemainingMs / 1000).toFixed(1)}s`
            : "Select one option and continue";
      }

      if (state.gateRemainingMs <= 0) {
        activateSelectionPhase(page);
      }
    }, 100);
}

function renderStimulus(previewMode = false) {
  const page = previewMode
    ? getPageDefinitionById(state.previewPageId)
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

  app.innerHTML = `
    <section class="study-frame">
      <div
        id="stimulus-stage"
        class="stimulus-stage stimulus-stage--immersive"
        style="--stimulus-frame-ratio: ${escapeHtml(page.frameAspectRatio || "4 / 5")}; --stimulus-columns: ${escapeHtml(
          String(page.options.length || 3),
        )};"
      >
        <div class="stimulus-stage__header">
          <div class="stimulus-stage__meta">
            <p class="stage-kicker">${previewMode ? "Admin Preview" : escapeHtml(
              `${page.familyLabel} · ${page.caseId}`,
            )}</p>
            <p class="helper-text">${escapeHtml(page.caseTitle)}</p>
          </div>
          <div class="timing-chip">${escapeHtml(`Template ${page.template}`)}</div>
        </div>

        <div class="stimulus-grid stimulus-grid--immersive">
          ${page.options
            .map((option) => buildStimulusCard(option, selectedId, page))
            .join("")}
        </div>

        <div class="stimulus-stage__footer">
          <span id="timer-label" class="timing-chip">
            ${
              previewMode
                ? "Preview mode"
                : state.selectionPhaseOpen
                  ? "Select one option and continue"
                  : `Viewing period: ${(state.gateRemainingMs / 1000).toFixed(1)}s remaining`
            }
          </span>
          ${
            previewMode
              ? `<button id="leave-preview" class="ghost-button" type="button">Back to dashboard</button>`
              : `
                  <div class="stimulus-stage__actions">
                    <span class="helper-text">${
                      state.selectionPhaseOpen
                        ? "Choose directly from the page and continue."
                        : "Selection becomes available on the page after the viewing period."
                    }</span>
                    <button
                      id="advance-stimulus-button"
                      class="button"
                      type="button"
                      ${
                        state.selectionPhaseOpen && selectedId
                          ? ""
                          : "disabled"
                      }
                    >
                      Continue
                    </button>
                  </div>
                `
          }
        </div>
      </div>
    </section>
  `;

  attachStimulusInteractions(page, previewMode);
}

function handleNextStimulus() {
  const page = getCurrentStimulus();
  if (!page) {
    return;
  }

  const elapsed = state.stimulusViewingElapsedMs || (Date.now() - state.currentPageStartedAt);
  if (elapsed < STUDY_CONFIG.stimulus.minimumViewingTimeMs) {
    return;
  }

  if (STUDY_CONFIG.stimulus.requireSelectionToAdvance && !state.currentSelection) {
    return;
  }

  clearGateTimer();
  state.activeStimulusPageId = null;
  state.selectionPhaseOpen = false;
  const selectionPopupElapsed = state.selectionPopupStartedAt
    ? Date.now() - state.selectionPopupStartedAt
    : 0;
  state.selectionPopupStartedAt = 0;
  state.stimulusViewingElapsedMs = 0;
  state.currentGazePhase = "stimulus";
  state.session = completeStimulusPage(state.session, page.id, {
    stimulusTimeOnPageMs: elapsed,
    selectionPopupTimeOnPageMs: selectionPopupElapsed,
  });
  webgazerController.clearPageContext();

  if (state.stimulusIndex < getCurrentStimulusPlan().length - 1) {
    state.stimulusIndex += 1;
    render();
    return;
  }

  state.session = markStudyCompleted(state.session);
  state.view = "final";
  webgazerController.stop();
  if (STUDY_CONFIG.remoteStorage?.autoSubmitOnDebrief) {
    void uploadSessionToSupabase();
  }
  render();
}

function renderFinal() {
  const sessionPages = getCurrentStimulusPlan().map((page) => ({
    page,
    record: state.session.pages?.[page.id] || null,
  }));
  const stats = computeAggregateStats(getAllSessions(state.session), STUDY_CONFIG);
  const submissionConfigured = isSupabaseConfigured(STUDY_CONFIG);

  app.innerHTML = `
    <section class="final-grid ${state.adminMode ? "" : "final-grid--single"}">
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
                (total, entry) =>
                  total +
                  (entry.record?.validSampleCount || 0) +
                  (entry.record?.selectionPopupValidSampleCount || 0),
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
                <th>Case</th>
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
                  const combinedTime =
                    (record?.timeOnPageMs || 0) +
                    (record?.selectionPopupTimeOnPageMs || 0);
                  const combinedSamples =
                    (record?.validSampleCount || 0) +
                    (record?.invalidSampleCount || 0) +
                    (record?.selectionPopupValidSampleCount || 0) +
                    (record?.selectionPopupInvalidSampleCount || 0);
                  return `
                    <tr>
                      <td>${escapeHtml(page.title)}</td>
                      <td>${escapeHtml(page.caseTitle)}</td>
                      <td>${escapeHtml(label)}</td>
                      <td>${escapeHtml(formatDuration(combinedTime))}</td>
                      <td>${escapeHtml(String(combinedSamples))}</td>
                    </tr>
                  `;
                })
                .join("")}
            </tbody>
          </table>
        </div>
      </article>

      ${
        state.adminMode
          ? `
            <aside class="panel stack">
              <div class="upload-card">
                <h3>Session Control</h3>
                <p>You can start a fresh browser session for the next participant after exporting the current data.</p>
                <div class="button-row">
                  <button id="restart-study" class="button" type="button">Start new participant session</button>
                </div>
              </div>

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
            </aside>
          `
          : ""
      }
    </section>
  `;

  const restartButton = document.getElementById("restart-study");
  if (restartButton) {
    restartButton.addEventListener("click", () => {
      clearGateTimer();
      heatmapRenderer.clear();
      state.session = createSession(STUDY_CONFIG);
      state.session = saveCurrentSession(state.session);
      state.activeStimulusPageId = null;
      state.debug.selectedPageId = getCurrentStimulusPlan()[0]?.id || "";
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
  const availablePages = getAvailableStimulusPages();
  const importedStudySessions = state.importedSessions.filter(
    (session) => session.studyId === STUDY_CONFIG.studyId,
  );
  if (!availablePages.find((page) => page.id === state.debug.selectedPageId)) {
    state.debug.selectedPageId = availablePages[0]?.id || "";
  }
  const sessions = [
    { participantId: "current", label: "Current browser session" },
    ...importedStudySessions.map((session) => ({
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
        ${availablePages
          .map(
            (page) => `
              <option value="${escapeHtml(page.id)}" ${
                state.debug.selectedPageId === page.id ? "selected" : ""
              }>
                ${escapeHtml(`${page.familyLabel} · ${page.caseId}`)}
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
        Available imported sessions: ${importedStudySessions.length}<br />
        Known case pages: ${availablePages.length}
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

  if (sample.pageId === "__quality-check__") {
    if (sample.valid) {
      state.qualityCheck.validSamples += 1;
    } else {
      state.qualityCheck.invalidSamples += 1;
    }
    return;
  }

  state.session = appendGazePoint(
    state.session,
    sample.pageId,
    sample,
    state.currentGazePhase,
  );

  if (state.adminMode && state.view !== "final") {
    refreshDebugOverlay();
  }
}

function getScrollKey() {
  if (state.view === "stimulus") {
    const page = getCurrentStimulus();
    return `stimulus:${page?.id || state.stimulusIndex}`;
  }

  if (state.view === "preview") {
    return `preview:${state.previewPageId || "none"}`;
  }

  return state.view;
}

function scrollToTopForPageChange() {
  const nextScrollKey = getScrollKey();

  if (state.lastScrollKey === nextScrollKey) {
    return;
  }

  state.lastScrollKey = nextScrollKey;
  window.scrollTo({
    top: 0,
    left: 0,
    behavior: "auto",
  });
}

function render() {
  const studyLayoutActive = [
    "calibration",
    "quality-check",
    "stimulus-instructions",
    "stimulus",
    "preview",
  ].includes(state.view);
  const focusLayoutActive = [
    "calibration",
    "quality-check",
    "stimulus-instructions",
    "stimulus",
    "preview",
  ].includes(state.view);

  siteShellEl?.classList.toggle("site-shell--study", studyLayoutActive);
  siteShellEl?.classList.toggle(
    "site-shell--immersive",
    studyLayoutActive,
  );
  siteHeaderEl?.classList.toggle("site-header--compact", studyLayoutActive);
  siteHeaderEl?.classList.toggle("site-header--focus", focusLayoutActive);
  updateHeader();
  renderAdminDrawer();

  if (state.view === "intro") {
    renderIntro();
  } else if (state.view === "declined") {
    renderDeclined();
  } else if (state.view === "calibration") {
    renderCalibration();
  } else if (state.view === "quality-check") {
    renderTrackingQualityCheck();
  } else if (state.view === "stimulus-instructions") {
    renderStimulusInstructions();
  } else if (state.view === "stimulus") {
    renderStimulus(false);
  } else if (state.view === "preview") {
    renderStimulus(true);
  } else {
    renderFinal();
  }

  scrollToTopForPageChange();
  refreshDebugOverlay();
  scheduleDebugRefresh();
}

window.addEventListener("beforeunload", () => {
  clearGateTimer();
  clearQualityCheckTimer();
  window.clearInterval(state.debugRefreshTimer);
});

preloadImages();
handleTrackingStatus("awaiting consent");
render();
