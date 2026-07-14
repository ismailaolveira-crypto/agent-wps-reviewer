export const REVIEW_PROFILE = 'whitepaper-chief-editor-v1';
export const STYLE_PROFILE = 'network-security-talent-whitepaper-2022-2024';
export const STYLE_PROFILE_VERSION = '1';

export const CATEGORIES = new Set([
  'data-fact',
  'structure-logic',
  'duplicate-compression',
  'style-alignment',
  'anti-ai-tone',
  'numbering-figure-table',
  'committee-confirmation'
]);

export const ACTIONS = new Set([
  'delete',
  'merge',
  'compress',
  'replace',
  'soften',
  'move',
  'verify',
  'confirm'
]);

export const PURPOSE_CODES = new Set([
  'chapter-focus',
  'evidence-accuracy',
  'structure-logic',
  'compression',
  'anti-ai-tone',
  'historical-style',
  'human-boundary'
]);

export const STYLE_RULE_IDS = new Set([
  'STYLE-01',
  'STYLE-02',
  'STYLE-03',
  'STYLE-04',
  'STYLE-05',
  'STYLE-06',
  'STYLE-07',
  'STYLE-08'
]);

const CATEGORY_PURPOSES = new Map([
  ['data-fact', new Set(['evidence-accuracy'])],
  ['structure-logic', new Set(['structure-logic', 'chapter-focus', 'compression'])],
  ['duplicate-compression', new Set(['compression', 'chapter-focus'])],
  ['style-alignment', new Set(['historical-style'])],
  ['anti-ai-tone', new Set(['anti-ai-tone'])],
  ['numbering-figure-table', new Set(['structure-logic', 'evidence-accuracy'])],
  ['committee-confirmation', new Set(['human-boundary'])]
]);

const ACTION_SIGNALS = new Map([
  ['delete', ['删除', '删去', '删掉', '移除', '不保留']],
  ['merge', ['合并', '整合', '归并']],
  ['compress', ['压缩', '精简', '删减', '合并', '删除', '删去', '删掉']],
  ['replace', ['改为', '改成', '替换', '修改参考', '重写', '改写']],
  ['soften', ['弱化', '收窄', '限定', '调整为', '改为', '删除']],
  ['move', ['移至', '移到', '移动', '调整至', '前移', '后移']],
  ['verify', ['核验', '核对', '查证', '复核', '确认来源', '请确认']],
  ['confirm', ['请确认', '想请教', '请教', '编委确认', '确认是否', '需要确认']]
]);

const ACTION_NEGATIONS = ['不要', '无需', '无须', '不必', '不能', '不应', '不建议', '不需要', '避免'];
const FORBIDDEN_KEY_TERMS = new Set([
  '文字', '内容', '本段', '这里', '表述', '表达', '逻辑', '问题', '影响',
  '相关', '段落', '这段话', '这部分', '这部分文字'
]);
const ISSUE_RELATIONS = [
  '重复', '不一致', '错误', '错别字', '缺少', '缺失', '混淆', '超出', '不符',
  '冲突', '无依据', '未说明', '未交代', '未限定', '外推', '空泛', '冗长',
  '跳跃', '倒置', '偏离', '不能支撑', '无法支撑', '宣传性', '口径', '编号',
  '表号', '断句', '残缺', '误用'
];
const IMPACT_RELATIONS = [
  '影响', '导致', '造成', '削弱', '混淆', '误导', '重复', '拉长', '打断',
  '增加', '降低', '无法', '不利于', '难以', '掩盖', '偏离', '超出', '破坏',
  '挤占', '妨碍'
];

function text(value) {
  return String(value ?? '').trim();
}

function uniqueTextList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(text).filter(Boolean))];
}

function normalizeVerification(value = {}) {
  return {
    fullContextChecked: value.fullContextChecked === true,
    counterEvidenceChecked: value.counterEvidenceChecked === true,
    result: text(value.result),
    documentEvidenceExcerpt: text(value.documentEvidenceExcerpt),
    relatedExcerpts: uniqueTextList(value.relatedExcerpts)
  };
}

