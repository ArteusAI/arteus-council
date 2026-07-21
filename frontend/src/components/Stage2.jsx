import { useState } from 'react';
import ModelLabel from './ModelLabel';
import MarkdownRenderer from './MarkdownRenderer';
import { getModelDisplayName } from '../utils/modelDisplay';
import { formatResponseMarkdown } from '../utils/responseMarkdown';
import './Stage2.css';

function deAnonymizeText(text, labelToModel) {
  if (!labelToModel) return text;

  let result = text;
  // Replace each "Response X" with the actual model name
  Object.entries(labelToModel).forEach(([label, model]) => {
    const modelShortName = getModelDisplayName(model);
    result = result.replace(new RegExp(label, 'g'), `**${modelShortName}**`);
  });
  return result;
}

export default function Stage2({ rankings, labelToModel, aggregateRankings, aggregateRankingsRef, title, t }) {
  const [activeTab, setActiveTab] = useState(0);

  if (!rankings || rankings.length === 0) {
    return null;
  }

    return (
    <div className="stage stage2">
      <h3 className="stage-title">{title || t('stage2Title')}</h3>

      <h4>{t('rawEvaluations')}</h4>
      <p className="stage-description">
        {t('stage2Desc1')} {t('stage2Desc2')}
      </p>

      <div className="tabs">
        {rankings.map((rank, index) => (
          <button
            key={index}
            className={`tab ${activeTab === index ? 'active' : ''}`}
            onClick={() => setActiveTab(index)}
          >
            <ModelLabel model={rank.model} />
          </button>
        ))}
      </div>

      <div className="tab-content">
        <div className="ranking-model">
          <ModelLabel model={rankings[activeTab].model} />
        </div>
        <div className="ranking-content">
          <MarkdownRenderer>
            {deAnonymizeText(formatResponseMarkdown(rankings[activeTab].ranking), labelToModel)}
          </MarkdownRenderer>
        </div>

            {rankings[activeTab].parsed_ranking &&
             rankings[activeTab].parsed_ranking.length > 0 && (
            <div className="parsed-ranking">
            <strong>{t('extractedRanking')}</strong>
            <ol>
              {rankings[activeTab].parsed_ranking.map((label, i) => (
                <li key={i}>
                  {labelToModel && labelToModel[label]
                    ? <ModelLabel model={labelToModel[label]} />
                    : label}
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>

      {aggregateRankings && aggregateRankings.length > 0 && (
        <div ref={aggregateRankingsRef} className="aggregate-rankings">
          <h4>{t('aggregateRankings')}</h4>
          <p className="stage-description">{t('aggregateDesc')}</p>
          <div className="aggregate-list">
            {aggregateRankings.map((agg, index) => (
              <div key={index} className="aggregate-item">
                <span className="rank-position">#{index + 1}</span>
                <span className="rank-model">
                  <ModelLabel model={agg.model} />
                </span>
                <span className="rank-score">
                  {t('avgShort')}: {agg.average_rank.toFixed(2)}
                </span>
                <span className="rank-count">
                  ({agg.rankings_count} {t('votes')})
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
