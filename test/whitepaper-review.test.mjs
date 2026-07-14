import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  REVIEW_PROFILE,
  STYLE_PROFILE,
  validateWhitepaperReviewBatch
} from '../src/agent/whitepaperReview.mjs';

function validSuggestion(overrides = {}) {
  const suggestion = {
    candidateId: 'candidate-1',
    category: 'duplicate-compression',
    anchorText: '多数院校已将AI安全纳入教学，独立课程占比较高。',
    contextBefore: '高校课程覆盖已较广。',
    contextAfter: '但实训体系与师资仍存在短板。',
    comment: '这里与本节开头对课程覆盖情况的判断重复，建议压缩为一句，把篇幅留给实训体系和师资短板。',
    quality: {
      issue: '本段重复陈述课程覆盖情况，没有推进本节对培养短板的分析。',
      impact: '重复内容拉长篇幅，并削弱实训体系和师资短板这条主线。',
      action: 'compress',
      actionStatement: '建议压缩为一句，把篇幅留给实训体系和师资短板。',
      purposeCodes: ['compression', 'chapter-focus'],
      keyTerms: ['课程覆盖', '实训体系', '师资'],
      evidenceIds: [],
      styleRuleIds: [],
      verification: {
        fullContextChecked: true,
        counterEvidenceChecked: true,
        result: 'supported',
        documentEvidenceExcerpt: '多数院校已将AI安全纳入教学，独立课程占比较高。',
        relatedExcerpts: ['高校课程覆盖已较广。']
      }
    }
  };
  return {
    ...suggestion,
    ...overrides,
    quality: {
      ...suggestion.quality,
      ...(overrides.quality || {}),
      verification: {
        ...suggestion.quality.verification,
        ...(overrides.quality?.verification || {})
      }
    }
  };
}

function validWhitepaperBatch({ suggestion = {}, suggestions, ...overrides } = {}) {
  return {
    documentHandle: 'doc-1',
    revisionToken: 'sha256:current',
    sourceAgent: 'codex',
    threadId: 'thread-1',
    reviewProfile: 'whitepaper-chief-editor-v1',
    reviewScope: {
      sectionId: '5.1.3',
      sectionTitle: '课程体系建设现状',
      sectionGoal: '说明高校课程、实训体系和师资建设的现状与主要短板'
    },
    workflow: {
      stage: 'final-previewed',
      candidateRoundId: 'round-1',
      approvedCandidateIds: ['candidate-1']
    },
    styleBaseline: {
      profile: 'network-security-talent-whitepaper-2022-2024',
      version: '1'
    },
    suggestions: suggestions || [validSuggestion(suggestion)],
    ...overrides
  };
}

test('accepts one approved and evidenced comment for one section', () => {
  const result = validateWhitepaperReviewBatch(validWhitepaperBatch());

  assert.equal(result.ok, true, result.errors?.join('\n'));
  assert.equal(result.batch.reviewProfile, REVIEW_PROFILE);
  assert.equal(result.batch.styleBaseline.profile, STYLE_PROFILE);
  assert.equal(result.batch.suggestions[0].quality.action, 'compress');
});

test('rejects a batch without the formal review profile and style baseline', () => {
  const input = validWhitepaperBatch({ reviewProfile: '', styleBaseline: {} });
  const result = validateWhitepaperReviewBatch(input);

  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /reviewProfile/);
  assert.match(result.errors.join('\n'), /styleBaseline\.profile/);
});

test('rejects vague comments without issue impact action and purpose', () => {
  const input = validWhitepaperBatch({
    suggestion: {
      comment: '这里建议优化一下。',
      quality: { issue: '', impact: '', action: '', purposeCodes: [] }
    }
  });
  const result = validateWhitepaperReviewBatch(input);

  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /comment.*具体|comment.*可执行/);
  assert.match(result.errors.join('\n'), /quality\.issue/);
  assert.match(result.errors.join('\n'), /quality\.impact/);
  assert.match(result.errors.join('\n'), /quality\.action/);
  assert.match(result.errors.join('\n'), /quality\.purposeCodes/);
});

