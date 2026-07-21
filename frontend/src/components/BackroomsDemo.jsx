import { useEffect, useRef, useState } from 'react';
import {
  findExplorationPath,
  hash2,
  isOpen,
  isWallCell,
  smoothPath,
} from '../utils/backroomsMap';
import './BackroomsDemo.css';

const TAU = Math.PI * 2;
const WALL_TEX = 128;
const NOISE_TEX = 256;

function buildWallpaper() {
  // Pastel-yellow office wallpaper with vertical stripes, crown trim and baseboard.
  const tex = new Uint32Array(WALL_TEX * WALL_TEX);
  for (let y = 0; y < WALL_TEX; y++) {
    for (let x = 0; x < WALL_TEX; x++) {
      let r = 204;
      let g = 193;
      let b = 122;

      // vertical stripes
      if (x % 16 < 8) {
        r *= 0.95;
        g *= 0.95;
        b *= 0.95;
      }
      // faint chevron print
      if ((x + y * 2) % 32 < 2) {
        r *= 1.04;
        g *= 1.04;
        b *= 1.02;
      }
      // crown molding / baseboard
      if (y < 5) {
        r = 176;
        g = 166;
        b = 108;
      } else if (y >= 116) {
        r = 104;
        g = 96;
        b = 66;
      }

      const n = (Math.random() - 0.5) * 12;
      r = Math.max(0, Math.min(255, r + n));
      g = Math.max(0, Math.min(255, g + n));
      b = Math.max(0, Math.min(255, b + n));
      tex[y * WALL_TEX + x] = (255 << 24) | ((b | 0) << 16) | ((g | 0) << 8) | (r | 0);
    }
  }
  return tex;
}

function buildNoise() {
  const noise = new Uint8Array(NOISE_TEX * NOISE_TEX);
  for (let i = 0; i < noise.length; i++) {
    noise[i] = (Math.random() * 256) | 0;
  }
  return noise;
}