function normalizeQuality(value = {}) {
  return {
    issue: text(value.issue),
    impact: text(value.impact),
    action: text(value.action),
    actionStatement: text(value.actionStatement),
    purposeCodes: uniqueTextList(value.purposeCodes),
    keyTerms: uniqueTextList(value.keyTerms),
    evidenceIds: uniqueTextList(value.evidenceIds),
    styleRuleIds: uniqueTextList(value.styleRuleIds),
    verification: normalizeVerification(value.verification)
  };
}

function normalizeSuggestion(value = {}) {
  return {
    candidateId: text(value.candidateId),
    category: text(value.category),
    anchorText: text(value.anchor?.text ?? value.anchorText),
    contextBefore: text(value.anchor?.before ?? value.contextBefore ?? value.beforeText),
    contextAfter: text(value.anchor?.after ?? value.contextAfter ?? value.afterText),
    comment: text(value.comment ?? value.message),
    quality: normalizeQuality(value.quality)
  };
}

function normalizeBatch(input = {}) {
  return {
    documentHandle: text(input.documentHandle),
    connectionCode: text(input.connectionCode),
    revisionToken: text(input.revisionToken),
    sourceAgent: text(input.sourceAgent ?? input.agent),
    reviewProfile: text(input.reviewProfile),
    reviewScope: {
      sectionId: text(input.reviewScope?.sectionId),
      sectionTitle: text(input.reviewScope?.sectionTitle),
      sectionGoal: text(input.reviewScope?.sectionGoal)
    },
    workflow: {
      stage: text(input.workflow?.stage),
      candidateRoundId: text(input.workflow?.candidateRoundId),
      approvedCandidateIds: uniqueTextList(input.workflow?.approvedCandidateIds)
    },
    styleBaseline: {
      profile: text(input.styleBaseline?.profile),
      version: text(input.styleBaseline?.version)
    },
    suggestions: Array.isArray(input.suggestions) ? input.suggestions.map(normalizeSuggestion) : []
  };
}

function containsKeyTerm(value, keyTerms) {
  const source = text(value);
  return keyTerms.some((term) => source.includes(term));
}