test('rejects paraphrased generic comments even when quality fields are concrete', () => {
  for (const comment of [
    '建议进一步优化本段表述。',
    '这里可以再完善一下相关内容，让逻辑更加清晰。',
    '本段内容需要进行适当调整和优化。',
    '这段话还可以改得更好一些。'
  ]) {
    const input = validWhitepaperBatch({
      suggestion: { comment }
    });
    const result = validateWhitepaperReviewBatch(input);
    assert.equal(result.ok, false, `generic comment passed: ${comment}`);
    assert.match(result.errors.join('\n'), /具体/);
  }
});

test('rejects generic issue and impact even when the final comment is concrete', () => {
  const input = validWhitepaperBatch({
    suggestion: {
      quality: {
        issue: '本段表述还有进一步优化和完善的空间。',
        impact: '可能会在一定程度上影响内容表达的清晰程度。'
      }
    }
  });
  const result = validateWhitepaperReviewBatch(input);

  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /quality\.issue.*具体/);
  assert.match(result.errors.join('\n'), /quality\.impact.*具体/);
});

test('allows generic words when the comment names a concrete action and object', () => {
  const input = validWhitepaperBatch({
    suggestion: {
      comment: '建议优化本段逻辑，删除重复的第二句并保留样本边界说明。',
      quality: {
        issue: '第二句重复说明课程覆盖情况，没有推进对培养短板的分析。',
        impact: '重复内容挤占样本边界说明的篇幅，审稿人无法快速识别结论范围。',
        actionStatement: '建议优化本段逻辑，删除重复的第二句并保留样本边界说明。',
        keyTerms: ['重复', '样本边界'],
        verification: {
          documentEvidenceExcerpt: '第二句重复说明课程覆盖情况，后文包含样本边界说明。'
        }
      }
    }
  });
  const result = validateWhitepaperReviewBatch(input);

  assert.equal(result.ok, true, result.errors?.join('\n'));
});

test('rejects negated action words that contradict the structured action', () => {
  const cases = [
    ['delete', '不要删除课程覆盖情况的第二句。'],
    ['compress', '无需压缩课程覆盖情况的第二句。'],
    ['merge', '不要合并课程覆盖情况的两段文字。'],
    ['verify', '无需核验课程覆盖比例的样本分母。'],
    ['confirm', '无需编委确认课程覆盖结论的适用边界。']
  ];

  for (const [action, comment] of cases) {
    const input = validWhitepaperBatch({
      suggestion: {
        category: action === 'confirm' ? 'committee-confirmation' : action === 'verify' ? 'data-fact' : 'duplicate-compression',
        comment,
        quality: {
          action,
          actionStatement: comment,
          purposeCodes:
            action === 'confirm' ? ['human-boundary'] : action === 'verify' ? ['evidence-accuracy'] : ['compression'],
          evidenceIds: action === 'verify' ? ['E-01'] : []
        }
      }
    });
    const result = validateWhitepaperReviewBatch(input);
    assert.equal(result.ok, false, `negated action passed: ${comment}`);
    assert.match(result.errors.join('\n'), /动作|action|可执行/);
  }
});

test('accepts common natural synonyms for delete and replace actions', () => {
  const deleteInput = validWhitepaperBatch({
    suggestion: {
      comment: '建议删掉重复说明课程覆盖情况的第二句，保留实训体系和师资短板。',
      quality: {
        action: 'delete',
        actionStatement: '建议删掉重复说明课程覆盖情况的第二句，保留实训体系和师资短板。',
        purposeCodes: ['compression']
      }
    }
  });
  assert.equal(validateWhitepaperReviewBatch(deleteInput).ok, true);

  const replaceInput = validWhitepaperBatch({
    suggestion: {
      category: 'style-alignment',
      comment: '建议把课程覆盖结论改成“该结论仅适用于受访样本”，明确数据边界。',
      quality: {
        action: 'replace',
        actionStatement: '建议把课程覆盖结论改成“该结论仅适用于受访样本”，明确数据边界。',
        purposeCodes: ['historical-style'],
        styleRuleIds: ['STYLE-04']
      }
    }
  });
  assert.equal(validateWhitepaperReviewBatch(replaceInput).ok, true);
});

