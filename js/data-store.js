import {
  buildStimulusPlan,
  getStimulusPlan as resolveStimulusPlan,
} from "./config.js?v=20260418e";

const CURRENT_SCHEMA_VERSION = 6;

const STORAGE_KEYS = {
  currentSession: "nm-study-current-session",
  importedSessions: "nm-study-imported-sessions",
};

function nowIso() {
  return new Date().toISOString();
}

function generateId() {
  if (window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }

  return `session-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function getDeviceInfo() {
  return {
    userAgent: navigator.userAgent,
    language: navigator.language,
    platform: navigator.userAgentData?.platform || navigator.platform || "unknown",
    screenWidth: window.screen.width,
    screenHeight: window.screen.height,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    timezone:
      Intl.DateTimeFormat().resolvedOptions().timeZone || "unknown",
  };
}

function safeParse(raw, fallback) {
  if (!raw) {
    return fallback;
  }

  try {
    return JSON.parse(raw);
  } catch (_error) {
    return fallback;
  }
}

function createEmptyPhaseRecord(overrides = {}) {
  return {
    startedAt: null,
    endedAt: null,
    timeOnPageMs: 0,
    gazePoints: [],
    validSampleCount: 0,
    invalidSampleCount: 0,
    ...overrides,
  };
}

function ensurePagePhaseData(record) {
  const stimulusPhase = createEmptyPhaseRecord(
    record?.phases?.stimulus || {
      startedAt: record?.startedAt || null,
      endedAt: record?.endedAt || null,
      timeOnPageMs: record?.timeOnPageMs || 0,
      gazePoints: Array.isArray(record?.gazePoints) ? record.gazePoints : [],
      validSampleCount: record?.validSampleCount || 0,
      invalidSampleCount: record?.invalidSampleCount || 0,
    },
  );

  const selectionPopupPhase = createEmptyPhaseRecord(
    record?.phases?.selectionPopup || {
      startedAt: record?.selectionPopupStartedAt || null,
      endedAt: record?.selectionPopupEndedAt || null,
      timeOnPageMs: record?.selectionPopupTimeOnPageMs || 0,
      gazePoints: Array.isArray(record?.selectionPopupGazePoints)
        ? record.selectionPopupGazePoints
        : [],
      validSampleCount: record?.selectionPopupValidSampleCount || 0,
      invalidSampleCount: record?.selectionPopupInvalidSampleCount || 0,
    },
  );

  record.phases = {
    stimulus: stimulusPhase,
    selectionPopup: selectionPopupPhase,
  };

  record.startedAt = stimulusPhase.startedAt;
  record.endedAt = stimulusPhase.endedAt;
  record.timeOnPageMs = stimulusPhase.timeOnPageMs;
  record.gazePoints = stimulusPhase.gazePoints;
  record.validSampleCount = stimulusPhase.validSampleCount;
  record.invalidSampleCount = stimulusPhase.invalidSampleCount;

  record.selectionPopupStartedAt = selectionPopupPhase.startedAt;
  record.selectionPopupEndedAt = selectionPopupPhase.endedAt;
  record.selectionPopupTimeOnPageMs = selectionPopupPhase.timeOnPageMs;
  record.selectionPopupGazePoints = selectionPopupPhase.gazePoints;
  record.selectionPopupValidSampleCount = selectionPopupPhase.validSampleCount;
  record.selectionPopupInvalidSampleCount = selectionPopupPhase.invalidSampleCount;

  return record;
}

function buildPersistableSession(session) {
  return {
    ...session,
    pages: Object.fromEntries(
      Object.entries(session.pages || {}).map(([pageId, page]) => [
        pageId,
        (() => {
          const persistedPage = ensurePagePhaseData({ ...page });
          persistedPage.gazePoints = [];
          persistedPage.selectionPopupGazePoints = [];
          persistedPage.phases = {
            stimulus: {
              ...persistedPage.phases.stimulus,
              gazePoints: [],
            },
            selectionPopup: {
              ...persistedPage.phases.selectionPopup,
              gazePoints: [],
            },
          };
          return persistedPage;
        })(),
      ]),
    ),
  };
}

function persistSessionSnapshot(session) {
  try {
    localStorage.setItem(
      STORAGE_KEYS.currentSession,
      JSON.stringify(buildPersistableSession(session)),
    );
  } catch (error) {
    console.warn("Session snapshot could not be written to localStorage.", error);
  }
}

function ensureRemoteSubmissionShape(session, config) {
  session.remoteSubmission = {
    provider: config.remoteStorage?.provider || null,
    status: "idle",
    attempts: 0,
    lastAttemptAt: null,
    submittedAt: null,
    lastError: null,
    duplicate: false,
    participantNumber: null,
    ...(session.remoteSubmission || {}),
  };

  return session;
}

export function createSession(config) {
  const participantId = generateId();
  const stimulusPlan = buildStimulusPlan(participantId);
  const participantProfile = Object.fromEntries(
    (config.participantProfile?.fields || []).map((field) => [field.id, ""]),
  );

  return ensureRemoteSubmissionShape({
    schemaVersion: CURRENT_SCHEMA_VERSION,
    studyId: config.studyId,
    studyBuildId: config.studyBuildId || "default",
    studyTitle: config.studyTitle,
    participantId,
    participantNumber: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    status: "created",
    deviceInfo: getDeviceInfo(),
    consent: {
      granted: false,
      timestamp: null,
      declinedAt: null,
    },
    participantProfile,
    tracking: {
      initializedAt: null,
      statusLog: [],
      permissionState: "pending",
      errors: [],
    },
    calibration: {
      clicksPerPoint: config.calibration.clicksPerPoint,
      points: config.calibration.points.map((point) => ({
        id: point.id,
        x: point.x,
        y: point.y,
        clicks: 0,
        completedAt: null,
      })),
      completed: false,
      completedAt: null,
    },
    stimulusPlan,
    stimulusOrder: stimulusPlan.map((page) => page.id),
    pages: {},
    exports: {
      lastJsonDownloadAt: null,
      lastCsvDownloadAt: null,
      lastHeatmapDownloadAt: null,
    },
  }, config);
}

export function saveCurrentSession(session) {
  session.updatedAt = nowIso();
  persistSessionSnapshot(session);
  return session;
}

export function loadCurrentSession(config) {
  const session = safeParse(localStorage.getItem(STORAGE_KEYS.currentSession), null);

  const expectedBuildId = config.studyBuildId || "default";
  const needsFreshSession =
    !session ||
    session.studyId !== config.studyId ||
    session.studyBuildId !== expectedBuildId ||
    session.schemaVersion !== CURRENT_SCHEMA_VERSION;

  if (needsFreshSession) {
    return saveCurrentSession(createSession(config));
  }

  return saveCurrentSession(ensureRemoteSubmissionShape(session, config));
}

export function resetCurrentSession(config) {
  const nextSession = createSession(config);
  saveCurrentSession(nextSession);
  return nextSession;
}

export function updateConsent(session, granted) {
  session.status = granted ? "consented" : "declined";
  session.consent.granted = granted;
  session.consent.timestamp = granted ? nowIso() : null;
  session.consent.declinedAt = granted ? null : nowIso();
  return saveCurrentSession(session);
}

export function updateParticipantProfile(session, fieldId, value) {
  session.participantProfile = {
    ...(session.participantProfile || {}),
    [fieldId]: value,
  };
  return saveCurrentSession(session);
}

export function markTrackingInitialized(session) {
  session.tracking.initializedAt = nowIso();
  session.tracking.permissionState = "granted";
  return saveCurrentSession(session);
}

export function markTrackingDenied(session, message) {
  session.tracking.permissionState = "denied";
  session.tracking.errors.push({
    timestamp: nowIso(),
    message,
  });
  return saveCurrentSession(session);
}

export function appendTrackingStatus(session, status) {
  const previous = session.tracking.statusLog[session.tracking.statusLog.length - 1];
  if (previous?.status === status) {
    return session;
  }

  session.tracking.statusLog.push({
    timestamp: nowIso(),
    status,
  });
  return saveCurrentSession(session);
}

export function updateCalibrationPoint(session, pointId, clicks) {
  const point = session.calibration.points.find((entry) => entry.id === pointId);
  if (!point) {
    return session;
  }

  point.clicks = clicks;
  if (clicks >= session.calibration.clicksPerPoint && !point.completedAt) {
    point.completedAt = nowIso();
  }

  return saveCurrentSession(session);
}

export function completeCalibration(session) {
  session.calibration.completed = true;
  session.calibration.completedAt = nowIso();
  session.status = "calibrated";
  return saveCurrentSession(session);
}

export function beginStimulusPage(session, page) {
  if (!session.pages[page.id]) {
    session.pages[page.id] = ensurePagePhaseData({
      pageId: page.id,
      pageTitle: page.title,
      familyId: page.familyId || null,
      familyLabel: page.familyLabel || null,
      caseId: page.caseId || null,
      caseTitle: page.caseTitle || null,
      template: page.template || null,
      imageSetId: page.imageSetId,
      question: page.question,
      startedAt: null,
      endedAt: null,
      timeOnPageMs: 0,
      selection: null,
      selectedLabel: null,
      gazePoints: [],
      validSampleCount: 0,
      invalidSampleCount: 0,
      selectionPopupStartedAt: null,
      selectionPopupEndedAt: null,
      selectionPopupTimeOnPageMs: 0,
      selectionPopupGazePoints: [],
      selectionPopupValidSampleCount: 0,
      selectionPopupInvalidSampleCount: 0,
    });
  }

  const record = ensurePagePhaseData(session.pages[page.id]);
  record.selection = null;
  record.selectedLabel = null;
  record.phases.stimulus = createEmptyPhaseRecord({
    startedAt: nowIso(),
  });
  record.phases.selectionPopup = createEmptyPhaseRecord();
  ensurePagePhaseData(record);
  record.selection = record.selection || null;
  session.status = "in-progress";
  return saveCurrentSession(session);
}

export function beginSelectionPopupPhase(session, pageId) {
  const record = session.pages[pageId];
  if (!record) {
    return session;
  }

  ensurePagePhaseData(record);
  record.phases.selectionPopup = createEmptyPhaseRecord({
    startedAt: nowIso(),
  });
  ensurePagePhaseData(record);
  return saveCurrentSession(session);
}

export function updateStimulusSelection(session, pageId, option) {
  const record = session.pages[pageId];
  if (!record) {
    return session;
  }

  record.selection = option.id;
  record.selectedLabel = option.label;
  return saveCurrentSession(session);
}

export function appendGazePoint(session, pageId, sample, phase = "stimulus") {
  const record = session.pages[pageId];
  if (!record) {
    return session;
  }

  ensurePagePhaseData(record);
  const phaseKey = phase === "selectionPopup" ? "selectionPopup" : "stimulus";
  const phaseRecord = record.phases[phaseKey];

  phaseRecord.gazePoints.push(sample);
  if (sample.valid) {
    phaseRecord.validSampleCount += 1;
  } else {
    phaseRecord.invalidSampleCount += 1;
  }

  ensurePagePhaseData(record);
  const totalSamples =
    phaseRecord.validSampleCount + phaseRecord.invalidSampleCount;
  if (totalSamples % 10 === 0) {
    return saveCurrentSession(session);
  }

  return session;
}

export function completeStimulusPage(session, pageId, phaseTimings = {}) {
  const record = session.pages[pageId];
  if (!record) {
    return session;
  }

  const {
    stimulusTimeOnPageMs = 0,
    selectionPopupTimeOnPageMs = 0,
  } = phaseTimings;

  ensurePagePhaseData(record);
  record.phases.stimulus.endedAt = nowIso();
  record.phases.stimulus.timeOnPageMs = Math.round(stimulusTimeOnPageMs);

  if (record.phases.selectionPopup.startedAt) {
    record.phases.selectionPopup.endedAt = nowIso();
    record.phases.selectionPopup.timeOnPageMs = Math.round(
      selectionPopupTimeOnPageMs,
    );
  }

  ensurePagePhaseData(record);
  return saveCurrentSession(session);
}

export function markStudyCompleted(session) {
  session.status = "completed";
  session.completedAt = nowIso();
  return saveCurrentSession(session);
}

export function markRemoteSubmissionPending(session) {
  session.remoteSubmission = {
    ...(session.remoteSubmission || {}),
    status: "uploading",
    attempts: (session.remoteSubmission?.attempts || 0) + 1,
    lastAttemptAt: nowIso(),
    lastError: null,
    duplicate: false,
  };
  return saveCurrentSession(session);
}

export function markRemoteSubmissionSuccess(session, options = {}) {
  const participantNumber =
    Number.isFinite(options.participantNumber) && options.participantNumber > 0
      ? Math.trunc(options.participantNumber)
      : session.participantNumber || session.remoteSubmission?.participantNumber || null;

  session.participantNumber = participantNumber;
  session.remoteSubmission = {
    ...(session.remoteSubmission || {}),
    status: "submitted",
    submittedAt: nowIso(),
    lastError: null,
    duplicate: Boolean(options.duplicate),
    participantNumber,
  };
  return saveCurrentSession(session);
}

export function markRemoteSubmissionError(session, message) {
  session.remoteSubmission = {
    ...(session.remoteSubmission || {}),
    status: "failed",
    lastError: message,
  };
  return saveCurrentSession(session);
}

export function getImportedSessions() {
  return safeParse(localStorage.getItem(STORAGE_KEYS.importedSessions), []);
}

export function saveImportedSessions(sessions) {
  localStorage.setItem(STORAGE_KEYS.importedSessions, JSON.stringify(sessions));
  return sessions;
}

export function upsertImportedSessions(entries) {
  const imported = getImportedSessions();
  const map = new Map(imported.map((session) => [session.participantId, session]));

  entries.forEach((entry) => {
    if (entry && entry.participantId) {
      map.set(entry.participantId, entry);
    }
  });

  return saveImportedSessions(Array.from(map.values()));
}

export function getAllSessions(currentSession) {
  const imported = getImportedSessions().filter(
    (session) =>
      !currentSession?.studyId || session.studyId === currentSession.studyId,
  );
  const sessions = imported.slice();

  if (currentSession?.participantId) {
    const existingIndex = sessions.findIndex(
      (entry) => entry.participantId === currentSession.participantId,
    );

    if (existingIndex >= 0) {
      sessions.splice(existingIndex, 1, currentSession);
    } else {
      sessions.unshift(currentSession);
    }
  }

  return sessions;
}

export function buildSessionJson(session) {
  return JSON.stringify(session, null, 2);
}

export function buildSummaryCsv(session, config) {
  const header = [
    "participant_id",
    "participant_number",
    "study_id",
    "consent_timestamp",
    "age_category",
    "province",
    "gender_identity",
    "online_shopping_frequency",
    "primary_shopping_device",
    "retailer_familiarity",
    "page_id",
    "family_id",
    "family_label",
    "case_id",
    "case_title",
    "template",
    "image_set_id",
    "selection",
    "selected_label",
    "time_on_page_ms",
    "valid_sample_count",
    "invalid_sample_count",
    "selection_popup_time_on_page_ms",
    "selection_popup_valid_sample_count",
    "selection_popup_invalid_sample_count",
    "combined_time_on_page_ms",
    "combined_valid_sample_count",
    "combined_invalid_sample_count",
  ];

  const rows = resolveStimulusPlan(session, config).map((page) => {
    const record = session.pages[page.id]
      ? ensurePagePhaseData(session.pages[page.id])
      : {};
    const profile = session.participantProfile || {};
    const selectionPopupTime = record.selectionPopupTimeOnPageMs || 0;
    const selectionPopupValid = record.selectionPopupValidSampleCount || 0;
    const selectionPopupInvalid = record.selectionPopupInvalidSampleCount || 0;
    return [
      session.participantId,
      session.participantNumber || session.remoteSubmission?.participantNumber || "",
      session.studyId,
      session.consent.timestamp || "",
      profile.ageCategory || "",
      profile.province || "",
      profile.genderIdentity || "",
      profile.onlineShoppingFrequency || "",
      profile.primaryShoppingDevice || "",
      profile.retailerFamiliarity || "",
      page.id,
      page.familyId || "",
      page.familyLabel || "",
      page.caseId || "",
      page.caseTitle || "",
      page.template || "",
      page.imageSetId,
      record.selection || "",
      record.selectedLabel || "",
      record.timeOnPageMs || 0,
      record.validSampleCount || 0,
      record.invalidSampleCount || 0,
      selectionPopupTime,
      selectionPopupValid,
      selectionPopupInvalid,
      (record.timeOnPageMs || 0) + selectionPopupTime,
      (record.validSampleCount || 0) + selectionPopupValid,
      (record.invalidSampleCount || 0) + selectionPopupInvalid,
    ];
  });

  return [header, ...rows]
    .map((row) =>
      row
        .map((value) => `"${String(value).replaceAll('"', '""')}"`)
        .join(","),
    )
    .join("\n");
}

