import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import './Stage1.css';

const markdownComponents = {
  a: ({ node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />
};

export default function Stage1({ responses, t, modelAliases = {} }) {
  const [activeTab, setActiveTab] = useState(0);

  if (!responses || responses.length === 0) {
    return null;
  }

  const getModelName = (model) => modelAliases[model] || model.split('/')[1] || model;

  return (
    <div className="stage stage1">
      <h3 className="stage-title">{t('stage1Title')}</h3>

      <div className="tabs">
        {responses.map((resp, index) => (
          <button
            key={index}
            className={`tab ${activeTab === index ? 'active' : ''}`}
            onClick={() => setActiveTab(index)}
          >
            {getModelName(resp.model)}
          </button>
        ))}
      </div>

      <div className="tab-content">
        <div className="model-name">{getModelName(responses[activeTab].model)}</div>
        <div className="response-text markdown-content">
          <ReactMarkdown components={markdownComponents}>{responses[activeTab].response}</ReactMarkdown>
        </div>
      </div>
    </div>
  );
}
