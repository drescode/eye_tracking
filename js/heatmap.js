function normalizePoint(point, width, height) {
  if (
    !point?.valid ||
    !Number.isFinite(point.relativeX) ||
    !Number.isFinite(point.relativeY) ||
    !Number.isFinite(point.pageWidth) ||
    !Number.isFinite(point.pageHeight) ||
    point.pageWidth <= 0 ||
    point.pageHeight <= 0
  ) {
    return null;
  }

  return {
    x: Math.round((point.relativeX / point.pageWidth) * width),
    y: Math.round((point.relativeY / point.pageHeight) * height),
  };
}

export class HeatmapRenderer {
  constructor() {
    this.container = null;
    this.heatmapInstance = null;
    this.heatmapLayer = null;
    this.rawCanvas = null;
    this.liveDot = null;
  }

  ensureLayers(container) {
    if (!container) {
      return;
    }

    const containerChanged = this.container !== container;
    if (!containerChanged && this.heatmapInstance) {
      return;
    }

    this.clear();
    this.container = container;

    this.heatmapLayer = document.createElement("div");
    this.heatmapLayer.className = "stage-overlay";
    this.rawCanvas = document.createElement("canvas");
    this.rawCanvas.className = "raw-points-layer";
    this.liveDot = document.createElement("div");
    this.liveDot.className = "live-dot hidden";

    container.append(this.heatmapLayer, this.rawCanvas, this.liveDot);

    if (window.h337) {
      this.heatmapInstance = window.h337.create({
        container: this.heatmapLayer,
        radius: 42,
        maxOpacity: 0.65,
        minOpacity: 0.02,
        blur: 0.9,
        gradient: {
          0.15: "#4a90e2",
          0.35: "#64c2a6",
          0.55: "#ffd166",
          0.8: "#ef8354",
          1: "#d64550",
        },
      });
    }
  }

  clear() {
    if (this.heatmapLayer?.parentNode) {
      this.heatmapLayer.parentNode.removeChild(this.heatmapLayer);
    }
    if (this.rawCanvas?.parentNode) {
      this.rawCanvas.parentNode.removeChild(this.rawCanvas);
    }
    if (this.liveDot?.parentNode) {
      this.liveDot.parentNode.removeChild(this.liveDot);
    }

    this.container = null;
    this.heatmapInstance = null;
    this.heatmapLayer = null;
    this.rawCanvas = null;
    this.liveDot = null;
  }

  renderHeatmap(container, points) {
    this.ensureLayers(container);
    if (!this.heatmapInstance || !container) {
      return;
    }

    const width = Math.round(container.clientWidth);
    const height = Math.round(container.clientHeight);
    const normalized = points
      .map((point) => normalizePoint(point, width, height))
      .filter(Boolean)
      .map((point) => ({
        ...point,
        value: 1,
      }));

    this.heatmapInstance.setData({
      max: 6,
      data: normalized,
    });
  }

  drawRawPoints(container, points) {
    this.ensureLayers(container);
    if (!this.rawCanvas || !container) {
      return;
    }

    const width = Math.round(container.clientWidth);
    const height = Math.round(container.clientHeight);
    const dpr = window.devicePixelRatio || 1;

    this.rawCanvas.width = width * dpr;
    this.rawCanvas.height = height * dpr;
    this.rawCanvas.style.width = `${width}px`;
    this.rawCanvas.style.height = `${height}px`;

    const context = this.rawCanvas.getContext("2d");
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);
    context.fillStyle = "rgba(214, 69, 80, 0.6)";

    points.forEach((point) => {
      const normalized = normalizePoint(point, width, height);
      if (!normalized) {
        return;
      }
      context.beginPath();
      context.arc(normalized.x, normalized.y, 3, 0, Math.PI * 2);
      context.fill();
    });
  }

  updateLiveDot(container, point) {
    this.ensureLayers(container);
    if (!this.liveDot || !point?.valid) {
      this.liveDot?.classList.add("hidden");
      return;
    }

    const width = Math.round(container.clientWidth);
    const height = Math.round(container.clientHeight);
    const normalized = normalizePoint(point, width, height);

    if (!normalized) {
      this.liveDot.classList.add("hidden");
      return;
    }

    this.liveDot.classList.remove("hidden");
    this.liveDot.style.left = `${normalized.x}px`;
    this.liveDot.style.top = `${normalized.y}px`;
  }
}
