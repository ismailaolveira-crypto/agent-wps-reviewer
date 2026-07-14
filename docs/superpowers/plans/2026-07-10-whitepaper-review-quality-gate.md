# Whitepaper Review Quality Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure only source-grounded, purpose-aligned, human-reviewed comments matching the 2022-2024 whitepaper style can enter the WPS review queue.

**Architecture:** Add a pure whitepaper review contract validator and a separate document-grounding validator, then call both from the active-document batch route before one atomic store write. Package a self-contained review Skill and historical style profile for GitHub users, disable legacy writes by default, and quarantine existing unverified records through a reversible maintenance command.

**Tech Stack:** Node.js 20 ESM, `node:test`, JSON Schema, existing HTTP bridge and MCP stdio server, filesystem-backed ReviewStore.

**Workspace note:** This directory is not a Git repository. Commit steps are replaced with explicit test and file-state checkpoints; no commit claim may be made.

---

### Task 1: Formal Whitepaper Review Contract

**Files:**
- Create: `src/agent/whitepaperReview.mjs`
- Create: `test/whitepaper-review.test.mjs`

- [ ] **Step 1: Write failing tests for the approved contract**

Add tests that call the wished-for API:

```js
import { validateWhitepaperReviewBatch } from '../src/agent/whitepaperReview.mjs';

test('accepts one approved and evidenced comment for one section', () => {
  const result = validateWhitepaperReviewBatch(validWhitepaperBatch());
  assert.equal(result.ok, true);
});

test('rejects vague comments without issue impact action and purpose', () => {
  const input = validWhitepaperBatch();
  input.suggestions[0].quality = {};
  const result = validateWhitepaperReviewBatch(input);
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /issue|impact|action|purposeCodes/);
});

test('enforces evidence and historical style references by category', () => {
  const data = validWhitepaperBatch({ category: 'data-fact' });
  data.suggestions[0].quality.evidenceIds = [];
  assert.match(validateWhitepaperReviewBatch(data).errors.join('\n'), /evidenceIds/);

  const style = validWhitepaperBatch({ category: 'style-alignment' });
  style.suggestions[0].quality.styleRuleIds = [];
  assert.match(validateWhitepaperReviewBatch(style).errors.join('\n'), /styleRuleIds/);
});
```

Also cover: exact profile/version, one section per batch, 1-8 suggestions, approved candidate ids, fixed categories/actions/purpose codes, completed counter-evidence check, `confirm` for committee decisions, and rejection of generic-only comments.

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test test/whitepaper-review.test.mjs`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/agent/whitepaperReview.mjs`.

- [ ] **Step 3: Implement the pure validator**

Export these constants and functions:

```js
export const REVIEW_PROFILE = 'whitepaper-chief-editor-v1';
export const STYLE_PROFILE = 'network-security-talent-whitepaper-2022-2024';
export const PURPOSE_CODES = new Set([
  'chapter-focus', 'evidence-accuracy', 'structure-logic', 'compression',
  'anti-ai-tone', 'historical-style', 'human-boundary'
]);

export function validateWhitepaperReviewBatch(input = {}) {
  const errors = [];
  // Validate batch workflow, one section, 1-8 items, each quality record,
  // category-specific evidence, supported countercheck, and actionable text.
  return { ok: errors.length === 0, errors, batch: normalizedBatch };
}
```

Normalization must preserve only contract fields, trim strings, keep evidence/style ids as unique non-empty strings, and produce item-addressed errors such as `suggestions[1].quality.issue is required`.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `node --test test/whitepaper-review.test.mjs`
Expected: all contract tests pass with zero failures.

### Task 2: Current-Document Grounding and Atomic Storage

**Files:**
- Create: `src/agent/documentGrounding.mjs`
- Modify: `src/bridge/store.mjs`
- Create: `test/document-grounding.test.mjs`
- Modify: `test/store.test.mjs`

- [ ] **Step 1: Write failing grounding tests**

```js
import { validateGroundedReviewBatch } from '../src/agent/documentGrounding.mjs';

test('rejects an anchor that is absent from the current document', () => {
  const result = validateGroundedReviewBatch('当前正文', validWhitepaperBatch());
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /未找到对应原文/);
});

test('rejects repeated anchors when context does not select one occurrence', () => {
  const text = '甲。重复原文。乙。重复原文。丙。';
  const input = validWhitepaperBatch({ anchorText: '重复原文', contextBefore: '', contextAfter: '' });
  assert.match(validateGroundedReviewBatch(text, input).errors.join('\n'), /无法唯一定位/);
});

test('rejects document evidence excerpts that are not in the current text', () => {
  const input = validWhitepaperBatch();
  input.suggestions[0].quality.verification.documentEvidenceExcerpt = '不存在的证据';
  assert.match(validateGroundedReviewBatch('精确原文和相邻上下文', input).errors.join('\n'), /正文证据/);
});
```

