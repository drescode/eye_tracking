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
    this.beginPerformanceNow = 0;
    this.predictionPollTimer = null;
    this.hasSeenValidPrediction = false;
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
        throw new Error(
          "This browser does not meet WebGazer's compatibility requirements.",
        );
      }

      if (typeof webgazer.begin !== "function") {
        throw new Error("WebGazer loaded, but begin() is unavailable.");
      }

      if (typeof webgazer.setCameraConstraints === "function") {
        webgazer.setCameraConstraints({
          audio: false,
          video: {
            facingMode: "user",
            width: { ideal: 640 },
            height: { ideal: 480 },
            frameRate: { ideal: 24, max: 30 },
          },
        });
      }

      if (typeof webgazer.clearData === "function") {
        webgazer.clearData();
      }

      phase = "begin";
      await new Promise((resolve, reject) => {
        let settled = false;

        const finish = (error) => {
          if (settled) {
            return;
          }
          settled = true;
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        };

        try {
          webgazer.begin((error) => finish(error || null));
        } catch (error) {
          finish(error);
          return;
        }

        window.setTimeout(() => finish(null), 4500);
      });

      phase = "post-start configuration";
      if (typeof webgazer.setRegression === "function") {
        try {
          webgazer.setRegression("threadedRidge");
        } catch (_error) {
          webgazer.setRegression("ridge");
        }
      }

      if (typeof webgazer.saveDataAcrossSessions === "function") {
        webgazer.saveDataAcrossSessions(false);
      }

      if (typeof webgazer.applyKalmanFilter === "function") {
        webgazer.applyKalmanFilter(true);
      }

      this.initialized = true;
      this.beginPerformanceNow = performance.now();
      this.lastValidAt = 0;
      this.hasSeenValidPrediction = false;
      this.updateWebgazerVisibility();
      this.startPredictionPolling();
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

  updateWebgazerVisibility() {
    const webgazer = window.webgazer;
    const showPreview = this.initialized || this.calibrating || Boolean(this.pageId);

    if (webgazer && typeof webgazer.showVideo === "function") {
      webgazer.showVideo(showPreview);
    }

    if (webgazer && typeof webgazer.showFaceOverlay === "function") {
      webgazer.showFaceOverlay(showPreview);
    }

    if (webgazer && typeof webgazer.showFaceFeedbackBox === "function") {
      webgazer.showFaceFeedbackBox(showPreview);
    }

    if (webgazer && typeof webgazer.showPredictionPoints === "function") {
      webgazer.showPredictionPoints(false);
    }

    const videoFeed = document.getElementById("webgazerVideoFeed");
    const videoCanvas = document.getElementById("webgazerVideoCanvas");

    [videoFeed, videoCanvas].forEach((element) => {
      if (!element) {
        return;
      }

      element.style.display = showPreview ? "block" : "none";
      element.style.position = "fixed";
      element.style.right = "18px";
      element.style.bottom = "18px";
      element.style.width = "220px";
      element.style.height = "auto";
      element.style.maxWidth = "min(220px, calc(100vw - 36px))";
      element.style.borderRadius = "12px";
      element.style.zIndex = "40";
      element.style.background = "#fffdfa";
      element.style.boxShadow = "0 18px 36px rgba(51, 39, 25, 0.16)";
    });

    if (videoCanvas) {
      videoCanvas.style.pointerEvents = "none";
    }
  }

  startPredictionPolling() {
    this.stopPredictionPolling();

    const webgazer = window.webgazer;
    if (!webgazer || typeof webgazer.getCurrentPrediction !== "function") {
      return;
    }

    this.predictionPollTimer = window.setInterval(() => {
      if (!this.initialized) {
        return;
      }

      try {
        const prediction = webgazer.getCurrentPrediction();
        const elapsedTimeMs = Math.round(
          performance.now() - this.beginPerformanceNow,
        );
        this.handleGazeSample(prediction, elapsedTimeMs);
      } catch (_error) {
        // Keep polling even if one prediction request fails.
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
    this.updateWebgazerVisibility();
    this.setStatus(
      enabled
        ? "calibrating"
        : this.pageId
          ? "tracking active"
          : "webcam active",
    );
  }

  setPageContext(pageId, getBounds) {
    this.pageId = pageId;
    this.pageBoundsGetter = getBounds || null;
    this.lastSmoothedPoint = null;
    this.updateWebgazerVisibility();

    if (window.webgazer && typeof window.webgazer.resume === "function") {
      window.webgazer.resume();
    }
  }

  clearPageContext() {
    this.pageId = null;
    this.pageBoundsGetter = null;
    this.latestPoint = null;
    this.lastSmoothedPoint = null;
    this.updateWebgazerVisibility();

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
      this.hasSeenValidPrediction = true;

      if (!this.calibrating) {
        this.setStatus(this.pageId ? "tracking active" : "webcam active");
      }

      if (shouldEmit && this.pageId) {
        this.lastEmitAt = now;
        this.onSample(payload);
      }

      return;
    }

    if (
      !this.calibrating &&
      this.pageId &&
      this.hasSeenValidPrediction &&
      now - this.lastValidAt > this.missingFaceTimeoutMs
    ) {
      this.setStatus("tracking unstable");
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
    const webgazer = window.webgazer;
    if (!webgazer) {
      return;
    }

    try {
      this.stopPredictionPolling();
      if (typeof webgazer.pause === "function") {
        webgazer.pause();
      }
      if (typeof webgazer.end === "function") {
        webgazer.end();
      }
    } catch (error) {
      this.onError(error);
    } finally {
      this.initialized = false;
      this.clearPageContext();
    }
  }
}
