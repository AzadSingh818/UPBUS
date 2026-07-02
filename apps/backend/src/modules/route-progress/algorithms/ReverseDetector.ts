export class ReverseDetector {
  static isReversing(
    previousDistance: number,
    currentDistance: number,
    previousHeading: number,
    currentHeading: number,
    speedKmph: number
  ): boolean {
    if (speedKmph <= 5) {
      // Bus is stationary or very slow, do not trigger reverse state
      return false;
    }

    const distanceDecreased = currentDistance < previousDistance;
    if (!distanceDecreased) return false;

    // Calculate absolute heading difference
    const headingDiff = Math.abs(currentHeading - previousHeading);
    const normalizedDiff = headingDiff > 180 ? 360 - headingDiff : headingDiff;

    // If heading changed by more than 120 degrees (significant turnaround)
    const headingChanged = normalizedDiff > 120;

    return headingChanged;
  }
}