export function buildHeatmapExport(session, config) {
  return JSON.stringify(
    {
      participantId: session.participantId,
      participantNumber:
        session.participantNumber || session.remoteSubmission?.participantNumber || null,
      studyId: session.studyId,
      participantProfile: session.participantProfile || {},
      exportedAt: nowIso(),
      pages: resolveStimulusPlan(session, config).map((page) => {
        const record = session.pages[page.id]
          ? ensurePagePhaseData(session.pages[page.id])
          : null;
        return {
          pageId: page.id,
          familyId: page.familyId || null,
          familyLabel: page.familyLabel || null,
          caseId: page.caseId || null,
          caseTitle: page.caseTitle || null,
          template: page.template || null,
          imageSetId: page.imageSetId,
          selection: record?.selection || null,
          timeOnPageMs: record?.timeOnPageMs || 0,
          gazePoints: record?.gazePoints || [],
          selectionPopupTimeOnPageMs:
            record?.selectionPopupTimeOnPageMs || 0,
          selectionPopupGazePoints:
            record?.selectionPopupGazePoints || [],
          phases: {
            stimulus: record?.phases?.stimulus || createEmptyPhaseRecord(),
            selectionPopup:
              record?.phases?.selectionPopup || createEmptyPhaseRecord(),
          },
        };
      }),
    },
    null,
    2,
  );
}