test('rejects suggestions whose issue impact and comment are not tied to document key terms', () => {
  const input = validWhitepaperBatch({
    suggestion: {
      anchorText: '某段具体原文',
      comment: '建议删除这部分文字。',
      quality: {
        issue: '这部分文字存在若干不足。',
        impact: '会给阅读带来某些不便。',
        action: 'delete',
        actionStatement: '建议删除这部分文字。',
        purposeCodes: ['compression'],
        keyTerms: ['这部分文字'],
        verification: { documentEvidenceExcerpt: '某段具体原文' }
      }
    }
  });
  const result = validateWhitepaperReviewBatch(input);

  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /keyTerms|关键术语/);
});

test('rejects unapproved candidates and incomplete review workflow', () => {
  const input = validWhitepaperBatch({
    workflow: {
      stage: 'candidate',
      candidateRoundId: '',
      approvedCandidateIds: []
    }
  });
  const result = validateWhitepaperReviewBatch(input);

  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /workflow\.stage/);
  assert.match(result.errors.join('\n'), /candidateRoundId/);
  assert.match(result.errors.join('\n'), /approvedCandidateIds/);
  assert.match(result.errors.join('\n'), /candidate-1.*未获用户选择/);
});

test('rejects batches larger than eight comments', () => {
  const suggestions = Array.from({ length: 9 }, (_, index) =>
    validSuggestion({ candidateId: `candidate-${index + 1}` })
  );
  const input = validWhitepaperBatch({
    suggestions,
    workflow: {
      stage: 'final-previewed',
      candidateRoundId: 'round-1',
      approvedCandidateIds: suggestions.map((item) => item.candidateId)
    }
  });
  const result = validateWhitepaperReviewBatch(input);

  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /最多 8 条/);
});

test('accepts exactly eight distinct approved candidates', () => {
  const suggestions = Array.from({ length: 8 }, (_, index) =>
    validSuggestion({ candidateId: `candidate-${index + 1}` })
  );
  const input = validWhitepaperBatch({
    suggestions,
    workflow: {
      stage: 'final-previewed',
      candidateRoundId: 'round-1',
      approvedCandidateIds: suggestions.map((item) => item.candidateId)
    }
  });
  const result = validateWhitepaperReviewBatch(input);

  assert.equal(result.ok, true, result.errors?.join('\n'));
});

test('rejects an empty batch', () => {
  const result = validateWhitepaperReviewBatch(validWhitepaperBatch({ suggestions: [] }));

  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /at least one|至少一条/);
});

test('rejects duplicate candidate ids that reuse one approval', () => {
  const input = validWhitepaperBatch({
    suggestions: [
      validSuggestion({ candidateId: 'candidate-1' }),
      validSuggestion({
        candidateId: 'candidate-1',
        anchorText: '另一处原文',
        comment: '这里重复使用了同一个候选编号，但实际上是另一条修改意见。'
      })
    ]
  });
  const result = validateWhitepaperReviewBatch(input);

  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /candidateId.*唯一|重复.*candidate-1/);
});

test('requires complete full-context and counter-evidence verification', () => {
  const input = validWhitepaperBatch({
    suggestion: {
      quality: {
        verification: {
          fullContextChecked: false,
          counterEvidenceChecked: false,
          result: 'unsupported',
          documentEvidenceExcerpt: ''
        }
      }
    }
  });
  const result = validateWhitepaperReviewBatch(input);

  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /fullContextChecked/);
  assert.match(result.errors.join('\n'), /counterEvidenceChecked/);
  assert.match(result.errors.join('\n'), /verification\.result/);
  assert.match(result.errors.join('\n'), /documentEvidenceExcerpt/);
});

test('enforces data evidence ids for data-backed comments', () => {
  const input = validWhitepaperBatch({
    suggestion: {
      category: 'data-fact',
      quality: {
        action: 'verify',
        purposeCodes: ['evidence-accuracy'],
        evidenceIds: []
      }
    }
  });
  const result = validateWhitepaperReviewBatch(input);

  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /evidenceIds/);
});

