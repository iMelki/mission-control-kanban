/**
 * WCAG 2.x sRGB relative-luminance contrast helpers.
 *
 * Used to prove muted-text tokens against the real composited cockpit
 * backgrounds instead of guessing from class names.
 */

export type Rgb = readonly [number, number, number];

export function parseHexColor(hex: string): Rgb {
  const normalized = hex.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    throw new Error(`parseHexColor expected #RRGGBB, got ${JSON.stringify(hex)}`);
  }
  return [
    Number.parseInt(normalized.slice(0, 2), 16),
    Number.parseInt(normalized.slice(2, 4), 16),
    Number.parseInt(normalized.slice(4, 6), 16),
  ];
}

export function srgbChannelToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(rgb: Rgb): number {
  const [r, g, b] = rgb;
  return (
    0.2126 * srgbChannelToLinear(r) +
    0.7152 * srgbChannelToLinear(g) +
    0.0722 * srgbChannelToLinear(b)
  );
}

export function contrastRatio(foreground: Rgb, background: Rgb): number {
  const lighter = Math.max(relativeLuminance(foreground), relativeLuminance(background));
  const darker = Math.min(relativeLuminance(foreground), relativeLuminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

/** Source-over alpha composite of an sRGB foreground onto an opaque background. */
export function compositeOver(foreground: Rgb, alpha: number, background: Rgb): Rgb {
  if (alpha < 0 || alpha > 1) {
    throw new Error(`compositeOver alpha must be 0..1, got ${alpha}`);
  }
  return [
    Math.round(alpha * foreground[0] + (1 - alpha) * background[0]),
    Math.round(alpha * foreground[1] + (1 - alpha) * background[1]),
    Math.round(alpha * foreground[2] + (1 - alpha) * background[2]),
  ];
}

export function contrastRatioRounded(foreground: Rgb, background: Rgb, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(contrastRatio(foreground, background) * factor) / factor;
}
