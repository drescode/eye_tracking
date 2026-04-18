export class CalibrationSequence {
  constructor(config) {
    this.config = config;
    this.points = config.points.map((point) => ({
      ...point,
      clicks: 0,
    }));
    this.activeIndex = 0;
    this.onProgress = () => {};
    this.onComplete = () => {};
    this.trainingTimer = null;
  }

  mount(container, hooks = {}) {
    this.onProgress = hooks.onProgress || (() => {});
    this.onComplete = hooks.onComplete || (() => {});

    container.innerHTML = `
      <div class="calibration-stage">
        <div class="calibration-grid">
          ${this.points
            .map(
              (point, index) => `
                <button
                  class="calibration-point ${index === 0 ? "is-active" : ""}"
                  type="button"
                  data-point-id="${point.id}"
                  data-count="0/${this.config.clicksPerPoint}"
                  style="left:${point.x}%; top:${point.y}%"
                  aria-label="Calibration point ${index + 1}"
                ></button>
              `,
            )
            .join("")}
        </div>
        <div class="calibration-status-inline">
          <strong>Progress:</strong>
          <span id="calibration-status">
            Point 1 of ${this.points.length}. Click the highlighted target ${this.config.clicksPerPoint} times.
          </span>
        </div>
      </div>
    `;

    this.buttons = Array.from(container.querySelectorAll(".calibration-point"));
    this.statusElement = container.querySelector("#calibration-status");
    this.buttons.forEach((button, index) => {
      if (index !== this.activeIndex) {
        button.disabled = true;
      }

      button.addEventListener("click", () => this.handleClick(index, button));
    });

    this.activatePoint(this.activeIndex);
  }

  handleClick(index, button) {
    if (index !== this.activeIndex) {
      return;
    }

    const point = this.points[index];
    point.clicks += 1;
    button.dataset.count = `${point.clicks}/${this.config.clicksPerPoint}`;

    this.trainCurrentPoint(button);

    this.onProgress({
      pointId: point.id,
      clicks: point.clicks,
      completedPoints: this.points.filter(
        (entry) => entry.clicks >= this.config.clicksPerPoint,
      ).length,
      totalPoints: this.points.length,
    });

    if (point.clicks < this.config.clicksPerPoint) {
      this.statusElement.textContent = `Point ${index + 1} of ${this.points.length}. ${this.config.clicksPerPoint - point.clicks} clicks remaining.`;
      return;
    }

    button.classList.remove("is-active");
    button.classList.add("is-complete");
    button.disabled = true;
    this.stopTraining();
    this.activeIndex += 1;

    if (this.activeIndex >= this.points.length) {
      this.statusElement.textContent = this.config.completionMessage;
      this.onComplete({
        points: this.points,
      });
      return;
    }

    const nextButton = this.buttons[this.activeIndex];
    nextButton.disabled = false;
    nextButton.classList.add("is-active");
    this.activatePoint(this.activeIndex);
    this.statusElement.textContent = `Point ${this.activeIndex + 1} of ${this.points.length}. Click the highlighted target ${this.config.clicksPerPoint} times.`;
  }

  activatePoint(index) {
    const button = this.buttons?.[index];
    if (!button) {
      return;
    }

    this.stopTraining();
    this.trainingTimer = window.setInterval(() => {
      this.trainCurrentPoint(button);
    }, 20);
  }

  trainCurrentPoint(button) {
    const rect = button.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    if (window.webgazer?.watchListener) {
      window.webgazer.watchListener(centerX, centerY);
      return;
    }

    if (window.webgazer?.recordScreenPosition) {
      window.webgazer.recordScreenPosition(centerX, centerY, "click");
    }
  }

  stopTraining() {
    if (this.trainingTimer) {
      window.clearInterval(this.trainingTimer);
      this.trainingTimer = null;
    }
  }
}
