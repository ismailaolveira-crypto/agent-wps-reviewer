#!/usr/bin/env node
import { readFile } from 'node:fs/promises';

function printHelp() {
  console.log(`Usage:
  wps-suggest --anchor "original text" --comment "review comment" [--replacement "new text"]
  wps-suggest --file examples/sample-suggestion.json
  echo '{"anchorText":"...","comment":"..."}' | wps-suggest

Options:
  --server URL          Bridge URL, default http://127.0.0.1:17531
  --doc ID             WPS document session id, default default
  --agent NAME         Source agent name, default codex
  --anchor TEXT        Anchor text in the document
  --before TEXT        Context before the anchor
  --after TEXT         Context after the anchor
  --comment TEXT       Comment to insert into WPS
  --replacement TEXT   Optional replacement text
  --reason TEXT        Optional reason shown in the side panel
  --severity LEVEL     info, minor, major, critical
  --file PATH          Read JSON payload from file
  --token TOKEN        Optional agent API token, or WPS_REVIEWER_TOKEN env
`);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith('--')) continue;
    const name = key.slice(2);
    if (name === 'help') {
      args.help = true;
      continue;
    }
    args[name] = argv[i + 1];
    i += 1;
  }
  return args;
}

async function readStdinIfAvailable() {
  if (process.stdin.isTTY) return '';
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8').trim();
}

async function buildPayload(args) {
  if (args.file) {
    return JSON.parse(await readFile(args.file, 'utf8'));
  }

  const stdin = await readStdinIfAvailable();
  if (stdin) return JSON.parse(stdin);

  return {
    docSessionId: args.doc ?? 'default',
    sourceAgent: args.agent ?? 'codex',
    anchorText: args.anchor,
    contextBefore: args.before,
    contextAfter: args.after,
    comment: args.comment,
    replacement: args.replacement,
    reason: args.reason,
    severity: args.severity ?? 'minor'
  };
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  printHelp();
  process.exit(0);
}

const serverUrl = args.server ?? process.env.WPS_REVIEWER_URL ?? 'http://127.0.0.1:17531';
const token = args.token ?? process.env.WPS_REVIEWER_TOKEN ?? '';
const payload = await buildPayload(args);

const response = await fetch(new URL('/api/suggestions', serverUrl), {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    ...(token ? { authorization: `Bearer ${token}`, 'x-wps-reviewer-token': token } : {})
  },
  body: JSON.stringify(payload)
});

const body = await response.json().catch(() => ({}));
if (!response.ok) {
  console.error(JSON.stringify(body, null, 2));
  process.exit(1);
}

console.log(JSON.stringify(body, null, 2));