- [ ] **Step 2: Write a failing atomic-store test**

Add `ReviewStore.addValidatedSuggestions(inputs)` coverage proving that invalid input leaves zero persisted suggestions, while a valid array is saved in one operation and emits one event per created item only after persistence succeeds.

- [ ] **Step 3: Run tests and verify RED**

Run: `node --test test/document-grounding.test.mjs test/store.test.mjs`
Expected: grounding module missing and atomic method undefined.

- [ ] **Step 4: Implement grounding with the existing locator**

Use `locateSuggestion()` and reject `ambiguous: true`. Require at least one non-empty context field, verify normalized document inclusion for `documentEvidenceExcerpt` and each `relatedExcerpt`, and return normalized locations without retaining the document text:

```js
export function validateGroundedReviewBatch(documentText, batch) {
  const errors = [];
  const locations = [];
  for (const [index, suggestion] of batch.suggestions.entries()) {
    const located = locateSuggestion(documentText, suggestion);
    if (!located.ok) errors.push(`suggestions[${index}]: 未找到对应原文`);
    else if (located.ambiguous) errors.push(`suggestions[${index}]: 上下文无法唯一定位原文`);
    else locations.push({ candidateId: suggestion.candidateId, ...located });
  }
  return { ok: errors.length === 0, errors, locations };
}
```

- [ ] **Step 5: Implement atomic prevalidation in ReviewStore**

Validate and normalize every input before mutating maps. Create all records, update the map, save once, then emit events. If save fails, restore the previous map.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run: `node --test test/document-grounding.test.mjs test/store.test.mjs`
Expected: all focused tests pass.

### Task 3: Strict Agent Route and Legacy Isolation

**Files:**
- Modify: `src/bridge/server.mjs`
- Modify: `src/bridge/validation.mjs`
- Modify: `bin/wps-reviewer-mcp.mjs`
- Modify: `test/document-api.test.mjs`
- Modify: `test/api.test.mjs`
- Modify: `test/mcp.test.mjs`

- [ ] **Step 1: Write failing API tests for strict submission**

Tests must prove:

```js
test('formal submission validates quality and current document text before atomic persistence', async () => {
  // Register doc, answer document.read chunks, post a valid formal batch,
  // assert 201 and stored metadata.reviewProfile/profile quality/location.
});

test('one invalid item rejects the whole formal batch', async () => {
  // Post one valid and one ungrounded item; assert 400 and store length 0.
});

test('legacy suggestion writes are disabled by default', async () => {
  const response = await postLegacySuggestion();
  assert.equal(response.status, 410);
});

test('legacy writes require an explicit development switch and stay unverified', async () => {
  // createBridgeServer({ allowLegacySubmission: true });
  // assert metadata.reviewStatus === 'legacy-unverified'.
});
```

Also test multiple 32,000-character reads, revision changes during grounding, read timeout, and no document text in `review-store.json`.

- [ ] **Step 2: Run API tests and verify RED**

Run: `node --test test/document-api.test.mjs test/api.test.mjs test/mcp.test.mjs`
Expected: strict payload currently persists without quality/grounding and legacy endpoint returns 201.

- [ ] **Step 3: Add request-scoped full-document reading**

In `server.mjs`, add `readCurrentDocumentText()` that requests chunks of at most 32,000 characters, checks each returned revision token against the submitted token, stops only at `done`, and keeps concatenated text in the request scope.

- [ ] **Step 4: Integrate validation before one store write**

For `POST /api/agent/suggestions`:

1. validate active handle and revision;
2. run `validateWhitepaperReviewBatch(body)`;
3. read current text in memory;
4. run `validateGroundedReviewBatch(text, batch)`;
5. map workflow, scope, style, quality and location into suggestion metadata;
6. call `store.addValidatedSuggestions()` once.

Map validation errors to HTTP 400 and revision changes to 409.

- [ ] **Step 5: Disable legacy writes by default**