test('enforces 2022-2024 style rule ids for style comments', () => {
  const input = validWhitepaperBatch({
    suggestion: {
      category: 'style-alignment',
      quality: {
        action: 'replace',
        purposeCodes: ['historical-style'],
        styleRuleIds: []
      }
    }
  });
  const result = validateWhitepaperReviewBatch(input);

  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /styleRuleIds/);
});

test('rejects unknown historical style rules and mismatched purpose', () => {
  const input = validWhitepaperBatch({
    suggestion: {
      category: 'style-alignment',
      quality: {
        action: 'replace',
        purposeCodes: ['chapter-focus'],
        styleRuleIds: ['STYLE-99']
      }
    }
  });
  const result = validateWhitepaperReviewBatch(input);

  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /historical-style/);
  assert.match(result.errors.join('\n'), /STYLE-99/);
});

test('allows a structure comment to serve compression when that is the real modification purpose', () => {
  const input = validWhitepaperBatch({
    suggestion: {
      category: 'structure-logic',
      comment: '这里与本节开头对课程覆盖情况的判断重复，建议合并两处表述，把篇幅留给实训体系和师资短板。',
      quality: {
        action: 'merge',
        actionStatement: '建议合并两处表述，把篇幅留给实训体系和师资短板。',
        purposeCodes: ['compression']
      }
    }
  });
  const result = validateWhitepaperReviewBatch(input);

  assert.equal(result.ok, true, result.errors?.join('\n'));
});

test('rejects unknown category action and purpose codes', () => {
  const input = validWhitepaperBatch({
    suggestion: {
      category: 'polish-anything',
      quality: {
        action: 'make-better',
        purposeCodes: ['generic-polish']
      }
    }
  });
  const result = validateWhitepaperReviewBatch(input);

  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /category/);
  assert.match(result.errors.join('\n'), /action/);
  assert.match(result.errors.join('\n'), /generic-polish/);
});

test('requires the exact historical style profile version', () => {
  const result = validateWhitepaperReviewBatch(
    validWhitepaperBatch({
      styleBaseline: {
        profile: 'network-security-talent-whitepaper-2022-2024',
        version: '2'
      }
    })
  );

  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /styleBaseline\.version/);
});

test('requires an affirmative action statement copied from the final comment', () => {
  const missing = validWhitepaperBatch({
    suggestion: { quality: { actionStatement: '' } }
  });
  assert.match(validateWhitepaperReviewBatch(missing).errors.join('\n'), /actionStatement/);

  const notCopied = validWhitepaperBatch({
    suggestion: { quality: { actionStatement: '建议压缩课程覆盖的重复说明。' } }
  });
  assert.match(validateWhitepaperReviewBatch(notCopied).errors.join('\n'), /actionStatement.*批注/);
});

test('rejects action statements sliced from negated quoted or disclaimed clauses', () => {
  const cases = [
    ['不建议删除课程覆盖相关内容。', '建议删除课程覆盖相关内容。'],
    ['原文写道“建议删除课程覆盖相关内容”，此处只作引用。', '建议删除课程覆盖相关内容'],
    ['以下建议不予采纳：建议删除课程覆盖相关内容。', '建议删除课程覆盖相关内容。'],
    ['建议删除课程覆盖相关内容是不妥的，应保留样本边界。', '建议删除课程覆盖相关内容']
  ];

  for (const [comment, actionStatement] of cases) {
    const result = validateWhitepaperReviewBatch(
      validWhitepaperBatch({
        suggestion: {
          comment,
          quality: {
            action: 'delete',
            actionStatement,
            purposeCodes: ['compression']
          }
        }
      })
    );
    assert.equal(result.ok, false, `sliced action passed: ${comment}`);
    assert.match(result.errors.join('\n'), /actionStatement/);
  }
});

