/** The slice of fontkit's API used here; the package ships no type definitions. */
declare module 'fontkit' {
  export interface Font {
    hasGlyphForCodePoint(codePoint: number): boolean;
  }
  export function create(buffer: Uint8Array): Font;
}
