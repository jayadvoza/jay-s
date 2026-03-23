/**
 * ConstrAction Form Tracker
 * ─────────────────────────────────────────────────────────────────────────────
 * Paste this into your GHL Landing Page → Custom Code → Header or Footer.
 *
 * It intercepts every wizard step change and sends APP.data to Supabase so
 * you get a complete record even if the user never finishes the form.
 *
 * On final submit it also triggers GHL contact creation server-side.
 * ─────────────────────────────────────────────────────────────────────────────
 */
(function () {
  'use strict';

  // ── !! CHANGE THIS !! ─────────────────────────────────────────────────────
  var CAPTURE_URL = 'https://YOUR_PROJECT_ID.supabase.co/functions/v1/form-capture';
  // ─────────────────────────────────────────────────────────────────────────

  // ── Session ID ────────────────────────────────────────────────────────────
  // Persisted in localStorage so refreshing the page continues the same record.
  var SESSION_KEY = 'ca_form_session';

  function getSessionId() {
    try {
      var stored = localStorage.getItem(SESSION_KEY);
      if (stored) return stored;
      var id = 'ca_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2);
      localStorage.setItem(SESSION_KEY, id);
      return id;
    } catch (_) {
      // localStorage blocked (private mode etc.) — use a one-time ID
      return 'ca_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2);
    }
  }

  var SESSION_ID = getSessionId();
  var lastCapturedStep = -1;

  // ── Send data to Supabase ─────────────────────────────────────────────────
  function capture(step, completed) {
    if (!window.APP || !APP.data) return;

    // Skip duplicate calls for the same step (e.g. multiple renders)
    // but always send the final submit.
    if (!completed && step === lastCapturedStep) return;
    lastCapturedStep = step;

    var payload = {
      session_id:   SESSION_ID,
      step_reached: step,
      form_data:    JSON.parse(JSON.stringify(APP.data)), // snapshot
      completed:    !!completed,
    };

    fetch(CAPTURE_URL, {
      method:    'POST',
      headers:   { 'Content-Type': 'application/json' },
      body:      JSON.stringify(payload),
      keepalive: true, // fires even if the page is closing
    }).catch(function (err) {
      console.warn('[Tracker] capture failed:', err);
    });
  }

  // ── Patch wizard functions ────────────────────────────────────────────────
  function patchFunctions() {
    if (!window.APP) {
      // APP isn't ready yet — retry
      setTimeout(patchFunctions, 300);
      return;
    }

    // goNext() — user advances a slide
    var origGoNext = window.goNext;
    window.goNext = function () {
      capture(APP.step, false);
      return origGoNext.apply(this, arguments);
    };

    // generate() — user clicks "Generate My Contract" (final step)
    var origGenerate = window.generate;
    window.generate = function () {
      capture(APP.step, true);
      return origGenerate.apply(this, arguments);
    };

    // selectRole() — very first interaction (role selection)
    var origSelectRole = window.selectRole;
    window.selectRole = function () {
      var result = origSelectRole.apply(this, arguments);
      // Capture after role sets APP.role
      setTimeout(function () { capture(0, false); }, 50);
      return result;
    };

    // Capture when user closes the tab / navigates away mid-form
    window.addEventListener('beforeunload', function () {
      capture(APP.step || 0, false);
    });

    console.log('[Tracker] ready — session:', SESSION_ID);
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', patchFunctions);
  } else {
    patchFunctions();
  }
})();
