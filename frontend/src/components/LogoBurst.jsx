import { useEffect, useMemo } from 'react';
import './LogoBurst.css';

const BURST_DURATION_MS = 820;

export default function LogoBurst({ onComplete }) {
  const particles = useMemo(
    () =>
      Array.from({ length: 18 }, (_, index) => {
        const angle = (index / 18) * 360;
        const distance = index % 3 === 0 ? 118 : index % 3 === 1 ? 92 : 70;
        const delay = index * 12;

        return {
          id: index,
          style: {
            '--angle': `${angle}deg`,
            '--distance': `${distance}px`,
            '--delay': `${delay}ms`,
          },
        };
      }),
    []
  );

  useEffect(() => {
    try {
      navigator.vibrate?.([12, 30, 18]);
    } catch {
      // Vibration support is optional and should never block the visual effect.
    }

    const timer = window.setTimeout(onComplete, BURST_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [onComplete]);

  return (
    <div className="logo-burst" aria-hidden="true">
      <div className="logo-burst-origin">
        <div className="logo-burst-flash" />
        <div className="logo-burst-ring ring-one" />
        <div className="logo-burst-ring ring-two" />
        <div className="logo-burst-ring ring-three" />
        {particles.map((particle) => (
          <span
            key={particle.id}
            className="logo-burst-particle"
            style={particle.style}
          />
        ))}
      </div>
    </div>
  );
}
