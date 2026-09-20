export interface SyntheticCaptureColor {
  blue: number;
  green: number;
  red: number;
  alpha: number;
}

export function syntheticCaptureColor(displayIndex: number): SyntheticCaptureColor {
  const value = ((displayIndex % 216) + 216) % 216;
  return {
    blue: 40 + (value % 6) * 40,
    green: 40 + (Math.floor(value / 6) % 6) * 40,
    red: 40 + (Math.floor(value / 36) % 6) * 40,
    alpha: 255,
  };
}
