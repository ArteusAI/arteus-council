import { useEffect, useRef, useState } from 'react';
import './DemosceneEasterEgg.css';

export default function DemosceneEasterEgg({ onClose }) {
  const canvasRef = useRef(null);
  const [showText, setShowText] = useState(false);
  const animationRef = useRef(null);
  const startTimeRef = useRef(null);

  useEffect(() => {
    startTimeRef.current = Date.now();
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    let width = window.innerWidth;
    let height = window.innerHeight;
    canvas.width = width;
    canvas.height = height;

    // Starfield particles - reduce count on mobile for performance
    const starCount = width <= 480 ? 200 : 400;
    const stars = Array.from({ length: starCount }, () => ({
      x: Math.random() * width - width / 2,
      y: Math.random() * height - height / 2,
      z: Math.random() * 1000,
    }));

    // Plasma parameters
    const plasmaScale = 0.02;
    let time = 0;

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width;
      canvas.height = height;
    };
    window.addEventListener('resize', resize);

    // Color palette - cyberpunk neon
    const hslToRgb = (h, s, l) => {
      let r, g, b;
      if (s === 0) {
        r = g = b = l;
      } else {
        const hue2rgb = (p, q, t) => {
          if (t < 0) t += 1;
          if (t > 1) t -= 1;
          if (t < 1 / 6) return p + (q - p) * 6 * t;
          if (t < 1 / 2) return q;
          if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
          return p;
        };
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = hue2rgb(p, q, h + 1 / 3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1 / 3);
      }
      return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
    };

    // Glitch effect
    const glitch = (ctx, w, h, intensity) => {
      if (Math.random() > 0.95) {
        const sliceY = Math.random() * h;
        const sliceH = Math.random() * 30 + 5;
        const offset = (Math.random() - 0.5) * intensity * 50;
        const imgData = ctx.getImageData(0, sliceY, w, sliceH);
        ctx.putImageData(imgData, offset, sliceY);
      }
    };

    // Scanlines
    const drawScanlines = (ctx, w, h) => {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.03)';
      for (let y = 0; y < h; y += 2) {
        ctx.fillRect(0, y, w, 1);
      }
    };

    // CRT effect
    const drawCRT = (ctx, w, h) => {
      const gradient = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w * 0.8);
      gradient.addColorStop(0, 'rgba(0,0,0,0)');
      gradient.addColorStop(1, 'rgba(0,0,0,0.4)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, w, h);
    };

    // Rotozoom plasma - responsive step size for mobile performance
    const drawPlasma = (ctx, w, h, t) => {
      const imgData = ctx.createImageData(w, h);
      const data = imgData.data;
      const cx = w / 2;
      const cy = h / 2;
      const zoom = 2 + Math.sin(t * 0.3) * 0.5;
      const rot = t * 0.1;
      const cosR = Math.cos(rot);
      const sinR = Math.sin(rot);
      const step = w <= 480 ? 4 : 3;

      for (let y = 0; y < h; y += step) {
        for (let x = 0; x < w; x += step) {
          const dx = (x - cx) / zoom;
          const dy = (y - cy) / zoom;
          const rx = dx * cosR - dy * sinR;
          const ry = dx * sinR + dy * cosR;

          const val1 = Math.sin(rx * plasmaScale + t);
          const val2 = Math.sin(ry * plasmaScale + t * 0.8);
          const val3 = Math.sin((rx + ry) * plasmaScale * 0.5 + t * 1.2);
          const val4 = Math.sin(Math.sqrt(rx * rx + ry * ry) * plasmaScale * 0.5 + t * 0.5);
          const val = (val1 + val2 + val3 + val4) / 4;

          const hue = (val * 0.5 + 0.5 + t * 0.02) % 1;
          const [r, g, b] = hslToRgb(hue, 0.85, 0.45);

          for (let dy2 = 0; dy2 < step && y + dy2 < h; dy2++) {
            for (let dx2 = 0; dx2 < step && x + dx2 < w; dx2++) {
              const idx = ((y + dy2) * w + (x + dx2)) * 4;
              data[idx] = r;
              data[idx + 1] = g;
              data[idx + 2] = b;
              data[idx + 3] = 120;
            }
          }
        }
      }
      ctx.putImageData(imgData, 0, 0);
    };

    // 3D Starfield
    const drawStarfield = (ctx, w, h, t) => {
      const cx = w / 2;
      const cy = h / 2;
      const speed = 8;

      for (const star of stars) {
        star.z -= speed;
        if (star.z <= 0) {
          star.x = Math.random() * w - cx;
          star.y = Math.random() * h - cy;
          star.z = 1000;
        }

        const sx = (star.x / star.z) * 500 + cx;
        const sy = (star.y / star.z) * 500 + cy;
        const size = (1 - star.z / 1000) * 3;
        const brightness = 1 - star.z / 1000;

        if (sx >= 0 && sx < w && sy >= 0 && sy < h) {
          const hue = (t * 0.01 + brightness * 0.5) % 1;
          ctx.fillStyle = `hsla(${hue * 360}, 100%, ${50 + brightness * 50}%, ${brightness})`;
          ctx.beginPath();
          ctx.arc(sx, sy, size, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    };

    // Tunnel effect - responsive for mobile
    const drawTunnel = (ctx, w, h, t) => {
      const cx = w / 2;
      const cy = h / 2;
      const maxRadius = Math.min(w, h) * 0.6;
      const isMobile = w <= 480;
      const ringCount = isMobile ? 15 : 20;
      const segments = isMobile ? 12 : 16;

      for (let ring = 0; ring < ringCount; ring++) {
        const depth = (ring + t * 2) % ringCount;
        const radius = (depth / ringCount) * maxRadius;
        const alpha = 1 - depth / ringCount;
        const hue = (ring * 18 + t * 30) % 360;

        ctx.strokeStyle = `hsla(${hue}, 100%, 60%, ${alpha * 0.5})`;
        ctx.lineWidth = isMobile ? 1.5 : 2;
        ctx.beginPath();

        for (let i = 0; i <= segments; i++) {
          const angle = (i / segments) * Math.PI * 2 + t * 0.2 + ring * 0.1;
          const wobble = Math.sin(angle * 3 + t) * (isMobile ? 6 : 10) * (1 - depth / ringCount);
          const x = cx + Math.cos(angle) * (radius + wobble);
          const y = cy + Math.sin(angle) * (radius + wobble);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.stroke();
      }
    };

    // Matrix rain - responsive sizing
    const matrixColWidth = width <= 480 ? 14 : 20;
    const matrixFontSize = width <= 480 ? 12 : 16;
    const matrixColumns = Math.floor(width / matrixColWidth);
    const matrixDrops = Array.from({ length: matrixColumns }, () => Math.random() * height);
    const chars = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン01';

    const drawMatrix = (ctx, w, h, t) => {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.05)';
      ctx.fillRect(0, 0, w, h);

      ctx.font = `${matrixFontSize}px monospace`;

      for (let i = 0; i < matrixDrops.length; i++) {
        const char = chars[Math.floor(Math.random() * chars.length)];
        const x = i * matrixColWidth;
        const y = matrixDrops[i];
        const hue = (t * 10 + i * 5) % 360;

        ctx.fillStyle = `hsla(${hue}, 100%, 50%, 0.8)`;
        ctx.fillText(char, x, y);

        if (y > h && Math.random() > 0.98) {
          matrixDrops[i] = 0;
        }
        matrixDrops[i] += width <= 480 ? 12 : 15;
      }
    };

    // Scrolling text
    let scrollX = width;
    const scrollText = '>>> ARTEUS <<<  We\'re building AI assistants that aren\'t afraid to break the rules  :::  ';

    const getResponsiveFontSize = (w) => {
      if (w <= 360) return 18;
      if (w <= 390) return 22;
      if (w <= 480) return 28;
      if (w <= 768) return 36;
      return 48;
    };

    const getResponsiveWaveAmplitude = (w) => {
      if (w <= 480) return 10;
      return 20;
    };

    const drawScrollText = (ctx, w, h, t) => {
      ctx.save();
      const fontSize = getResponsiveFontSize(w);
      const waveAmplitude = getResponsiveWaveAmplitude(w);
      ctx.font = `bold ${fontSize}px "Courier New", monospace`;

      const textWidth = ctx.measureText(scrollText).width;
      const scrollSpeed = w <= 480 ? 2 : 4;
      scrollX -= scrollSpeed;
      if (scrollX < -textWidth) scrollX = w;

      // Glow effect
      for (let i = 3; i > 0; i--) {
        const hue = (t * 20) % 360;
        ctx.fillStyle = `hsla(${hue}, 100%, 60%, ${0.2 / i})`;
        ctx.fillText(scrollText, scrollX - i, h / 2 + Math.sin(t + scrollX * 0.01) * waveAmplitude);
        ctx.fillText(scrollText, scrollX + i, h / 2 + Math.sin(t + scrollX * 0.01) * waveAmplitude);
      }

      const hue = (t * 20) % 360;
      ctx.fillStyle = `hsl(${hue}, 100%, 70%)`;
      ctx.fillText(scrollText, scrollX, h / 2 + Math.sin(t + scrollX * 0.01) * waveAmplitude);
      ctx.restore();
    };

    // Copper bars - responsive sizing
    const drawCopperBars = (ctx, w, h, t) => {
      const isMobile = w <= 480;
      const barCount = isMobile ? 6 : 8;
      const barHeight = isMobile ? 25 : 40;
      const waveAmplitude = isMobile ? 60 : 100;
      const barSpacing = isMobile ? 35 : 50;

      for (let i = 0; i < barCount; i++) {
        const y = h * 0.3 + Math.sin(t * 2 + i * 0.5) * waveAmplitude + i * barSpacing;
        const hue = (t * 30 + i * 45) % 360;

        const gradient = ctx.createLinearGradient(0, y, 0, y + barHeight);
        gradient.addColorStop(0, `hsla(${hue}, 100%, 30%, 0.7)`);
        gradient.addColorStop(0.5, `hsla(${hue}, 100%, 70%, 0.8)`);
        gradient.addColorStop(1, `hsla(${hue}, 100%, 30%, 0.7)`);

        ctx.fillStyle = gradient;
        ctx.fillRect(0, y, w, barHeight);
      }
    };

    // Main render loop
    const phases = [
      { duration: 5000, effect: 'plasma' },
      { duration: 5000, effect: 'starfield' },
      { duration: 5000, effect: 'tunnel' },
      { duration: 5000, effect: 'matrix' },
    ];
    let currentPhase = 0;
    let phaseStart = Date.now();

    const render = () => {
      time += 0.02;
      const elapsed = Date.now() - startTimeRef.current;

      // Phase transition
      if (Date.now() - phaseStart > phases[currentPhase].duration) {
        currentPhase = (currentPhase + 1) % phases.length;
        phaseStart = Date.now();
      }

      // Fade background
      ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
      ctx.fillRect(0, 0, width, height);

      // Draw current effect
      const phase = phases[currentPhase].effect;
      if (phase === 'plasma') {
        drawPlasma(ctx, width, height, time);
        drawCopperBars(ctx, width, height, time);
      } else if (phase === 'starfield') {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.fillRect(0, 0, width, height);
        drawStarfield(ctx, width, height, time);
        drawTunnel(ctx, width, height, time);
      } else if (phase === 'tunnel') {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
        ctx.fillRect(0, 0, width, height);
        drawTunnel(ctx, width, height, time);
        drawStarfield(ctx, width, height, time);
      } else if (phase === 'matrix') {
        drawMatrix(ctx, width, height, time);
      }

      // Always show scrolling text
      drawScrollText(ctx, width, height, time);

      // Post effects
      glitch(ctx, width, height, 0.5);
      drawScanlines(ctx, width, height);
      drawCRT(ctx, width, height);

      // Show main text after 1 second
      if (elapsed > 1000 && !showText) {
        setShowText(true);
      }

      animationRef.current = requestAnimationFrame(render);
    };

    render();

    // Keyboard handler
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('resize', resize);
      window.removeEventListener('keydown', handleKeyDown);
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [onClose, showText]);

  return (
    <div className="demoscene-overlay" onClick={onClose}>
      <canvas ref={canvasRef} className="demoscene-canvas" />
      
      <div className={`demoscene-content ${showText ? 'visible' : ''}`}>
        <div className="demoscene-logo">
          <img
            src="https://framerusercontent.com/images/G4MFpJVGo4QKdInsGAegy907Em4.png"
            alt="Arteus"
            className="demoscene-logo-img"
          />
        </div>
        <h1 className="demoscene-title">
          <span className="glitch" data-text="ARTEUS">ARTEUS</span>
        </h1>
        <p className="demoscene-subtitle">
          We're building AI assistants that aren't afraid to break the rules
        </p>
        <div className="demoscene-hint">
          <span className="blink">[</span> PRESS ESC OR CLICK TO EXIT <span className="blink">]</span>
        </div>
      </div>

      <div className="demoscene-credits">
        <span>64K INTRO</span>
        <span className="separator">///</span>
        <span>ARTEUS CREW 2025</span>
      </div>
    </div>
  );
}

