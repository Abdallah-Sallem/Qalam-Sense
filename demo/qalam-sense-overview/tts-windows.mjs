#!/usr/bin/env node
/**
 * Free, offline narration with the Windows built-in voice (System.Speech),
 * used because the fal.ai account had no credit. Produces the same artifacts
 * as DemoDay's gen/tts.mjs — audio/<id>.mp3 and audio/<id>.words.json — and
 * records narrationSec / durationSec in demo.json, so the rest of the
 * pipeline (capture pacing, captions, render) works unchanged.
 *
 *   node demo/qalam-sense-overview/tts-windows.mjs [--voice "Microsoft Zira Desktop"] [--rate -1]
 *
 * Swap back to the AI voice later with gen/tts.mjs --all --force.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const VOICE = opt('voice', 'Microsoft Zira Desktop');
const RATE = Number(opt('rate', '-1'));
const manifestPath = path.join(dir, 'demo.json');
const m = JSON.parse(readFileSync(manifestPath, 'utf8'));
const breath = m.pacing?.breathSec ?? 0.45;
mkdirSync(path.join(dir, 'audio'), { recursive: true });

const ps = (text, wavPath, jsonPath) => `
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$s.SelectVoice('${VOICE}')
$s.Rate = ${RATE}
$words = New-Object System.Collections.ArrayList
Register-ObjectEvent -InputObject $s -EventName SpeakProgress -SourceIdentifier qs -Action {
  [void]$Event.MessageData.Add([pscustomobject]@{ text = $EventArgs.Text; startSec = $EventArgs.AudioPosition.TotalSeconds })
} -MessageData $words | Out-Null
$s.SetOutputToWaveFile('${wavPath.replace(/'/g, "''")}')
$s.Speak([IO.File]::ReadAllText('${jsonPath.replace(/'/g, "''")}.txt'))
$s.SetOutputToNull()
Start-Sleep -Milliseconds 300
Unregister-Event qs
$s.Dispose()
$words | ConvertTo-Json -Compress | Set-Content -Encoding utf8 '${jsonPath.replace(/'/g, "''")}'
`;

for (const scene of m.timeline.filter((s) => s.narration)) {
  const wav = path.join(dir, 'audio', `${scene.id}.wav`);
  const mp3 = path.join(dir, 'audio', `${scene.id}.mp3`);
  const raw = path.join(dir, 'audio', `${scene.id}.raw.json`);
  writeFileSync(`${raw}.txt`, scene.narration, 'utf8');
  execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps(scene.narration, wav, raw)], { stdio: 'inherit' });
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', wav, '-codec:a', 'libmp3lame', '-q:a', '2', mp3]);
  const duration = Number(
    execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', mp3]).toString().trim(),
  );
  const events = JSON.parse(readFileSync(raw, 'utf8').replace(/^﻿/, '') || '[]');
  const list = Array.isArray(events) ? events : [events];
  const timestamps = list.map((w, i) => ({
    text: String(w.text).trim(),
    startSec: Number(w.startSec.toFixed(3)),
    endSec: Number((i + 1 < list.length ? list[i + 1].startSec - 0.02 : duration - 0.1).toFixed(3)),
  }));
  // The voice reports bare words; put the script's punctuation back for captions.
  const tokens = scene.narration.split(/s+/).filter(Boolean);
  if (tokens.length === timestamps.length) timestamps.forEach((w, i) => (w.text = tokens[i]));
  writeFileSync(
    path.join(dir, 'audio', `${scene.id}.words.json`),
    `${JSON.stringify({ text: scene.narration, voice: VOICE, model: 'windows-system-speech', timestamps }, null, 2)}\n`,
  );
  for (const f of [wav, raw, `${raw}.txt`]) rmSync(f, { force: true });
  scene.audio = `audio/${scene.id}.mp3`;
  scene.words = `audio/${scene.id}.words.json`;
  scene.narrationSec = Number(duration.toFixed(2));
  scene.durationSec = Number((duration + breath).toFixed(2));
  console.log(`${scene.id}: ${duration.toFixed(2)}s speech, ${timestamps.length} words`);
}
// demo.json keeps a valid provider; see voice.note there.
writeFileSync(manifestPath, `${JSON.stringify(m, null, 2)}\n`);
