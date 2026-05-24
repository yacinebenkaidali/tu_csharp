import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: ['./src/extension.ts'],
  bundle: true,
  outfile: './out/extension.js',
  // 'vscode' is provided by VS Code at runtime — never bundle it
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  sourcemap: watch,   // source maps for dev; omit in release for smaller size
  minify: !watch,
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log('[esbuild] watching…');
} else {
  await esbuild.build(options);
  console.log('[esbuild] build complete');
}