Add `allowLegacySubmission = false` to `createBridgeServer()`. Return HTTP 410 with a Chinese action message unless enabled. When enabled, force `metadata.reviewStatus = 'legacy-unverified'` and keep those records out of formal semantics.

- [ ] **Step 6: Update MCP behavior**

Keep `submit_wps_suggestion` listed as deprecated compatibility, but make its description and error direct agents to the bundled Skill and `submit_wps_suggestions`. The batch tool uses the formal batch schema only.

- [ ] **Step 7: Run focused tests and verify GREEN**

Run: `node --test test/document-api.test.mjs test/api.test.mjs test/mcp.test.mjs`
Expected: all focused API and MCP tests pass.

### Task 4: Schemas, Historical Style Profile, and Repository Skill

**Files:**
- Modify: `schemas/wps-suggestion.schema.json`
- Modify: `schemas/wps-suggestion-batch.schema.json`
- Create: `skills/whitepaper-wps-reviewer/SKILL.md`
- Create: `skills/whitepaper-wps-reviewer/references/review-purpose.md`
- Create: `skills/whitepaper-wps-reviewer/references/2022-2024-style-profile.md`
- Create: `skills/whitepaper-wps-reviewer/references/submission-contract.md`
- Create: `skills/whitepaper-wps-reviewer/references/source-fingerprints.json`
- Modify: `src/agent/contract.mjs`
- Modify: `test/agent-contract.test.mjs`
- Create: `test/skill-contract.test.mjs`

- [ ] **Step 1: Run three RED pressure scenarios without the new Skill**

Use fresh subagents on the same review excerpt without exposing the new Skill. Record whether they: submit more than 8 comments, skip candidate approval, miss the existing preceding heading, invent historical-style judgments, or omit evidence/action fields. Save only sanitized findings to the implementation log; do not place generated bad comments into ReviewStore.

- [ ] **Step 2: Write failing deterministic contract tests**

```js
test('formal schemas require the whitepaper workflow and quality fields', async () => {
  const schema = await loadJson('schemas/wps-suggestion-batch.schema.json');
  assert.deepEqual(schema.required, [
    'documentHandle', 'revisionToken', 'reviewProfile', 'reviewScope',
    'workflow', 'styleBaseline', 'suggestions'
  ]);
});

test('repository skill carries review purposes and 2022-2024 style rules without private paths', async () => {
  const files = await readSkillFiles();
  assert.match(files, /historical-style/);
  assert.match(files, /2022-2024/);
  assert.doesNotMatch(files, /\/Users\/zhangboquan/);
});
```

- [ ] **Step 3: Run tests and verify RED**

Run: `node --test test/agent-contract.test.mjs test/skill-contract.test.mjs`
Expected: schema requirements and Skill files are missing.

- [ ] **Step 4: Build the source-backed style profile**

Compute SHA-256 for the three historical PDFs and record their file names and hashes. Package stable content rules with ids `STYLE-01` through `STYLE-08`: judgment-first structure, short lead-ins, formal restrained language, sample boundaries, one chapter question, preserved third-level headings, human-confirmed viral claims, and banned empty AI phrases.

- [ ] **Step 5: Write the self-contained Skill**

The Skill must require this sequence:

```text
read active metadata -> read one small section -> state section goal
-> produce 3-7 candidates in three-line format -> wait for selection
-> reread heading + adjacent context + related evidence -> remove false positives
-> final natural-language preview -> submit formal batch
-> user clicks Accept to create the true WPS comment
```

It must forbid direct first-pass submission, whole-chapter dumps, vague style preferences, unsupported additions, and any claim that schema validation proves semantic truth.

- [ ] **Step 6: Run GREEN pressure scenarios with the Skill**

Give fresh subagents the Skill path and the same scenarios. Verify they stop at candidates, keep the batch within one section and 3-7 items, identify the existing heading as counter-evidence, cite style rule ids, and avoid WPS mutation language before explicit acceptance.

- [ ] **Step 7: Run deterministic tests and verify GREEN**

Run: `node --test test/agent-contract.test.mjs test/skill-contract.test.mjs`
Expected: all schema, sample and Skill contract tests pass.

### Task 5: Skill Installation, Examples, Documentation, and Release

