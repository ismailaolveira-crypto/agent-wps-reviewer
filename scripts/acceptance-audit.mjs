#!/usr/bin/env node
import { runAcceptanceAudit } from '../src/acceptance/audit.mjs';

const audit = await runAcceptanceAudit();
console.log(JSON.stringify(audit, null, 2));

if (!audit.ok) {
  process.exitCode = 1;
}
