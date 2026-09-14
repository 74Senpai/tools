export class TimeoutManager {
  public injectDelay: number;
  public networkSpeedValue: number = 1000;

  constructor(minDelay = 500, maxDelay = 6000) {
    this.injectDelay = minDelay;
  }

  updateNetworkSpeed(speedMs: number): void {
    this.networkSpeedValue = speedMs;
    this.injectDelay = Math.min(Math.max(speedMs * 1.5, 500), 6000);
  }
}
