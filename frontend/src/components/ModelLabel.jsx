import { getModelDisplayName, getModelIconUrl } from '../utils/modelDisplay';
import './ModelLabel.css';

export default function ModelLabel({ model, className = '', showIcon = true }) {
  const iconUrl = getModelIconUrl(model);
  const displayName = getModelDisplayName(model);

  return (
    <span className={`model-label ${className}`.trim()} title={model || displayName}>
      {showIcon && iconUrl && (
        <img
          className="model-label-icon"
          src={iconUrl}
          alt=""
          aria-hidden="true"
        />
      )}
      <span className="model-label-text">{displayName}</span>
    </span>
  );
}