export function markExportTime(session, type) {
  if (type === "json") {
    session.exports.lastJsonDownloadAt = nowIso();
  }
  if (type === "csv") {
    session.exports.lastCsvDownloadAt = nowIso();
  }
  if (type === "heatmap") {
    session.exports.lastHeatmapDownloadAt = nowIso();
  }
  return saveCurrentSession(session);
}

export function parseImportedJson(rawText) {
  const parsed = safeParse(rawText, null);
  if (!parsed) {
    return [];
  }

  if (Array.isArray(parsed)) {
    return parsed.filter((entry) => entry?.participantId);
  }

  if (parsed.participantId) {
    return [parsed];
  }

  if (Array.isArray(parsed.pages) && parsed.studyId) {
    return [parsed];
  }

  return [];
}

export function computeAggregateStats(sessions, config) {
  const participantCount = sessions.filter((session) => session.consent?.granted).length;
  const pageMap = new Map();
  sessions.forEach((session) => {
    resolveStimulusPlan(session, config).forEach((page) => {
      if (!pageMap.has(page.id)) {
        pageMap.set(page.id, page);
      }
    });
  });

  if (!pageMap.size) {
    resolveStimulusPlan(null, config).forEach((page) => {
      pageMap.set(page.id, page);
    });
  }

  const perPage = Array.from(pageMap.values()).map((page) => {
    const counts = new Map(page.options.map((option) => [option.id, 0]));
    const times = [];

    sessions.forEach((session) => {
      const record = session.pages?.[page.id];
      if (!record) {
        return;
      }

      if (record.selection && counts.has(record.selection)) {
        counts.set(record.selection, counts.get(record.selection) + 1);
      }

      if (Number.isFinite(record.timeOnPageMs) && record.timeOnPageMs > 0) {
        times.push(record.timeOnPageMs);
      }
    });

    let topChoiceId = null;
    let topChoiceCount = -1;
    counts.forEach((value, key) => {
      if (value > topChoiceCount) {
        topChoiceId = key;
        topChoiceCount = value;
      }
    });

    const topChoice = page.options.find((option) => option.id === topChoiceId);
    const averageTimeMs =
      times.length > 0
        ? Math.round(times.reduce((sum, value) => sum + value, 0) / times.length)
        : 0;

    return {
      pageId: page.id,
      pageTitle: page.title,
      familyLabel: page.familyLabel || "",
      caseId: page.caseId || "",
      participantResponses: times.length,
      averageTimeMs,
      topChoiceId,
      topChoiceLabel: topChoice?.label || "No selections yet",
      topChoiceTitle: topChoice?.title || "No selections yet",
    };
  });

  return {
    participantCount,
    completedSessions: sessions.filter((session) => session.status === "completed").length,
    perPage,
  };
}