function validateActionStatement(action, actionStatement, comment) {
  if (!actionStatement || !/^(建议|请)/.test(actionStatement)) return false;
  const source = text(comment);
  const statementIndex = source.indexOf(actionStatement);
  if (statementIndex === -1) return false;

  const beforeStatement = source.slice(0, statementIndex);
  const currentSentenceStart = Math.max(
    beforeStatement.lastIndexOf('。'),
    beforeStatement.lastIndexOf('！'),
    beforeStatement.lastIndexOf('？'),
    beforeStatement.lastIndexOf(';'),
    beforeStatement.lastIndexOf('；'),
    beforeStatement.lastIndexOf('\n')
  );
  const sentencePrefix = beforeStatement.slice(currentSentenceStart + 1);
  if (/(不予采纳|不建议|不应|不妥|不赞同|否定|无需|无须|不必|不要|请勿)/.test(sentencePrefix)) {
    return false;
  }
  if (/[不勿无]$/.test(sentencePrefix.trim())) return false;
  const openDouble = (sentencePrefix.match(/“/g) || []).length - (sentencePrefix.match(/”/g) || []).length;
  const openSingle = (sentencePrefix.match(/‘/g) || []).length - (sentencePrefix.match(/’/g) || []).length;
  if (openDouble > 0 || openSingle > 0 || ((sentencePrefix.match(/["']/g) || []).length % 2) === 1) {
    return false;
  }

  const afterStatement = source.slice(statementIndex + actionStatement.length);
  if (afterStatement.replace(/[。！？；;，,：:\s]/g, '')) return false;

  const matches = [];
  for (const [candidateAction, signals] of ACTION_SIGNALS) {
    for (const signal of signals) {
      const index = actionStatement.indexOf(signal);
      if (index !== -1) matches.push({ action: candidateAction, index, signal });
    }
  }
  matches.sort((left, right) => left.index - right.index || right.signal.length - left.signal.length);
  const first = matches[0];
  const expectedAtFirstPosition = matches.find((match) => match.action === action && match.index === first?.index);
  if (!first || !expectedAtFirstPosition) return false;

  const prefix = actionStatement.slice(0, expectedAtFirstPosition.index);
  if (/[“”‘’"']/.test(prefix)) return false;
  if (ACTION_NEGATIONS.some((negation) => prefix.includes(negation)) || prefix.includes('勿')) return false;
  return true;
}

function isSubstantialKeyTerm(term) {
  if (/\d/.test(term) || /[A-Za-z]{3,}/.test(term)) return true;
  return [...term].filter((char) => /\p{Script=Han}/u.test(char)).length >= 4;
}

function containsAffirmativeRelation(value, relations) {
  const source = text(value);
  const negations = ['不存在', '不会', '没有', '并非', '不是', '不再', '无需', '无须', '不必', '不能'];
  for (const relation of relations) {
    let index = source.indexOf(relation);
    while (index !== -1) {
      const prefix = source.slice(Math.max(0, index - 8), index);
      if (!negations.some((negation) => prefix.includes(negation))) return true;
      index = source.indexOf(relation, index + relation.length);
    }
  }
  return false;
}

function hasExpectedPurpose(category, purposeCodes) {
  const expected = CATEGORY_PURPOSES.get(category);
  return !expected || purposeCodes.some((purpose) => expected.has(purpose));
}

function validateSuggestion(errors, suggestion, index, approvedIds) {
  const prefix = `suggestions[${index}]`;
  const quality = suggestion.quality;

  if (!suggestion.candidateId) errors.push(`${prefix}.candidateId is required`);
  if (suggestion.candidateId && !approvedIds.has(suggestion.candidateId)) {
    errors.push(`${prefix} ${suggestion.candidateId} 未获用户选择，不能提交到 WPS`);
  }
  if (!CATEGORIES.has(suggestion.category)) {
    errors.push(`${prefix}.category must be a supported whitepaper review category`);
  }
  if (!suggestion.anchorText) errors.push(`${prefix}.anchorText is required`);
  if (!suggestion.comment) errors.push(`${prefix}.comment is required`);
  if (suggestion.comment && !containsKeyTerm(suggestion.comment, quality.keyTerms)) {
    errors.push(`${prefix}.comment 必须具体且可执行，不能只写“建议优化”`);
  }

  if (quality.issue.length < 8 ||
      !containsKeyTerm(quality.issue, quality.keyTerms) ||
      !containsAffirmativeRelation(quality.issue, ISSUE_RELATIONS)) {
    errors.push(`${prefix}.quality.issue 必须具体说明原文问题`);
  }
  if (quality.impact.length < 8 ||
      !containsKeyTerm(quality.impact, quality.keyTerms) ||
      !containsAffirmativeRelation(quality.impact, IMPACT_RELATIONS)) {
    errors.push(`${prefix}.quality.impact 必须具体说明问题影响`);
  }
  if (!ACTIONS.has(quality.action)) errors.push(`${prefix}.quality.action 必须是受支持的修改动作`);
  if (!quality.actionStatement) {
    errors.push(`${prefix}.quality.actionStatement is required`);
  } else if (!validateActionStatement(quality.action, quality.actionStatement, suggestion.comment)) {
    errors.push(`${prefix}.quality.actionStatement 必须是批注中的肯定式可执行动作，并与 action 一致`);
  }
  if (quality.purposeCodes.length === 0) {
    errors.push(`${prefix}.quality.purposeCodes 至少包含一个修改目的`);
  }
  if (quality.keyTerms.length === 0 || quality.keyTerms.length > 5) {
    errors.push(`${prefix}.quality.keyTerms 必须包含 1-5 个正文关键术语`);
  }
  for (const term of quality.keyTerms) {
    if (term.length < 2 || term.length > 40 || FORBIDDEN_KEY_TERMS.has(term) || /^(这|本)(段|部分|句|处)/.test(term)) {
      errors.push(`${prefix}.quality.keyTerms 包含无效或空泛关键术语 ${term}`);
    }
  }
  if (quality.keyTerms.length > 0 && !quality.keyTerms.some(isSubstantialKeyTerm)) {
    errors.push(`${prefix}.quality.keyTerms 至少包含一个具体正文术语`);
  }

  for (const purpose of quality.purposeCodes) {
    if (!PURPOSE_CODES.has(purpose)) errors.push(`${prefix}.quality.purposeCodes 包含未知值 ${purpose}`);
  }
  if (CATEGORIES.has(suggestion.category) && !hasExpectedPurpose(suggestion.category, quality.purposeCodes)) {
    errors.push(`${prefix}.quality.purposeCodes 未服务 ${suggestion.category} 对应的修改目的`);
  }

  const verification = quality.verification;
  if (!verification.fullContextChecked) {
    errors.push(`${prefix}.quality.verification.fullContextChecked 必须为 true`);
  }
  if (!verification.counterEvidenceChecked) {
    errors.push(`${prefix}.quality.verification.counterEvidenceChecked 必须为 true`);
  }
  if (verification.result !== 'supported') {
    errors.push(`${prefix}.quality.verification.result 必须为 supported`);
  }
  if (!verification.documentEvidenceExcerpt) {
    errors.push(`${prefix}.quality.verification.documentEvidenceExcerpt is required`);
  }

  if (suggestion.category === 'data-fact' && quality.evidenceIds.length === 0) {
    errors.push(`${prefix}.quality.evidenceIds 数据事实类意见必须提供 evidence_id`);
  }
  if (suggestion.category === 'style-alignment') {
    if (!quality.purposeCodes.includes('historical-style')) {
      errors.push(`${prefix}.quality.purposeCodes 风格意见必须包含 historical-style`);
    }
    if (quality.styleRuleIds.length === 0) {
      errors.push(`${prefix}.quality.styleRuleIds 风格意见必须引用 2022-2024 风格规则`);
    }
  }
  for (const ruleId of quality.styleRuleIds) {
    if (!STYLE_RULE_IDS.has(ruleId)) errors.push(`${prefix}.quality.styleRuleIds 包含未知规则 ${ruleId}`);
  }
  if (suggestion.category === 'committee-confirmation' && quality.action !== 'confirm') {
    errors.push(`${prefix} committee-confirmation 必须使用 confirm，不能直接改写`);
  }
}

export function validateWhitepaperReviewBatch(input = {}) {
  const batch = normalizeBatch(input);
  const errors = [];

  if (!batch.documentHandle && !batch.connectionCode) errors.push('documentHandle or connectionCode is required');
  if (!batch.revisionToken) errors.push('revisionToken is required');
  if (!batch.sourceAgent) errors.push('sourceAgent is required');
  if (batch.reviewProfile !== REVIEW_PROFILE) {
    errors.push(`reviewProfile must be ${REVIEW_PROFILE}`);
  }
  if (!batch.reviewScope.sectionId) errors.push('reviewScope.sectionId is required');
  if (!batch.reviewScope.sectionTitle) errors.push('reviewScope.sectionTitle is required');
  if (batch.reviewScope.sectionGoal.length < 8) {
    errors.push('reviewScope.sectionGoal 必须说明本节任务');
  }
  if (batch.workflow.stage !== 'final-previewed') {
    errors.push('workflow.stage must be final-previewed');
  }
  if (!batch.workflow.candidateRoundId) errors.push('workflow.candidateRoundId is required');
  if (batch.workflow.approvedCandidateIds.length === 0) {
    errors.push('workflow.approvedCandidateIds 至少包含一个用户选择的候选 id');
  }
  if (batch.styleBaseline.profile !== STYLE_PROFILE) {
    errors.push(`styleBaseline.profile must be ${STYLE_PROFILE}`);
  }
  if (batch.styleBaseline.version !== STYLE_PROFILE_VERSION) {
    errors.push(`styleBaseline.version must be ${STYLE_PROFILE_VERSION}`);
  }
  if (batch.suggestions.length === 0) errors.push('suggestions must contain at least one item');
  if (batch.suggestions.length > 8) errors.push('同一小节每轮最多 8 条批注候选');

  const approvedIds = new Set(batch.workflow.approvedCandidateIds);
  batch.suggestions.forEach((suggestion, index) => validateSuggestion(errors, suggestion, index, approvedIds));

  const candidateIds = batch.suggestions.map((suggestion) => suggestion.candidateId).filter(Boolean);
  const duplicateIds = [...new Set(candidateIds.filter((id, index) => candidateIds.indexOf(id) !== index))];
  for (const duplicateId of duplicateIds) {
    errors.push(`suggestions[].candidateId 必须唯一，重复值 ${duplicateId}`);
  }
  for (const approvedId of approvedIds) {
    if (!candidateIds.includes(approvedId)) {
      errors.push(`workflow.approvedCandidateIds 中的 ${approvedId} 不在最终预览建议中`);
    }
  }

  return { ok: errors.length === 0, errors, batch };
}
