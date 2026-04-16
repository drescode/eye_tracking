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
  }

  async initialize() {
    if (!window.webgazer) {
      throw new Error("WebGazer.js failed to load.");
    }

    const webgazer = window.webgazer;

    try {
      if (
        typeof webgazer.detectCompatibility === "function" &&
        webgazer.detectCompatibility() === false
      ) {
        throw new Error(
          "This browser does not meet WebGazer's compatibility requirements.",
        );
      }

      let controller = webgazer;

      if (typeof controller.setGazeListener === "function") {
        controller = controller.setGazeListener((data, elapsedTime) => {
          this.handleGazeSample(data, elapsedTime);
        });
      }

      if (typeof controller.saveDataAcrossSessions === "function") {
        controller = controller.saveDataAcrossSessions(false);
      }

      if (typeof controller.applyKalmanFilter === "function") {
        controller = controller.applyKalmanFilter(true);
      }

      if (typeof controller.showVideo === "function") {
        controller = controller.showVideo(false);
      }

      if (typeof controller.showFaceOverlay === "function") {
        controller = controller.showFaceOverlay(false);
      }

      if (typeof controller.showFaceFeedbackBox === "function") {
        controller = controller.showFaceFeedbackBox(false);
      }

      if (typeof controller.showPredictionPoints === "function") {
        controller = controller.showPredictionPoints(false);
      }

      await Promise.resolve(controller.begin());
      this.initialized = true;
      this.setStatus("webcam active");
    } catch (error) {
      this.onError(error);
      throw error;
    }
  }

  setStatus(status) {
    this.onStatusChange(status);
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
