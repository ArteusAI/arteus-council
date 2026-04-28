import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import ModelLabel from './ModelLabel';
import './Stage1.css';

export default function Stage1({ responses, title, t }) {
  const [activeTab, setActiveTab] = useState(0);

  if (!responses || responses.length === 0) {
    return null;
  }

    return (
    <div className="stage stage1">
      <h3 className="stage-title">{title || t('stage1Title')}</h3>

      <div className="tabs">
        {responses.map((resp, index) => (
          <button
            key={index}
            className={`tab ${activeTab === index ? 'active' : ''}`}
            onClick={() => setActiveTab(index)}
          >
            <ModelLabel model={resp.model} />
          </button>
        ))}
      </div>

      <div className="tab-content">
        <div className="model-name">
          <ModelLabel model={responses[activeTab].model} />
        </div>
        <div className="response-text markdown-content">
          <ReactMarkdown>{responses[activeTab].response}</ReactMarkdown>
        </div>
      </div>
    </div>
  );
}
