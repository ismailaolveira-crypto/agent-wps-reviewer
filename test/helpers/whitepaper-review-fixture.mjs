export function makeFormalSuggestion({
  candidateId = 'candidate-1',
  anchorText = '课程覆盖判断重复出现',
  contextBefore = '本节前文。',
  contextAfter = '本节后文。',
  keyTerm = '课程覆盖'
} = {}) {
  return {
    candidateId,
    category: 'duplicate-compression',
    anchorText,
    contextBefore,
    contextAfter,
    comment: `这里重复说明${keyTerm}情况，建议删除重复的${keyTerm}说明。`,
    quality: {
      issue: `${keyTerm}判断重复出现，没有推进本节对培养短板的分析。`,
      impact: `${keyTerm}重复内容拉长篇幅，削弱本节主要判断。`,
      action: 'delete',
      actionStatement: `建议删除重复的${keyTerm}说明。`,
      purposeCodes: ['compression', 'chapter-focus'],
      keyTerms: [keyTerm],
      evidenceIds: [],
      styleRuleIds: [],
      verification: {
        fullContextChecked: true,
        counterEvidenceChecked: true,
        result: 'supported',
        documentEvidenceExcerpt: anchorText,
        relatedExcerpts: [contextBefore || contextAfter].filter(Boolean)
      }
    }
  };
}

export function makeFormalBatch({
  documentHandle = 'doc-a',
  revisionToken = 'sha256:fresh',
  sourceAgent = 'codex',
  suggestions
} = {}) {
  const items = suggestions || [makeFormalSuggestion()];
  return {
    documentHandle,
    revisionToken,
    sourceAgent,
    reviewProfile: 'whitepaper-chief-editor-v1',
    reviewScope: {
      sectionId: '5.1.3',
      sectionTitle: '课程体系建设现状',
      sectionGoal: '说明课程、实训体系和师资建设的现状与主要短板'
    },
    workflow: {
      stage: 'final-previewed',
      candidateRoundId: 'round-1',
      approvedCandidateIds: items.map((item) => item.candidateId)
    },
    styleBaseline: {
      profile: 'network-security-talent-whitepaper-2022-2024',
      version: '1'
    },
    suggestions: items
  };
}