test('rejects issue and impact that only repeat a key term without a diagnosed relation', () => {
  for (const [issue, impact] of [
    ['课程覆盖还存在一些问题', '课程覆盖可能产生一定影响'],
    ['课程覆盖课程覆盖', '课程覆盖课程覆盖']
  ]) {
    const result = validateWhitepaperReviewBatch(
      validWhitepaperBatch({ suggestion: { quality: { issue, impact } } })
    );
    assert.equal(result.ok, false, `mechanical quality fields passed: ${issue}`);
    assert.match(result.errors.join('\n'), /quality\.(issue|impact)/);
  }
});

test('rejects negated issue and impact relations', () => {
  const result = validateWhitepaperReviewBatch(
    validWhitepaperBatch({
      suggestion: {
        quality: {
          issue: '课程覆盖不存在重复问题，判断边界已经清楚。',
          impact: '课程覆盖不会影响本节主要判断或读者理解。'
        }
      }
    })
  );

  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /quality\.issue/);
  assert.match(result.errors.join('\n'), /quality\.impact/);
});

test('rejects a later sentence that reverses the approved action statement', () => {
  const result = validateWhitepaperReviewBatch(
    validWhitepaperBatch({
      suggestion: {
        comment: '建议删除重复的课程覆盖说明。其实不应删除，应完整保留。',
        quality: {
          action: 'delete',
          actionStatement: '建议删除重复的课程覆盖说明',
          purposeCodes: ['compression']
        }
      }
    })
  );

  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /actionStatement/);
});

test('requires at least one content-specific key term', () => {
  const result = validateWhitepaperReviewBatch(
    validWhitepaperBatch({
      suggestion: { quality: { keyTerms: ['课程', '稿件'] } }
    })
  );

  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /keyTerms.*具体/);
});

test('requires an explicit source agent and keeps only formal envelope fields', () => {
  const missing = validateWhitepaperReviewBatch(validWhitepaperBatch({ sourceAgent: '  ' }));
  assert.equal(missing.ok, false);
  assert.match(missing.errors.join('\n'), /sourceAgent/);

  const input = validWhitepaperBatch({ threadId: 'drop-me', extra: 'drop-me' });
  input.suggestions[0].severity = 'critical';
  input.suggestions[0].extra = 'drop-me';
  const result = validateWhitepaperReviewBatch(input);
  assert.equal(result.ok, true, result.errors?.join('\n'));
  assert.equal(Object.hasOwn(result.batch, 'threadId'), false);
  assert.equal(Object.hasOwn(result.batch, 'extra'), false);
  assert.equal(Object.hasOwn(result.batch.suggestions[0], 'severity'), false);
  assert.equal(Object.hasOwn(result.batch.suggestions[0], 'extra'), false);
});

test('committee confirmation cannot be submitted as a direct rewrite', () => {
  const input = validWhitepaperBatch({
    suggestion: {
      category: 'committee-confirmation',
      quality: {
        action: 'replace',
        purposeCodes: ['human-boundary']
      }
    }
  });
  const result = validateWhitepaperReviewBatch(input);

  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /committee-confirmation.*confirm/);
});

test('normalizes unique ids and trims contract text', () => {
  const input = validWhitepaperBatch({
    suggestion: {
      candidateId: '  candidate-1  ',
      quality: {
        purposeCodes: ['compression', 'compression', 'chapter-focus'],
        evidenceIds: [' ev-1 ', 'ev-1'],
        styleRuleIds: [' STYLE-01 ', 'STYLE-01']
      }
    },
    workflow: {
      stage: ' final-previewed ',
      candidateRoundId: ' round-1 ',
      approvedCandidateIds: [' candidate-1 ', 'candidate-1']
    }
  });
  const result = validateWhitepaperReviewBatch(input);

  assert.equal(result.ok, true, result.errors?.join('\n'));
  assert.deepEqual(result.batch.workflow.approvedCandidateIds, ['candidate-1']);
  assert.deepEqual(result.batch.suggestions[0].quality.purposeCodes, ['compression', 'chapter-focus']);
  assert.deepEqual(result.batch.suggestions[0].quality.evidenceIds, ['ev-1']);
  assert.deepEqual(result.batch.suggestions[0].quality.styleRuleIds, ['STYLE-01']);
});
