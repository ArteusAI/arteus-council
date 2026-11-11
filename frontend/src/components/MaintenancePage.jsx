import './MaintenancePage.css';

function MaintenancePage({ theme, t, message, onRetry, logoUrl }) {
  return (
    <div className={`app maintenance-page ${theme}`}>
      <div className="maintenance-card" role="status" aria-live="polite">
        <div className="maintenance-visual" aria-hidden="true">
          <div className="maintenance-ring" />
          <img className="maintenance-logo" src={logoUrl} alt="" />
        </div>
        <span className="maintenance-badge">{t('maintenanceBadge')}</span>
        <h1 className="maintenance-title">{t('maintenanceTitle')}</h1>
        <p className="maintenance-text">{message || t('maintenanceText')}</p>
        <p className="maintenance-note">{t('maintenanceNote')}</p>
        <button type="button" className="maintenance-retry" onClick={onRetry}>
          {t('maintenanceRetry')}
        </button>
      </div>
    </div>
  );
}

export default MaintenancePage;
