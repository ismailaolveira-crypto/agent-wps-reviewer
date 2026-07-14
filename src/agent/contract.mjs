import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateWhitepaperReviewBatch } from './whitepaperReview.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');

export async function loadJson(relativePath, { projectRoot = PROJECT_ROOT } = {}) {
  return JSON.parse(await readFile(path.join(projectRoot, relativePath), 'utf8'));
}

function validateSchemaShape(schema) {
  const errors = [];
  if (schema?.type !== 'object') errors.push('schema.type must be object');
  if (!schema.properties?.anchorText && !schema.properties?.anchor) {
    errors.push('schema must document anchorText or anchor');
  }
  if (!schema.properties?.comment) errors.push('schema must document comment');
  if (!schema.required?.includes('comment')) errors.push('schema must require comment');
  if (!Array.isArray(schema.anyOf)) errors.push('schema must require anchorText or anchor through anyOf');
  return errors;
}

function validatePayloadSchemaShape(schema) {
  const errors = [];
  if (!Array.isArray(schema?.oneOf)) errors.push('payload schema must use oneOf');
  if (!JSON.stringify(schema).includes('suggestions')) errors.push('payload schema must document batch suggestions');
  return errors;
}

export async function validateAgentContract({
  suggestionSchemaPath = 'schemas/wps-suggestion.schema.json',
  batchSchemaPath = 'schemas/wps-suggestion-batch.schema.json',
  legacySchemaPath = 'schemas/wps-legacy-suggestion.schema.json',
  payloadSchemaPath = 'schemas/wps-suggestion-payload.schema.json',
  samplePaths = ['examples/sample-suggestion.json', 'examples/batch-suggestions.json']
} = {}) {
  const suggestionSchema = await loadJson(suggestionSchemaPath);
  const batchSchema = await loadJson(batchSchemaPath);
  const legacySchema = await loadJson(legacySchemaPath);
  const payloadSchema = await loadJson(payloadSchemaPath);
  const checks = [
    {
      id: 'suggestion-schema-shape',
      status: validateSchemaShape(suggestionSchema).length === 0 ? 'passed' : 'failed',
      errors: validateSchemaShape(suggestionSchema)
    },
    {
      id: 'payload-schema-shape',
      status: validatePayloadSchemaShape(payloadSchema).length === 0 ? 'passed' : 'failed',
      errors: validatePayloadSchemaShape(payloadSchema)
    },
    {
      id: 'formal-batch-schema-shape',
      status: batchSchema?.properties?.reviewProfile?.const === 'whitepaper-chief-editor-v1' &&
        batchSchema?.properties?.suggestions?.maxItems === 8 ? 'passed' : 'failed',
      errors: []
    },
    {
      id: 'legacy-schema-isolation',
      status: /legacy|unverified/i.test(legacySchema?.description ?? '') ? 'passed' : 'failed',
      errors: []
    }
  ];

  for (const samplePath of samplePaths) {
    const payload = await loadJson(samplePath);
    const sampleErrors = [];
    const formalValidation = validateWhitepaperReviewBatch(payload);
    if (!formalValidation.ok) sampleErrors.push(...formalValidation.errors.map((message) => `${samplePath}: ${message}`));
    checks.push({
      id: `sample:${samplePath}`,
      status: sampleErrors.length === 0 ? 'passed' : 'failed',
      suggestions: payload.suggestions?.length ?? 0,
      errors: sampleErrors
    });
  }

  const failed = checks.filter((item) => item.status !== 'passed');
  return {
    ok: failed.length === 0,
    checked: checks.length,
    passed: checks.length - failed.length,
    failed: failed.length,
    schemas: [suggestionSchemaPath, batchSchemaPath, legacySchemaPath, payloadSchemaPath],
    samples: samplePaths,
    checks
  };
}
