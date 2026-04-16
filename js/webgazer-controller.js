export class WebgazerController {
  constructor(options = {}) {
    this.sampleIntervalMs = options.sampleIntervalMs ?? 50;
    this.smoothingFactor = options.smoothingFactor ?? 0.3;
    this.missingFaceTimeoutMs = options.missingFaceTimeoutMs ?? 1500;
    this.onSample = options.onSample ?? (() => {});
    this.onStatusChange = options.onStatusChange ?? (() => {});
    this.onError = options.onError ?? (() => {});

    this.initialized = false;
    this.calibrating = false;
    this.pageId = null;
    this.pageBoundsGetter = null;
    this.lastEmitAt = 0;
    this.lastValidAt = 0;
    this.lastSmoothedPoint = null;
    this.latestPoint = null;
    this.lastListenerSampleAt = 0;
    this.beginPerformanceNow = 0;
    this.predictionPollTimer = null;
  }

  async initialize() {
    if (!window.webgazer) {
      throw new Error("WebGazer.js failed to load.");
    }

    const ua = navigator.userAgent;
    const isIOS = /iPhone|iPad|iPod/i.test(ua);
    const isSafari =
      /Safari/i.test(ua) && !/Chrome|CriOS|Edg|OPR|Chromium/i.test(ua);

    if (isIOS) {
      throw new Error(
        "This prototype currently works best on desktop Chrome or Edge. iPhone and iPad browsers are not supported reliably.",
      );
    }

    if (isSafari) {
      throw new Error(
        "This prototype currently works best on desktop Chrome or Edge. Safari is not supported reliably for WebGazer.",
      );
    }

    const webgazer = window.webgazer;
    let phase = "preflight";

    try {
      if (
        typeof webgazer.detectCompatibility === "function" &&
        webgazer.detectCompatibility() === false
      ) {
        throw new Error("This browser does not meet WebGazer's compatibility requirements.");
      }

      if (typeof webgazer.setGazeListener !== "function") {
        throw new Error("WebGazer is loaded but the gaze listener API is unavailable.");
      }

      if (typeof webgazer.begin !== "function") {
        throw new Error("WebGazer loaded, but begin() is unavailable.");
      }

      phase = "begin";
      this.beginPerformanceNow = performance.now();
      this.lastListenerSampleAt = 0;
      const started = webgazer
        .setTracker("clmtrackr")
        .setRegression("ridge")
        .setGazeListener((data, elapsedTime) => {
          this.lastListenerSampleAt = Date.now();
          this.handleGazeSample(data, elapsedTime);
        })
        .begin();

      await Promise.resolve(started);

      phase = "post-start configuration";
      if (typeof webgazer.saveDataAcrossSessions === "function") {
        webgazer.saveDataAcrossSessions(false);
      }

      if (typeof webgazer.applyKalmanFilter === "function") {
        webgazer.applyKalmanFilter(true);
      }

      if (typeof webgazer.showVideo === "function") {
        webgazer.showVideo(false);
      }

      if (typeof webgazer.showFaceOverlay === "function") {
        webgazer.showFaceOverlay(false);
      }

      if (typeof webgazer.showFaceFeedbackBox === "function") {
        webgazer.showFaceFeedbackBox(false);
      }

      if (typeof webgazer.showPredictionPoints === "function") {
        webgazer.showPredictionPoints(false);
      }

      this.initialized = true;
      this.startPredictionPolling(webgazer);
      this.setStatus("webcam active");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const enhancedError = new Error(
        `WebGazer initialization failed during ${phase}: ${message}`,
      );
      enhancedError.cause = error;
      this.onError(enhancedError);
      throw enhancedError;
    }
  }

  setStatus(status) {
    this.onStatusChange(status);
  }

  startPredictionPolling(webgazer) {
    this.stopPredictionPolling();

    if (typeof webgazer?.getCurrentPrediction !== "function") {
      return;
    }

    const quietWindowMs = Math.max(250, this.sampleIntervalMs * 3);
    this.predictionPollTimer = window.setInterval(async () => {
      if (!this.initialized) {
        return;
      }

      if (
        this.lastListenerSampleAt &&
        Date.now() - this.lastListenerSampleAt < quietWindowMs
      ) {
        return;
      }

      try {
        const prediction = await Promise.resolve(
          webgazer.getCurrentPrediction(),
        );
        const elapsedTimeMs = Math.round(
          performance.now() - this.beginPerformanceNow,
        );
        this.handleGazeSample(prediction, elapsedTimeMs);
      } catch (_error) {
        // Ignore polling failures and keep the listener path active.
      }
    }, this.sampleIntervalMs);
  }

  stopPredictionPolling() {
    if (this.predictionPollTimer) {
      window.clearInterval(this.predictionPollTimer);
      this.predictionPollTimer = null;
    }
  }

  setCalibrationMode(enabled) {
    this.calibrating = enabled;
    this.setStatus(enabled ? "calibrating" : this.pageId ? "tracking active" : "webcam active");
  }

  setPageContext(pageId, getBounds) {
    this.pageId = pageId;
    this.pageBoundsGetter = getBounds || null;
    this.lastSmoothedPoint = null;
  }

  clearPageContext() {
    this.pageId = null;
    this.pageBoundsGetter = null;
    this.latestPoint = null;
    this.lastSmoothedPoint = null;
    if (!this.calibrating) {
      this.setStatus(this.initialized ? "webcam active" : "awaiting consent");
    }
  }

  getLatestPoint() {
    return this.latestPoint;
  }

  handleGazeSample(data, elapsedTime) {
    if (!this.initialized) {
      return;
    }

    const now = Date.now();
    const shouldEmit = now - this.lastEmitAt >= this.sampleIntervalMs;
    const hasPrediction =
      data && Number.isFinite(data.x) && Number.isFinite(data.y);

    if (hasPrediction) {
      const smoothed = this.smoothPoint(data.x, data.y);
      const payload = {
        timestamp: new Date(now).toISOString(),
        elapsedTimeMs: Math.round(elapsedTime ?? 0),
        pageId: this.pageId,
        valid: true,
        rawX: data.x,
        rawY: data.y,
        x: smoothed.x,
        y: smoothed.y,
        ...this.describeRelativePosition(smoothed.x, smoothed.y),
      };

      this.latestPoint = payload;
      this.lastValidAt = now;

      if (!this.calibrating) {
        this.setStatus(this.pageId ? "tracking active" : "webcam active");
      }

      if (shouldEmit) {
        this.lastEmitAt = now;
        this.onSample(payload);
      }

      return;
    }

    if (!this.calibrating && now - this.lastValidAt > this.missingFaceTimeoutMs) {
      this.setStatus(this.pageId ? "face not detected" : "webcam active");
    }

    if (shouldEmit && this.pageId) {
      this.lastEmitAt = now;
      this.onSample({
        timestamp: new Date(now).toISOString(),
        elapsedTimeMs: Math.round(elapsedTime ?? 0),
        pageId: this.pageId,
        valid: false,
        rawX: null,
        rawY: null,
        x: null,
        y: null,
        relativeX: null,
        relativeY: null,
        pageWidth: null,
        pageHeight: null,
        inBounds: false,
      });
    }
  }

  smoothPoint(x, y) {
    if (!this.lastSmoothedPoint) {
      this.lastSmoothedPoint = { x, y };
      return this.lastSmoothedPoint;
    }

    const alpha = this.smoothingFactor;
    this.lastSmoothedPoint = {
      x: this.lastSmoothedPoint.x + alpha * (x - this.lastSmoothedPoint.x),
      y: this.lastSmoothedPoint.y + alpha * (y - this.lastSmoothedPoint.y),
    };

    return this.lastSmoothedPoint;
  }

  describeRelativePosition(x, y) {
    if (!this.pageBoundsGetter) {
      return {
        relativeX: null,
        relativeY: null,
        pageWidth: null,
        pageHeight: null,
        inBounds: false,
      };
    }

    const rect = this.pageBoundsGetter();
    if (!rect || !rect.width || !rect.height) {
      return {
        relativeX: null,
        relativeY: null,
        pageWidth: null,
        pageHeight: null,
        inBounds: false,
      };
    }

    const relativeX = x - rect.left;
    const relativeY = y - rect.top;

    return {
      relativeX,
      relativeY,
      pageWidth: rect.width,
      pageHeight: rect.height,
      inBounds:
        relativeX >= 0 &&
        relativeY >= 0 &&
        relativeX <= rect.width &&
        relativeY <= rect.height,
    };
  }

  async stop() {
    if (!window.webgazer) {
      return;
    }

    try {
      this.stopPredictionPolling();
      if (typeof window.webgazer.end === "function") {
        await window.webgazer.end();
      }
    } catch (error) {
      this.onError(error);
    } finally {
      this.initialized = false;
      this.clearPageContext();
    }
  }
}
