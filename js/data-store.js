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

function ensureRemoteSubmissionShape(session, config) {
  session.remoteSubmission = {
    provider: config.remoteStorage?.provider || null,
    status: "idle",
    attempts: 0,
    lastAttemptAt: null,
    submittedAt: null,
    lastError: null,
    duplicate: false,
    ...(session.remoteSubmission || {}),
  };

  return session;
}

export function createSession(config) {
  return ensureRemoteSubmissionShape({
    schemaVersion: 1,
    studyId: config.studyId,
    studyTitle: config.studyTitle,
    participantId: generateId(),
    createdAt: nowIso(),
    updatedAt: nowIso(),
    status: "created",
    deviceInfo: getDeviceInfo(),
    consent: {
      granted: false,
      timestamp: null,
      declinedAt: null,
    },
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
    stimulusOrder: config.stimulusPages.map((page) => page.id),
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
  localStorage.setItem(STORAGE_KEYS.currentSession, JSON.stringify(session));
  return session;
}

export function loadCurrentSession(config) {
  const session = safeParse(localStorage.getItem(STORAGE_KEYS.currentSession), null);

  if (!session || session.studyId !== config.studyId) {
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
    session.pages[page.id] = {
      pageId: page.id,
      pageTitle: page.title,
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
    };
  }

  const record = session.pages[page.id];
  record.startedAt = nowIso();
  record.endedAt = null;
  record.timeOnPageMs = 0;
  record.selection = record.selection || null;
  session.status = "in-progress";
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

export function appendGazePoint(session, pageId, sample) {
  const record = session.pages[pageId];
  if (!record) {
    return session;
  }

  record.gazePoints.push(sample);
  if (sample.valid) {
    record.validSampleCount += 1;
  } else {
    record.invalidSampleCount += 1;
  }

  const totalSamples = record.validSampleCount + record.invalidSampleCount;
  if (totalSamples % 10 === 0) {
    return saveCurrentSession(session);
  }

  return session;
}

export function completeStimulusPage(session, pageId, timeOnPageMs) {
  const record = session.pages[pageId];
  if (!record) {
    return session;
  }

  record.endedAt = nowIso();
  record.timeOnPageMs = Math.round(timeOnPageMs);
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
  session.remoteSubmission = {
    ...(session.remoteSubmission || {}),
    status: "submitted",
    submittedAt: nowIso(),
    lastError: null,
    duplicate: Boolean(options.duplicate),
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
  const imported = getImportedSessions();
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
    "study_id",
    "consent_timestamp",
    "page_id",
    "image_set_id",
    "selection",
    "selected_label",
    "time_on_page_ms",
    "valid_sample_count",
    "invalid_sample_count",
  ];

  const rows = config.stimulusPages.map((page) => {
    const record = session.pages[page.id] || {};
    return [
      session.participantId,
      session.studyId,
      session.consent.timestamp || "",
      page.id,
      page.imageSetId,
      record.selection || "",
      record.selectedLabel || "",
      record.timeOnPageMs || 0,
      record.validSampleCount || 0,
      record.invalidSampleCount || 0,
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
      studyId: session.studyId,
      exportedAt: nowIso(),
      pages: config.stimulusPages.map((page) => {
        const record = session.pages[page.id];
        return {
          pageId: page.id,
          imageSetId: page.imageSetId,
          selection: record?.selection || null,
          timeOnPageMs: record?.timeOnPageMs || 0,
          gazePoints: record?.gazePoints || [],
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

  const perPage = config.stimulusPages.map((page) => {
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
