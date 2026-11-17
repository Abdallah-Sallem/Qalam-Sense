#!/usr/bin/env node
/**
 * Prepares the on-device vision runtime so the app never loads code or models
 * from a CDN at run time:
 *   1. copies the MediaPipe WASM runtime out of node_modules,
 *   2. downloads the Face Landmarker model once (≈3.7 MB) if it is missing.
 * Safe to re-run; it only does work that is missing.
 */
import { cp, mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const wasmSrc = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const wasmDst = join(root, 'public', 'vision', 'wasm');
const modelDst = join(root, 'public', 'vision', 'face_landmarker.task');
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

const exists = async (p) => stat(p).then(() => true, () => false);

async function main() {
  if (!(await exists(wasmSrc))) {
    console.warn('[vision-assets] @mediapipe/tasks-vision is not installed yet; skipping.');
    return;
  }
  await mkdir(wasmDst, { recursive: true });
  await cp(wasmSrc, wasmDst, { recursive: true });
  console.log('[vision-assets] WASM runtime copied to public/vision/wasm');

  if (await exists(modelDst)) {
    console.log('[vision-assets] model already present');
    return;
  }
  if (process.env.QALAM_SKIP_MODEL_DOWNLOAD === '1') {
    console.warn('[vision-assets] model download skipped (QALAM_SKIP_MODEL_DOWNLOAD=1)');
    return;
  }
  try {
    const res = await fetch(MODEL_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length < 1_000_000) throw new Error(`unexpectedly small file (${bytes.length} bytes)`);
    await writeFile(modelDst, bytes);
    console.log(`[vision-assets] model downloaded (${(bytes.length / 1e6).toFixed(1)} MB)`);
  } catch (err) {
    // Never fail `npm install` because of a network problem: the app reports
    // a clear "vision model missing" error and still works without the camera.
    console.warn(`[vision-assets] could not download the model: ${err.message}`);
    console.warn(`[vision-assets] download it manually from ${MODEL_URL}`);
    console.warn(`[vision-assets] and save it as public/vision/face_landmarker.task`);
  }
}

main();
