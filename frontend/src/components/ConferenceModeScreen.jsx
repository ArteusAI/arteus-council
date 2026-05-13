import './LoginInterface.css';
import './ConferenceModeScreen.css';

function ConferenceModeScreen({ t, theme }) {
  const baseUrl = import.meta.env.BASE_URL || '/';

  return (
    <div className="login-container">
      <div className="login-card conference-card">
        <div className="conference-content">
          <img
            src={`${baseUrl}telegrambot.jpg`}
            alt="Telegram Bot"
            className="conference-image"
          />
          <h2 className="conference-message">
            {t?.('conferenceMode') || 'Thank you for being with us!'}
          </h2>
          <p className="conference-desc">
            {t?.('conferenceModeDesc') || 'See you at the next conference. Stay tuned for more!'}
          </p>
          <a 
            href="https://t.me/ai_first_second_and_third_bot" 
            target="_blank" 
            rel="noopener noreferrer"
            className="conference-telegram-link"
          >
            📱 {t?.('conferenceTelegramBot') || 'Follow updates in our Telegram bot'}
          </a>
        </div>
      </div>
    </div>
  );
}

export default ConferenceModeScreen;
