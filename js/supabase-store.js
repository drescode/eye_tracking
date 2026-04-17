import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { getStimulusPlan } from "./config.js?v=20260417v";

let cachedClient = null;
let cachedConfigKey = "";

function getSupabaseSettings(config) {
  return config.remoteStorage?.supabase || {};
}

function isPlaceholder(value = "") {
  return (
    !value ||
    value.includes("YOUR_PROJECT_REF") ||
    value.includes("YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY")
  );
}

export function isSupabaseConfigured(config) {
  const settings = getSupabaseSettings(config);
  return Boolean(
    settings.enabled &&
      settings.table &&
      !isPlaceholder(settings.url) &&
      !isPlaceholder(settings.anonKey),
  );
}

export function getSupabaseConfigurationMessage(config) {
  if (isSupabaseConfigured(config)) {
    return "Supabase automatic submission is configured.";
  }

  return "Automatic submission is not configured yet. Add your Supabase URL, anon key, and table name in js/config.js.";
}

function getSupabaseClient(config) {
  if (!isSupabaseConfigured(config)) {
    throw new Error(getSupabaseConfigurationMessage(config));
  }

  const settings = getSupabaseSettings(config);
  const cacheKey = `${settings.url}|${settings.anonKey}`;

  if (!cachedClient || cachedConfigKey !== cacheKey) {
    cachedClient = createClient(settings.url, settings.anonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: {
        headers: {
          "X-Client-Info": "nm-study-site/1.0",
        },
      },
    });
    cachedConfigKey = cacheKey;
  }

  return cachedClient;
}

function buildPageSummary(session, config) {
  return getStimulusPlan(session, config).map((page) => {
    const record = session.pages?.[page.id] || {};
    const selectionPopupTime =
      record.selectionPopupTimeOnPageMs || 0;
    const selectionPopupValid =
      record.selectionPopupValidSampleCount || 0;
    const selectionPopupInvalid =
      record.selectionPopupInvalidSampleCount || 0;

    return {
      page_id: page.id,
      family_id: page.familyId || null,
      family_label: page.familyLabel || null,
      case_id: page.caseId || null,
      case_title: page.caseTitle || null,
      template: page.template || null,
      image_set_id: page.imageSetId,
      selection: record.selection || null,
      selected_label: record.selectedLabel || null,
      time_on_page_ms: record.timeOnPageMs || 0,
      valid_sample_count: record.validSampleCount || 0,
      invalid_sample_count: record.invalidSampleCount || 0,
      selection_popup_time_on_page_ms: selectionPopupTime,
      selection_popup_valid_sample_count: selectionPopupValid,
      selection_popup_invalid_sample_count: selectionPopupInvalid,
      combined_time_on_page_ms: (record.timeOnPageMs || 0) + selectionPopupTime,
      combined_valid_sample_count:
        (record.validSampleCount || 0) + selectionPopupValid,
      combined_invalid_sample_count:
        (record.invalidSampleCount || 0) + selectionPopupInvalid,
    };
  });
}

export function buildSupabaseSubmission(config, session) {
  const pageSummary = buildPageSummary(session, config);
  const participantProfile = session.participantProfile || {};

  return {
    participant_id: session.participantId,
    study_id: session.studyId,
    consent_timestamp: session.consent?.timestamp || null,
    completed_at: session.completedAt || null,
    age_category: participantProfile.ageCategory || null,
    province: participantProfile.province || null,
    gender_identity: participantProfile.genderIdentity || null,
    online_shopping_frequency: participantProfile.onlineShoppingFrequency || null,
    primary_shopping_device: participantProfile.primaryShoppingDevice || null,
    retailer_familiarity: participantProfile.retailerFamiliarity || null,
    submission_source: "github-pages",
    participant_profile: participantProfile,
    device_info: session.deviceInfo || {},
    page_summary: pageSummary,
    total_valid_samples: pageSummary.reduce(
      (sum, page) => sum + (page.combined_valid_sample_count || 0),
      0,
    ),
    total_invalid_samples: pageSummary.reduce(
      (sum, page) => sum + (page.combined_invalid_sample_count || 0),
      0,
    ),
    session_payload: session,
  };
}

export async function submitSessionToSupabase(config, session) {
  const client = getSupabaseClient(config);
  const settings = getSupabaseSettings(config);
  const payload = buildSupabaseSubmission(config, session);

  const {
    data: rpcData,
    error: rpcError,
  } = await client.rpc("submit_participant_session", { payload });

  if (!rpcError) {
    const resultRow = Array.isArray(rpcData) ? rpcData[0] : rpcData;
    return {
      ok: true,
      duplicate: Boolean(resultRow?.duplicate),
      participantNumber:
        Number.isFinite(resultRow?.participant_number) && resultRow.participant_number > 0
          ? resultRow.participant_number
          : null,
    };
  }

  if (!/submit_participant_session/i.test(rpcError.message || "")) {
    throw new Error(rpcError.message || "Supabase RPC submission failed.");
  }

  const { error } = await client.from(settings.table).insert(payload);

  if (!error) {
    return {
      ok: true,
      duplicate: false,
      participantNumber: null,
    };
  }

  const message = error.message || "Supabase insert failed.";
  if (error.code === "23505" || /duplicate key|unique/i.test(message)) {
    return {
      ok: true,
      duplicate: true,
      participantNumber: null,
    };
  }

  throw new Error(message);
}
