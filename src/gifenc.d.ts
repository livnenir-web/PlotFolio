declare module "gifenc" {
  export type GifPalette = number[][];
  export interface GifEncoder {
    writeFrame(index: Uint8Array, width: number, height: number, opts?: { palette?: GifPalette; delay?: number; repeat?: number; transparent?: boolean; transparentIndex?: number; dispose?: number; first?: boolean }): void;
    finish(): void;
    bytes(): Uint8Array;
    reset(): void;
  }
  export function GIFEncoder(opts?: { initialCapacity?: number; auto?: boolean }): GifEncoder;
  export function quantize(rgba: Uint8Array | Uint8ClampedArray, maxColors: number, opts?: { format?: "rgb565" | "rgb444" | "rgba4444"; oneBitAlpha?: boolean | number; clearAlpha?: boolean; clearAlphaThreshold?: number; clearAlphaColor?: number }): GifPalette;
  export function applyPalette(rgba: Uint8Array | Uint8ClampedArray, palette: GifPalette, format?: "rgb565" | "rgb444" | "rgba4444"): Uint8Array;
}
