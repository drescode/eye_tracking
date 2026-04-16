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
      </div>
      <div class="calibration-status-card">
        <p class="question-label">Calibration Progress</p>
        <h3>Follow the highlighted point</h3>
        <p class="panel-muted">
          Click each active target ${this.config.clicksPerPoint} times. All nine points must reach 3/3 before the study continues.
        </p>
        <p id="calibration-status" class="panel-muted">
          Point 1 of ${this.points.length}. Click the highlighted target ${this.config.clicksPerPoint} times.
        </p>
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
  }

  handleClick(index, button) {
    if (index !== this.activeIndex) {
      return;
    }

    const point = this.points[index];
    point.clicks += 1;
    button.dataset.count = `${point.clicks}/${this.config.clicksPerPoint}`;

    if (window.webgazer?.recordScreenPosition) {
      const rect = button.getBoundingClientRect();
      window.webgazer.recordScreenPosition(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
        "click",
      );
    }

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
    this.statusElement.textContent = `Point ${this.activeIndex + 1} of ${this.points.length}. Click the highlighted target ${this.config.clicksPerPoint} times.`;
  }
}
