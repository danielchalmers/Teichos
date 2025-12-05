/**
 * esbuild configuration for development and production builds
 */

import * as esbuild from 'esbuild';
import { copyFile, mkdir, cp } from 'fs/promises';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const isWatch = process.argv.includes('--watch');
const isDev = process.argv.includes('--dev') || isWatch;

/** Entry points for each extension context */
const entryPoints = [
  'src/background/index.ts',
  'src/popup/index.ts',
  'src/options/index.ts',
  'src/blocked/index.ts',
];

/** esbuild configuration */
const buildOptions: esbuild.BuildOptions = {
  entryPoints,
  bundle: true,
  outdir: 'dist',
  outbase: 'src',
  format: 'esm',
  target: 'chrome88',
  sourcemap: isDev ? 'inline' : false,
  minify: !isDev,
  drop: isDev ? [] : ['console'],
  logLevel: 'info',
};

/**
 * Copy static files to dist
 */
async function copyStaticFiles(): Promise<void> {
  const distDir = join(__dirname, 'dist');
  
  // Ensure dist directories exist
  const dirs = [
    distDir,
    join(distDir, 'popup/styles'),
    join(distDir, 'options/styles'),
    join(distDir, 'blocked/styles'),
    join(distDir, 'assets/icons'),
  ];
  
  for (const dir of dirs) {
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
  }
  
  // Copy files
  const copies = [
    // Manifest
    { from: 'public/manifest.json', to: 'dist/manifest.json' },
    
    // HTML files
    { from: 'src/popup/index.html', to: 'dist/popup/index.html' },
    { from: 'src/options/index.html', to: 'dist/options/index.html' },
    { from: 'src/blocked/index.html', to: 'dist/blocked/index.html' },
    
    // CSS files
    { from: 'src/popup/styles/popup.css', to: 'dist/popup/styles/popup.css' },
    { from: 'src/options/styles/options.css', to: 'dist/options/styles/options.css' },
    { from: 'src/blocked/styles/blocked.css', to: 'dist/blocked/styles/blocked.css' },
  ];
  
  for (const { from, to } of copies) {
    const fromPath = join(__dirname, from);
    const toPath = join(__dirname, to);
    if (existsSync(fromPath)) {
      await copyFile(fromPath, toPath);
    }
  }
  
  // Copy icons directory
  const iconsFrom = join(__dirname, 'src/assets/icons');
  const iconsTo = join(__dirname, 'dist/assets/icons');
  if (existsSync(iconsFrom)) {
    await cp(iconsFrom, iconsTo, { recursive: true });
  }
  
  console.log('Static files copied');
}

/**
 * Main build function
 */
async function build(): Promise<void> {
  await copyStaticFiles();
  
  if (isWatch) {
    const ctx = await esbuild.context(buildOptions);
    await ctx.watch();
    console.log('Watching for changes...');
  } else {
    await esbuild.build(buildOptions);
    console.log('Build complete');
  }
}

build().catch((error) => {
  console.error('Build failed:', error);
  process.exit(1);
});
