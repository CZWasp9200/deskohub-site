type LocalFontSource = { readonly path: string; readonly weight?: string };

type LocalFontOptions = {
  readonly src: string | LocalFontSource[];
  readonly weight?: string;
  readonly variable?: string;
  readonly declarations?: readonly { prop: string; value: string }[];
};

/**
 * Every face the stand-in created, keyed by its family, with its files
 * (paths as the declaring module wrote them), weights and declarations, so a
 * browser test can declare the same faces production serves.
 */
export const nextFontLocalFaces = new Map<
  string,
  {
    readonly sources: readonly LocalFontSource[];
    readonly declarations: readonly { prop: string; value: string }[];
  }
>();

/**
 * A `next/font/local` stand-in for `mock.module("next/font/local")`: outside
 * a Next.js build a font's family list is its quoted source path (the first
 * file's, for a font of several files), and its variable is the one it names. Every test file that loads fonts uses this
 * one, because Bun shares a module mock across the files of a run.
 */
export const nextFontLocal = {
  default: ({ src, weight, variable, declarations = [] }: LocalFontOptions) => {
    const sources = Array.isArray(src) ? src : [{ path: src, weight }];
    const fontFamily = `'${sources[0]?.path}'`;
    nextFontLocalFaces.set(fontFamily, { sources, declarations });
    return { variable, style: { fontFamily } };
  },
};