**Files:**
- Create: `src/install/skillInstall.mjs`
- Create: `scripts/install-skill.mjs`
- Modify: `src/install/localInstall.mjs`
- Modify: `scripts/build-release.mjs`
- Modify: `package.json`
- Modify: `examples/sample-suggestion.json`
- Modify: `examples/batch-suggestions.json`
- Modify: `README.md`
- Modify: `docs/AGENT_INTEGRATION.md`
- Modify: `docs/DESIGN.md`
- Create: `test/skill-install.test.mjs`
- Modify: `test/release.test.mjs`
- Modify: `test/local-install.test.mjs`

- [ ] **Step 1: Write failing install and release tests**

Test installation into a temporary target, idempotent replacement with backup, release inclusion of all Skill/reference/schema files, formal examples passing the contract, and absence of developer absolute paths in user-facing install/integration docs.

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test test/skill-install.test.mjs test/release.test.mjs test/local-install.test.mjs test/agent-contract.test.mjs`
Expected: installer missing and release lacks required Skill files.

- [ ] **Step 3: Implement portable installation**

`installReviewerSkill({ sourceDir, targetRoot, backup })` copies the bundled directory to `<targetRoot>/whitepaper-wps-reviewer`, validates `SKILL.md`, and returns paths without invoking WPS. `install-local` calls it using a configurable target; tests always use temp directories.

- [ ] **Step 4: Replace legacy examples and documentation**

Examples must be complete formal batches using relative/project-neutral values. Documentation makes the bundled Skill the first step and labels the single-item tool as development compatibility only. Remove hard-coded `/Users/zhangboquan/...` commands from user-facing docs.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `node --test test/skill-install.test.mjs test/release.test.mjs test/local-install.test.mjs test/agent-contract.test.mjs`
Expected: all focused install, release and contract tests pass.

### Task 6: Reversible Quarantine of Unverified History

**Files:**
- Create: `src/maintenance/quarantineSuggestions.mjs`
- Create: `scripts/quarantine-unverified-suggestions.mjs`
- Create: `test/quarantine-suggestions.test.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write failing dry-run, apply, and restore tests**

Use a temporary ReviewStore fixture with sessions, 17 legacy suggestions, one formal suggestion, and linked acceptance events. Prove dry-run is byte-for-byte non-mutating, apply backs up only legacy records with source SHA-256 and removes linked events, formal records remain, and restore recreates all ids without duplicates.

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test test/quarantine-suggestions.test.mjs`
Expected: maintenance module missing.

- [ ] **Step 3: Implement the reversible maintenance API and CLI**

Export `inspectUnverifiedSuggestions`, `applyQuarantine`, and `restoreQuarantine`. The CLI defaults to dry-run; `--apply` and `--restore <backup>` are explicit. Never touch `.docx`, WPS processes, or plugin configuration.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `node --test test/quarantine-suggestions.test.mjs`
Expected: all quarantine tests pass.

- [ ] **Step 5: Quarantine the current 17 records**

Run dry-run first and confirm `unverifiedSuggestions: 17`. Then run `npm run suggestions:quarantine -- --apply`. Verify the backup exists, its SHA-256 matches the manifest, active suggestions are zero, sessions remain, and no WPS process was launched.

### Task 7: Full Verification and Background Browser Acceptance

**Files:**
- Modify if required by test evidence: `scripts/validate-background.mjs`
- Modify if required by test evidence: browser acceptance script or test fixtures
- Produce: `output/playwright/quality-gate-320.png`
- Produce: `output/playwright/quality-gate-480.png`

- [ ] **Step 1: Run the complete Node suite**

Run: `npm test`
Expected: zero failed tests.

- [ ] **Step 2: Run product validators**

Run:

```bash
npm run validate:agent-contract
npm run validate:background
npm run check:url-consistency
npm run release
```

Expected: each exits 0; release manifest includes the Skill, references, formal schemas, installer and maintenance command.

- [ ] **Step 3: Start or reuse only the local bridge needed for browser testing**

Use an unused localhost port or the existing bridge. Do not launch, activate, focus, script, or restart WPS. Inject only a formal qualified test batch through a test document connector or isolated test data directory.

- [ ] **Step 4: Run browser acceptance at required widths**

Check 320, 360, 420 and 480px for no overflow or overlap, exact three actions, natural comment wording, and absence of rejected invalid batches. Capture 320 and 480px evidence screenshots.

- [ ] **Step 5: Audit every completion requirement**

Re-read the design and map each requirement to a test, command output, release manifest entry, quarantine backup, or screenshot. Record real WPS checks as pending until the user actively opens WPS; do not claim them from background evidence.
