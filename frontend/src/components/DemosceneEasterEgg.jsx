import { useEffect, useRef, useState } from 'react';
import { takePrimedDemosceneAudio } from '../utils/demosceneAudio';
import './DemosceneEasterEgg.css';

const TAU = Math.PI * 2;

export default function DemosceneEasterEgg({ onClose }) {
  const canvasRef = useRef(null);
  const [showText, setShowText] = useState(false);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const animationRef = useRef(null);
  const audioRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    const backgroundCanvas = document.createElement('canvas');
    const backgroundCtx = backgroundCanvas.getContext('2d', { alpha: false });
    let width = window.innerWidth;
    let height = window.innerHeight;
    let pixelRatio = 1;
    let startTime = performance.now();
    let lastFrame = startTime;
    let stars = [];
    let dust = [];
    let accretion = [];

    const isMobile = () => width <= 480;
    const centerX = () => width * 0.5;
    const centerY = () => height * 0.5;
    const getCanvasPixelRatio = () => {
      const deviceRatio = window.devicePixelRatio || 1;
      const longEdge = Math.max(window.innerWidth, window.innerHeight);

      if (longEdge >= 1800) return Math.min(deviceRatio, 0.85);
      if (longEdge >= 1200) return Math.min(deviceRatio, 1);
      return Math.min(deviceRatio, 1.25);
    };

    const resizeCanvas = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      pixelRatio = getCanvasPixelRatio();
      canvas.width = Math.floor(width * pixelRatio);
      canvas.height = Math.floor(height * pixelRatio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      ctx.imageSmoothingEnabled = true;
    };

    const resetStar = (star, deep = false) => {
      const spread = Math.max(width, height) * 1.25;
      star.x = (Math.random() - 0.5) * spread;
      star.y = (Math.random() - 0.5) * spread;
      star.z = deep ? Math.random() * 1200 + 600 : Math.random() * 1400 + 80;
      star.size = Math.random() * 1.6 + 0.35;
      star.tint = Math.random();
      star.prevX = null;
      star.prevY = null;
    };

    const buildParticles = () => {
      const starCount = isMobile() ? 180 : 380;
      const dustCount = isMobile() ? 12 : 24;
      const diskCount = isMobile() ? 54 : 92;

      stars = Array.from({ length: starCount }, () => {
        const star = {};
        resetStar(star, true);
        return star;
      });

      dust = Array.from({ length: dustCount }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        radius: Math.random() * 240 + 120,
        alpha: Math.random() * 0.08 + 0.025,
        hue: Math.random() > 0.55 ? 196 : 270,
      }));

      accretion = Array.from({ length: diskCount }, () => ({
        angle: Math.random() * TAU,
        radius: Math.random() * 0.75 + 0.4,
        speed: Math.random() * 0.45 + 0.25,
        size: Math.random() * 2.4 + 0.8,
        lane: Math.random() > 0.5 ? 1 : -1,
        hueShift: Math.random() * 40 - 20,
      }));
    };

    const buildBackgroundTexture = () => {
      const textureScale = Math.min(0.45, 760 / Math.max(width, height));
      const textureWidth = Math.max(1, Math.floor(width * textureScale));
      const textureHeight = Math.max(1, Math.floor(height * textureScale));

      backgroundCanvas.width = textureWidth;
      backgroundCanvas.height = textureHeight;

      const bg = backgroundCtx.createRadialGradient(
        textureWidth * 0.5,
        textureHeight * 0.42,
        0,
        textureWidth * 0.5,
        textureHeight * 0.5,
        Math.max(textureWidth, textureHeight) * 0.85
      );
      bg.addColorStop(0, 'rgb(9, 18, 42)');
      bg.addColorStop(0.5, 'rgb(2, 6, 19)');
      bg.addColorStop(1, 'rgb(0, 0, 0)');
      backgroundCtx.fillStyle = bg;
      backgroundCtx.fillRect(0, 0, textureWidth, textureHeight);

      for (const cloud of dust) {
        const nebula = backgroundCtx.createRadialGradient(
          cloud.x * textureScale,
          cloud.y * textureScale,
          0,
          cloud.x * textureScale,
          cloud.y * textureScale,
          cloud.radius * textureScale
        );
        nebula.addColorStop(0, `hsla(${cloud.hue}, 100%, 62%, ${cloud.alpha})`);
        nebula.addColorStop(1, 'rgba(0, 0, 0, 0)');
        backgroundCtx.fillStyle = nebula;
        backgroundCtx.fillRect(0, 0, textureWidth, textureHeight);
      }
    };

    const resize = () => {
      resizeCanvas();
      buildParticles();
      buildBackgroundTexture();
    };

    resize();
    window.addEventListener('resize', resize);

    const drawBackground = (elapsed) => {
      const pulse = Math.sin(elapsed * 0.18) * 0.5 + 0.5;
      ctx.drawImage(backgroundCanvas, 0, 0, width, height);
      ctx.fillStyle = `rgba(9, 18, 42, ${0.02 + pulse * 0.025})`;
      ctx.fillRect(0, 0, width, height);
    };

    const drawStars = (elapsed, delta) => {
      const cx = centerX();
      const cy = centerY();
      const warp = Math.min(1, Math.max(0, (elapsed - 3) / 4));
      const blackHolePull = Math.min(1, Math.max(0, (elapsed - 6.5) / 4));
      const speed = 38 + warp * 520 + blackHolePull * 160;
      const focal = Math.min(width, height) * (isMobile() ? 0.72 : 0.88);

      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const star of stars) {
        const prevX = star.prevX;
        const prevY = star.prevY;
        star.z -= speed * delta;
        star.x += Math.sin(elapsed * 0.14 + star.y * 0.003) * blackHolePull * 10 * delta;
        star.y += Math.cos(elapsed * 0.12 + star.x * 0.003) * blackHolePull * 8 * delta;

        if (star.z < 18) {
          resetStar(star);
        }

        const lens = blackHolePull * 0.18;
        const twist = Math.atan2(star.y, star.x) + lens * Math.sin(elapsed + star.z * 0.004);
        const distance = Math.hypot(star.x, star.y) * (1 + lens);
        const projectedX = cx + (Math.cos(twist) * distance / star.z) * focal;
        const projectedY = cy + (Math.sin(twist) * distance / star.z) * focal;

        if (
          projectedX < -80 ||
          projectedX > width + 80 ||
          projectedY < -80 ||
          projectedY > height + 80
        ) {
          resetStar(star);
          continue;
        }

        const depth = 1 - Math.min(star.z / 1500, 1);
        const alpha = Math.min(1, 0.18 + depth * 0.9);
        const size = star.size + depth * (warp > 0.2 ? 2.5 : 1.3);
        const hue = star.tint > 0.7 ? 196 : star.tint > 0.42 ? 46 : 220;

        if (warp > 0.08 && prevX !== null && prevY !== null) {
          const tail = 1 + warp * (isMobile() ? 7 : 13);
          const dx = projectedX - prevX;
          const dy = projectedY - prevY;
          ctx.strokeStyle = `hsla(${hue}, 100%, ${68 + depth * 24}%, ${alpha})`;
          ctx.lineWidth = Math.max(1, size * 0.7);
          ctx.beginPath();
          ctx.moveTo(projectedX - dx * tail, projectedY - dy * tail);
          ctx.lineTo(projectedX, projectedY);
          ctx.stroke();
        } else {
          ctx.fillStyle = `hsla(${hue}, 100%, ${72 + depth * 22}%, ${alpha})`;
          ctx.beginPath();
          ctx.arc(projectedX, projectedY, size, 0, TAU);
          ctx.fill();
        }

        star.prevX = projectedX;
        star.prevY = projectedY;
      }
      ctx.restore();
    };

    const drawBlackHole = (elapsed) => {
      const reveal = Math.min(1, Math.max(0, (elapsed - 6.2) / 3.2));
      if (reveal <= 0) return;

      const cx = centerX() + Math.sin(elapsed * 0.22) * width * 0.025;
      const cy = centerY() - height * 0.04 + Math.cos(elapsed * 0.17) * height * 0.018;
      const base = Math.min(width, height) * (isMobile() ? 0.18 : 0.22);
      const radius = base * (0.45 + reveal * 0.9 + Math.sin(elapsed * 0.8) * 0.025);
      const diskWidth = radius * (3.15 + reveal * 0.35);
      const diskHeight = radius * 0.62;
      const horizonGlow = ctx.createRadialGradient(cx, cy, radius * 0.2, cx, cy, radius * 3.2);

      horizonGlow.addColorStop(0, 'rgba(0, 0, 0, 1)');
      horizonGlow.addColorStop(0.32, 'rgba(0, 0, 0, 0.98)');
      horizonGlow.addColorStop(0.43, `rgba(104, 224, 255, ${0.18 * reveal})`);
      horizonGlow.addColorStop(0.55, `rgba(255, 143, 57, ${0.2 * reveal})`);
      horizonGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = horizonGlow;
      ctx.beginPath();
      ctx.arc(cx, cy, radius * 3.2, 0, TAU);
      ctx.fill();

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(Math.sin(elapsed * 0.08) * 0.08);
      ctx.globalCompositeOperation = 'lighter';

      for (let i = 0; i < 3; i++) {
        const scale = 1 + i * 0.14;
        ctx.strokeStyle = `hsla(${28 + i * 10}, 100%, ${58 + i * 5}%, ${0.2 * reveal})`;
        ctx.lineWidth = Math.max(1, radius * (0.07 - i * 0.007));
        ctx.beginPath();
        ctx.ellipse(0, 0, diskWidth * scale, diskHeight * scale, 0, 0, TAU);
        ctx.stroke();
      }

      for (const particle of accretion) {
        const orbit = particle.angle + elapsed * particle.speed * particle.lane;
        const r = radius * (1.15 + particle.radius * 1.2);
        const x = Math.cos(orbit) * r * 1.72;
        const y = Math.sin(orbit) * r * 0.34;
        const front = Math.sin(orbit) > 0 ? 1 : 0.46;
        const hue = 35 + particle.hueShift + front * 170;

        ctx.fillStyle = `hsla(${hue}, 100%, ${58 + front * 22}%, ${reveal * front})`;
        ctx.beginPath();
        ctx.ellipse(x, y, particle.size * (1.4 + front), particle.size, 0, 0, TAU);
        ctx.fill();
      }

      ctx.strokeStyle = `rgba(151, 232, 255, ${0.58 * reveal})`;
      ctx.lineWidth = Math.max(1, radius * 0.025);
      ctx.beginPath();
      ctx.arc(0, 0, radius * 1.28, -0.25, TAU - 0.25);
      ctx.stroke();
      ctx.restore();

      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, TAU);
      ctx.fill();

      const rim = ctx.createRadialGradient(cx, cy, radius * 0.8, cx, cy, radius * 1.45);
      rim.addColorStop(0, 'rgba(0, 0, 0, 0)');
      rim.addColorStop(0.68, `rgba(132, 229, 255, ${0.42 * reveal})`);
      rim.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = rim;
      ctx.beginPath();
      ctx.arc(cx, cy, radius * 1.55, 0, TAU);
      ctx.fill();
    };

    const drawHudText = (elapsed) => {
      const cx = centerX();
      const y = height * (isMobile() ? 0.76 : 0.78);
      const fontSize = isMobile() ? 12 : 14;
      const label = elapsed < 6.5 ? 'WARP VECTOR LOCKED' : 'EVENT HORIZON APPROACH';

      ctx.save();
      ctx.font = `700 ${fontSize}px "Courier New", monospace`;
      ctx.textAlign = 'center';
      ctx.fillStyle = `rgba(151, 232, 255, ${0.32 + Math.sin(elapsed * 4) * 0.12})`;
      ctx.fillText(label, cx, y);
      ctx.restore();
    };

    const drawPostEffects = (elapsed) => {
      const vignette = ctx.createRadialGradient(
        centerX(),
        centerY(),
        Math.min(width, height) * 0.22,
        centerX(),
        centerY(),
        Math.max(width, height) * 0.72
      );
      vignette.addColorStop(0, 'rgba(0,0,0,0)');
      vignette.addColorStop(1, 'rgba(0,0,0,0.62)');
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, width, height);

      ctx.fillStyle = 'rgba(255, 255, 255, 0.025)';
      for (let y = 0; y < height; y += 5) {
        ctx.fillRect(0, y, width, 1);
      }

      if (Math.random() > 0.975) {
        const sliceY = Math.random() * height;
        const sliceH = Math.random() * 14 + 4;
        const offset = Math.sin(elapsed * 8) * 18;
        ctx.fillStyle = 'rgba(145, 232, 255, 0.08)';
        ctx.fillRect(Math.min(0, offset), sliceY, width + Math.abs(offset), sliceH);
        ctx.fillStyle = 'rgba(255, 143, 57, 0.06)';
        ctx.fillRect(Math.max(0, offset), sliceY + sliceH * 0.35, width, 1);
      }
    };

    const render = (now) => {
      const elapsed = (now - startTime) / 1000;
      const delta = Math.min(0.05, (now - lastFrame) / 1000 || 0.016);
      lastFrame = now;

      drawBackground(elapsed);
      drawStars(elapsed, delta);
      drawBlackHole(elapsed);
      drawHudText(elapsed);
      drawPostEffects(elapsed);

      animationRef.current = requestAnimationFrame(render);
    };

    const textTimer = window.setTimeout(() => setShowText(true), 900);

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    animationRef.current = requestAnimationFrame(render);

    return () => {
      window.clearTimeout(textTimer);
      window.removeEventListener('resize', resize);
      window.removeEventListener('keydown', handleKeyDown);
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [onClose]);

  useEffect(() => {
    let stopped = false;
    let stepTimer = null;
    let sweepTimer = null;
    let audioContext = null;
    let master = null;

    const noteToFrequency = (note) => 440 * 2 ** ((note - 69) / 12);

    const createVoice = (time, note, duration, type, gain, filterFrequency = 2400) => {
      if (!audioContext || !master) return;

      const oscillator = audioContext.createOscillator();
      const filter = audioContext.createBiquadFilter();
      const envelope = audioContext.createGain();
      const frequency = noteToFrequency(note);

      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, time);
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(filterFrequency, time);
      filter.Q.setValueAtTime(2.5, time);
      envelope.gain.setValueAtTime(0.0001, time);
      envelope.gain.exponentialRampToValueAtTime(gain, time + 0.025);
      envelope.gain.exponentialRampToValueAtTime(0.0001, time + duration);

      oscillator.connect(filter);
      filter.connect(envelope);
      envelope.connect(master);
      oscillator.start(time);
      oscillator.stop(time + duration + 0.04);
    };

    const createNoiseSweep = (time) => {
      if (!audioContext || !master) return;

      const bufferSize = audioContext.sampleRate * 1.8;
      const buffer = audioContext.createBuffer(1, bufferSize, audioContext.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
      }

      const source = audioContext.createBufferSource();
      const filter = audioContext.createBiquadFilter();
      const envelope = audioContext.createGain();

      source.buffer = buffer;
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(320, time);
      filter.frequency.exponentialRampToValueAtTime(4200, time + 1.4);
      filter.Q.setValueAtTime(7, time);
      envelope.gain.setValueAtTime(0.0001, time);
      envelope.gain.exponentialRampToValueAtTime(0.11, time + 0.18);
      envelope.gain.exponentialRampToValueAtTime(0.0001, time + 1.6);

      source.connect(filter);
      filter.connect(envelope);
      envelope.connect(master);
      source.start(time);
      source.stop(time + 1.8);
    };

    const startMusic = async () => {
      try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) {
          setAudioBlocked(true);
          return;
        }

        audioContext = takePrimedDemosceneAudio() || new AudioContext();
        await audioContext.resume();

        master = audioContext.createGain();
        master.gain.setValueAtTime(0.0001, audioContext.currentTime);
        master.gain.exponentialRampToValueAtTime(0.18, audioContext.currentTime + 0.9);
        master.connect(audioContext.destination);

        const bass = [33, 33, 40, 33, 31, 31, 38, 31];
        const arp = [57, 64, 69, 76, 71, 69, 64, 60, 55, 62, 67, 74, 69, 67, 62, 59];
        const lead = [81, 79, 76, 79, 84, 83, 79, 76];
        let step = 0;

        const schedule = () => {
          if (stopped || !audioContext) return;
          const time = audioContext.currentTime + 0.045;
          const beat = step % 16;

          createVoice(time, bass[step % bass.length], 0.42, 'sawtooth', 0.08, 520);
          createVoice(time, arp[step % arp.length], 0.16, 'square', 0.045, 2400);

          if (beat % 4 === 0) {
            createVoice(time, lead[Math.floor(step / 4) % lead.length], 0.68, 'triangle', 0.055, 3600);
          }

          if (beat === 0 || beat === 8) {
            createNoiseSweep(time);
          }

          step += 1;
          stepTimer = window.setTimeout(schedule, 185);
        };

        sweepTimer = window.setTimeout(() => createNoiseSweep(audioContext.currentTime), 3200);
        schedule();
        audioRef.current = {
          stop: () => {
            stopped = true;
            window.clearTimeout(stepTimer);
            window.clearTimeout(sweepTimer);
            if (master && audioContext) {
              const now = audioContext.currentTime;
              master.gain.cancelScheduledValues(now);
              master.gain.setValueAtTime(Math.max(master.gain.value, 0.0001), now);
              master.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
            }
            window.setTimeout(() => {
              audioContext?.close().catch(() => {});
            }, 220);
          },
        };
      } catch {
        setAudioBlocked(true);
      }
    };

    startMusic();

    return () => {
      stopped = true;
      window.clearTimeout(stepTimer);
      window.clearTimeout(sweepTimer);
      audioRef.current?.stop();
      audioRef.current = null;
    };
  }, []);

  const handleClose = () => {
    audioRef.current?.stop();
    audioRef.current = null;
    onClose();
  };

  return (
    <div className="demoscene-overlay" onClick={handleClose}>
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
          We're building AI assistants that aren't afraid to cross the event horizon
        </p>
        <div className="demoscene-hint">
          <span className="blink">[</span> PRESS ESC OR CLICK TO EXIT <span className="blink">]</span>
        </div>
        {audioBlocked && (
          <div className="demoscene-audio-note">
            AUDIO SYSTEM MUTED BY BROWSER
          </div>
        )}
      </div>

      <div className="demoscene-credits">
        <span>WARP DRIVE</span>
        <span className="separator">///</span>
        <span>BLACK HOLE INTRO 2026</span>
      </div>
    </div>
  );
}