export default function BackroomsDemo({ onClose, audioContextRef }) {
  const canvasRef = useRef(null);
  const distanceRef = useRef(null);
  const roomsRef = useRef(null);
  const [showCard, setShowCard] = useState(true);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const flickerRef = useRef(1);
  const footstepRef = useRef(null);

  // --- Render loop: raycasting + procedural world -------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d', { alpha: false });
    const buffer = document.createElement('canvas');
    const bctx = buffer.getContext('2d', { alpha: false });

    const wallpaper = buildWallpaper();
    const noise = buildNoise();

    let bw = 0;
    let bh = 0;
    let img = null;
    let px = null;
    let width = window.innerWidth;
    let height = window.innerHeight;

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width;
      canvas.height = height;
      bw = Math.max(300, Math.min(540, Math.round(width / 3)));
      bh = Math.max(200, Math.round((bw * height) / width));
      buffer.width = bw;
      buffer.height = bh;
      img = bctx.createImageData(bw, bh);
      px = new Uint32Array(img.data.buffer);
    };
    resize();
    window.addEventListener('resize', resize);

    // Player state: spawn in the middle of chunk (0,0), heading east.
    let posX = 8.5;
    let posY = 8.5;
    let dirX = 1;
    let dirY = 0;
    let planeX = 0;
    let planeY = 0.66;
    let bobPhase = 0;
    let distance = 0;

    const rotateBy = (angle) => {
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const ndx = dirX * cos - dirY * sin;
      dirY = dirX * sin + dirY * cos;
      dirX = ndx;
      const npx = planeX * cos - planeY * sin;
      planeY = planeX * sin + planeY * cos;
      planeX = npx;
    };

    // Exploration autopilot: A* pathfinding toward unvisited cells, scored
    // farthest-from-spawn so the run keeps pushing into new rooms. The raw
    // grid path is string-pulled into a few long straight/diagonal segments
    // with a wall-proximity penalty keeping routes away from walls.
    const SPAWN_CELL = { x: 8, y: 8 };
    const visitedCells = new Set(['8,8']);
    const visitedChunks = new Set(['0,0']);
    const isVisited = (x, y) => visitedCells.has(`${x},${y}`);
    let path = [];
    let pathIndex = 0;
    let waypointTime = 0;
    let stuckTime = 0;

    // Fluorescent flicker scheduler.
    let nextFlickerEvent = 5 + Math.random() * 8;
    let flickerEventEnd = 0;
    let flickerEventDepth = 1;

    const startTime = performance.now();
    let lastFrame = startTime;
    let raf = 0;
    let hudTick = 0;

    const render = (now) => {
      const elapsed = (now - startTime) / 1000;
      const dt = Math.min(0.05, (now - lastFrame) / 1000 || 0.016);
      lastFrame = now;

      // --- autopilot movement ----------------------------------------------
      if (pathIndex >= path.length) {
        const raw = findExplorationPath(
          Math.floor(posX),
          Math.floor(posY),
          isVisited,
          SPAWN_CELL
        );
        path = smoothPath(raw, posX, posY);
        pathIndex = 0;
        waypointTime = 0;
      }

      const speed = 2.35;
      const radius = 0.22;
      let wp = null;
      if (pathIndex < path.length) {
        wp = path[pathIndex];
        const tx = wp.x;
        const ty = wp.y;
        let diff = Math.atan2(ty - posY, tx - posX) - Math.atan2(dirY, dirX);
        while (diff > Math.PI) diff -= TAU;
        while (diff < -Math.PI) diff += TAU;
        const maxTurn = 3.6 * dt;
        rotateBy(Math.max(-maxTurn, Math.min(maxTurn, diff)));
      }

      const stepX = dirX * speed * dt;
      const stepY = dirY * speed * dt;
      const prevPosX = posX;
      const prevPosY = posY;
      if (isOpen(posX + stepX + Math.sign(stepX) * 0.01, posY, radius)) {
        posX += stepX;
      }
      if (isOpen(posX, posY + stepY + Math.sign(stepY) * 0.01, radius)) {
        posY += stepY;
      }

      // Gentle wall repulsion: if a wall is close on one side, nudge the
      // player toward the open side so corridors stay centered.
      const perpX = -dirY;
      const perpY = dirX;
      const nudge = 0.42;
      const leftBlocked = !isOpen(posX + perpX * nudge, posY + perpY * nudge, radius);
      const rightBlocked = !isOpen(posX - perpX * nudge, posY - perpY * nudge, radius);
      if (leftBlocked && !rightBlocked) {
        const nx = posX - perpX * speed * 0.35 * dt;
        const ny = posY - perpY * speed * 0.35 * dt;
        if (isOpen(nx, ny, radius)) {
          posX = nx;
          posY = ny;
        }
      } else if (rightBlocked && !leftBlocked) {
        const nx = posX + perpX * speed * 0.35 * dt;
        const ny = posY + perpY * speed * 0.35 * dt;
        if (isOpen(nx, ny, radius)) {
          posX = nx;
          posY = ny;
        }
      }

      const actualMove = Math.hypot(posX - prevPosX, posY - prevPosY);
      distance += actualMove;
      bobPhase += speed * dt * 3.1;

      if (wp) {
        waypointTime += dt;
        const wpDist = Math.hypot(wp.x - posX, wp.y - posY);
        if (wpDist < 0.7 || waypointTime > 6) {
          pathIndex++;
          waypointTime = 0;
        }
      }

      // safety: if physically stuck despite a planned path, force a replan
      if (actualMove < speed * dt * 0.2) {
        stuckTime += dt;
        if (stuckTime > 0.5) {
          stuckTime = 0;
          path = [];
          pathIndex = 0;
        }
      } else {
        stuckTime = 0;
      }

      // mark visited cells / chunks as the run enters them
      const cellX = Math.floor(posX);
      const cellY = Math.floor(posY);
      const cellKey = `${cellX},${cellY}`;
      if (!visitedCells.has(cellKey)) {
        visitedCells.add(cellKey);
        visitedChunks.add(`${Math.floor(cellX / 16)},${Math.floor(cellY / 16)}`);
      }

      // --- flicker ----------------------------------------------------------
      let flicker = 1;
      if (elapsed >= nextFlickerEvent) {
        flickerEventEnd = elapsed + 0.25 + Math.random() * 0.45;
        flickerEventDepth = 0.45 + Math.random() * 0.35;
        nextFlickerEvent = elapsed + 6 + Math.random() * 9;
      }
      if (elapsed < flickerEventEnd) {
        flicker = flickerEventDepth + Math.random() * 0.12;
      } else {
        flicker = 0.985 + Math.random() * 0.015;
      }
      flickerRef.current = flicker;

      // footsteps sync with head bob
      const prevBob = Math.sin(bobPhase - speed * dt * 3.1);
      const curBob = Math.sin(bobPhase);
      if (prevBob > 0 !== curBob > 0 && footstepRef.current) {
        footstepRef.current();
      }

      const horizon = (bh >> 1) + Math.round(curBob * bh * 0.012);
      const rayDirX0 = dirX - planeX;
      const rayDirY0 = dirY - planeY;
      const rayDirX1 = dirX + planeX;
      const rayDirY1 = dirY + planeY;
      const timeQ = (elapsed * 9) | 0;

      // --- floor & ceiling --------------------------------------------------
      for (let y = 0; y < bh; y++) {
        const isFloorRow = y > horizon;
        const p = isFloorRow ? y - horizon : horizon - y;
        const rowOffset = y * bw;
        if (p <= 0) {
          const fogC = (255 << 24) | (26 << 16) | (24 << 8) | 38;
          for (let x = 0; x < bw; x++) px[rowOffset + x] = fogC;
          continue;
        }

        const rowDist = (0.5 * bh) / p;
        const stepWX = (rowDist * (rayDirX1 - rayDirX0)) / bw;
        const stepWY = (rowDist * (rayDirY1 - rayDirY0)) / bw;
        let wx = posX + rowDist * rayDirX0;
        let wy = posY + rowDist * rayDirY0;
        const fog = Math.min(1, rowDist / 16);
        const shade = flicker * (1 - fog * 0.88);

        for (let x = 0; x < bw; x++) {
          wx += stepWX;
          wy += stepWY;
          let r;
          let g;
          let b;

          if (isFloorRow) {
            // mono-yellow office carpet
            const n = noise[(((wx * 16) | 0) & 255) + ((((wy * 16) | 0) & 255) << 8)];
            const s = shade * (0.78 + (n / 255) * 0.32);
            r = 138 * s;
            g = 128 * s;
            b = 92 * s;
          } else {
            // ceiling tiles with rectangular fluorescent troffers
            const cx = Math.floor(wx);
            const cy = Math.floor(wy);
            const fx = wx - cx;
            const fy = wy - cy;
            if (fx < 0.025 || fy < 0.025) {
              // grid lines
              r = 150 * shade;
              g = 142 * shade;
              b = 108 * shade;
            } else {
              const hasLight =
                hash2(cx, cy, 55) < 0.3 &&
                Math.abs(fx - 0.5) < 0.19 &&
                Math.abs(fy - 0.5) < 0.36;
              if (hasLight) {
                const isFrame =
                  Math.abs(fx - 0.5) > 0.165 || Math.abs(fy - 0.5) > 0.335;
                if (isFrame) {
                  r = 120 * shade;
                  g = 116 * shade;
                  b = 100 * shade;
                } else {
                  // per-fixture buzz flicker
                  const buzz = hash2(cx + timeQ * 7919, cy, 77) < 0.07 ? 0.35 : 1;
                  const s = shade * buzz * (1 + fog * 1.6);
                  r = Math.min(255, 255 * s);
                  g = Math.min(255, 250 * s);
                  b = Math.min(255, 224 * s);
                }
              } else {
                const s = shade * 1.02;
                r = 186 * s;
                g = 176 * s;
                b = 138 * s;
              }
            }
          }

          px[rowOffset + x] =
            (255 << 24) |
            ((Math.max(0, Math.min(255, b | 0))) << 16) |
            ((Math.max(0, Math.min(255, g | 0))) << 8) |
            (Math.max(0, Math.min(255, r | 0)));
        }
      }

      // --- walls (DDA raycasting) -------------------------------------------
      for (let x = 0; x < bw; x++) {
        const cameraX = (2 * x) / bw - 1;
        const rdx = dirX + planeX * cameraX;
        const rdy = dirY + planeY * cameraX;

        let mapX = Math.floor(posX);
        let mapY = Math.floor(posY);
        const deltaX = Math.abs(1 / (rdx || 1e-9));
        const deltaY = Math.abs(1 / (rdy || 1e-9));
        let sideDistX;
        let sideDistY;
        let stepMapX;
        let stepMapY;

        if (rdx < 0) {
          stepMapX = -1;
          sideDistX = (posX - mapX) * deltaX;
        } else {
          stepMapX = 1;
          sideDistX = (mapX + 1 - posX) * deltaX;
        }
        if (rdy < 0) {
          stepMapY = -1;
          sideDistY = (posY - mapY) * deltaY;
        } else {
          stepMapY = 1;
          sideDistY = (mapY + 1 - posY) * deltaY;
        }

        let side = 0;
        for (let i = 0; i < 64; i++) {
          if (sideDistX < sideDistY) {
            sideDistX += deltaX;
            mapX += stepMapX;
            side = 0;
          } else {
            sideDistY += deltaY;
            mapY += stepMapY;
            side = 1;
          }
          if (isWallCell(mapX, mapY)) break;
        }

        const perpDist = Math.max(
          0.02,
          side === 0 ? sideDistX - deltaX : sideDistY - deltaY
        );
        const lineH = bh / perpDist;
        const wallStart = horizon - lineH / 2;
        const y0 = Math.max(0, Math.ceil(wallStart));
        const y1 = Math.min(bh - 1, Math.floor(wallStart + lineH));

        let wallX = side === 0 ? posY + perpDist * rdy : posX + perpDist * rdx;
        wallX -= Math.floor(wallX);
        let texX = (wallX * WALL_TEX) | 0;
        if ((side === 0 && rdx > 0) || (side === 1 && rdy < 0)) {
          texX = WALL_TEX - texX - 1;
        }

        const fog = Math.min(1, perpDist / 16);
        const shade = flicker * (side === 1 ? 0.72 : 1) * (1 - fog * 0.88);
        const texStep = WALL_TEX / lineH;

        for (let y = y0; y <= y1; y++) {
          let texY = ((y - wallStart) * texStep) | 0;
          if (texY < 0) texY = 0;
          else if (texY >= WALL_TEX) texY = WALL_TEX - 1;

          const c = wallpaper[texY * WALL_TEX + texX];
          const r = (c & 255) * shade;
          const g = ((c >> 8) & 255) * shade;
          const b = ((c >> 16) & 255) * shade;
          px[y * bw + x] =
            (255 << 24) |
            ((Math.min(255, b | 0)) << 16) |
            ((Math.min(255, g | 0)) << 8) |
            (Math.min(255, r | 0));
        }
      }

      bctx.putImageData(img, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(buffer, 0, 0, width, height);

      // --- post: vignette, scanlines, flicker dip, glitch slices ------------
      const vignette = ctx.createRadialGradient(
        width / 2,
        height / 2,
        Math.min(width, height) * 0.28,
        width / 2,
        height / 2,
        Math.max(width, height) * 0.75
      );
      vignette.addColorStop(0, 'rgba(20,16,4,0)');
      vignette.addColorStop(1, 'rgba(20,16,4,0.55)');
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, width, height);

      ctx.fillStyle = 'rgba(0, 0, 0, 0.05)';
      for (let y = 0; y < height; y += 4) {
        ctx.fillRect(0, y, width, 1);
      }

      if (flicker < 0.9) {
        ctx.fillStyle = `rgba(6, 5, 2, ${(1 - flicker) * 0.55})`;
        ctx.fillRect(0, 0, width, height);
      }

      if (Math.random() > 0.978) {
        const sliceY = Math.random() * height;
        const sliceH = Math.random() * 10 + 3;
        ctx.fillStyle = 'rgba(255, 249, 214, 0.06)';
        ctx.fillRect(0, sliceY, width, sliceH);
      }

      // HUD distance / rooms (direct DOM writes, no re-render)
      hudTick += dt;
      if (hudTick > 0.2 && distanceRef.current) {
        hudTick = 0;
        distanceRef.current.textContent = `${distance.toFixed(0)} m`;
        if (roomsRef.current) {
          roomsRef.current.textContent = String(visitedChunks.size);
        }
      }

      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);

    const cardTimer = window.setTimeout(() => setShowCard(false), 4200);

    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(cardTimer);
      window.removeEventListener('resize', resize);
    };
  }, []);

  // --- Audio: fluorescent hum + buzz synced with flicker ------------------
  useEffect(() => {
    let ac = audioContextRef?.current;
    if (!ac || ac.state === 'closed') {
      try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) {
          setAudioBlocked(true);
          return undefined;
        }
        ac = new AudioContext();
        if (audioContextRef) audioContextRef.current = ac;
      } catch {
        setAudioBlocked(true);
        return undefined;
      }
    }
    ac.resume().catch(() => {});

    const master = ac.createGain();
    master.gain.setValueAtTime(0.0001, ac.currentTime);
    master.gain.exponentialRampToValueAtTime(0.055, ac.currentTime + 1.4);
    master.connect(ac.destination);

    const humGain = ac.createGain();
    humGain.gain.setValueAtTime(0.5, ac.currentTime);
    humGain.connect(master);

    const osc = [50, 100, 150].map((freq, i) => {
      const o = ac.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(freq, ac.currentTime);
      const g = ac.createGain();
      g.gain.setValueAtTime([0.5, 0.16, 0.05][i], ac.currentTime);
      o.connect(g);
      g.connect(humGain);
      o.start();
      return o;
    });

    // buzz channel: bandpass-filtered noise, audible during flicker dips
    const noiseLen = ac.sampleRate * 2;
    const noiseBuffer = ac.createBuffer(1, noiseLen, ac.sampleRate);
    const noiseData = noiseBuffer.getChannelData(0);
    for (let i = 0; i < noiseLen; i++) {
      noiseData[i] = Math.random() * 2 - 1;
    }
    const buzzSource = ac.createBufferSource();
    buzzSource.buffer = noiseBuffer;
    buzzSource.loop = true;
    const buzzFilter = ac.createBiquadFilter();
    buzzFilter.type = 'bandpass';
    buzzFilter.frequency.setValueAtTime(3200, ac.currentTime);
    buzzFilter.Q.setValueAtTime(9, ac.currentTime);
    const buzzGain = ac.createGain();
    buzzGain.gain.setValueAtTime(0.0001, ac.currentTime);
    buzzSource.connect(buzzFilter);
    buzzFilter.connect(buzzGain);
    buzzGain.connect(master);
    buzzSource.start();

    // footsteps: short filtered noise taps, triggered from the render loop
    footstepRef.current = () => {
      if (ac.state !== 'running') return;
      const t = ac.currentTime;
      const src = ac.createBufferSource();
      src.buffer = noiseBuffer;
      const f = ac.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(240, t);
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.05, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
      src.connect(f);
      f.connect(g);
      g.connect(master);
      src.start(t, Math.random() * 1.5, 0.14);
    };

    const poll = window.setInterval(() => {
      const f = flickerRef.current;
      humGain.gain.setTargetAtTime(0.38 + f * 0.18, ac.currentTime, 0.05);
      buzzGain.gain.setTargetAtTime(
        f < 0.85 ? 0.06 * (1 - f) : 0.0001,
        ac.currentTime,
        0.04
      );
    }, 110);

    return () => {
      window.clearInterval(poll);
      footstepRef.current = null;
      const t = ac.currentTime;
      master.gain.cancelScheduledValues(t);
      master.gain.setValueAtTime(Math.max(master.gain.value, 0.0001), t);
      master.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
      window.setTimeout(() => {
        try {
          osc.forEach((o) => o.stop());
          buzzSource.stop();
          master.disconnect();
        } catch {
          // nodes may already be stopped
        }
      }, 320);
      // The AudioContext itself is owned and closed by the parent overlay.
    };
  }, [audioContextRef]);

  return (
    <div className="backrooms-container">
      <canvas ref={canvasRef} className="backrooms-canvas" />

      <div className={`backrooms-card ${showCard ? 'visible' : ''}`}>
        <div className="backrooms-card-title" data-text="LEVEL 0">
          LEVEL 0
        </div>
        <div className="backrooms-card-sub">// THE BACKROOMS //</div>
        <div className="backrooms-card-flavor">
          you noclipped out of reality
        </div>
      </div>

      <div className="backrooms-hud backrooms-hud-left">
        <span className="backrooms-hud-dim">RUN</span>{' '}
        <span ref={distanceRef}>0 m</span>
      </div>
      <div className="backrooms-hud backrooms-hud-right">
        <span className="backrooms-hud-dim">ROOMS</span>{' '}
        <span ref={roomsRef}>1</span>
      </div>
      <div className="backrooms-hint">
        <span className="blink">[</span> AUTOPILOT EXPLORING · ESC / CLICK —
        WAKE UP <span className="blink">]</span>
      </div>
      {audioBlocked && (
        <div className="backrooms-audio-note">AUDIO SYSTEM MUTED BY BROWSER</div>
      )}
    </div>
  );
}
