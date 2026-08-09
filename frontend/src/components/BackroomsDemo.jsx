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
const MONSTER_W = 64;
const MONSTER_H = 128;
const SCARE_FIRST_S = 10;
const SCARE_MIN_DIST = 12;
const SCARE_GAP_MIN_S = 14;
const SCARE_GAP_MAX_S = 32;

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

/**
 * Tall lanky backrooms entity: readable silhouette, lit eyes, pale smile.
 */
function buildMonsterTexture() {
  const tex = new Uint32Array(MONSTER_W * MONSTER_H);
  const setPx = (x, y, r, g, b, a = 255) => {
    if (x < 0 || y < 0 || x >= MONSTER_W || y >= MONSTER_H) return;
    tex[y * MONSTER_W + x] = (a << 24) | ((b | 0) << 16) | ((g | 0) << 8) | (r | 0);
  };

  for (let y = 0; y < MONSTER_H; y++) {
    for (let x = 0; x < MONSTER_W; x++) {
      const nx = (x - MONSTER_W * 0.5) / (MONSTER_W * 0.5);
      const ny = y / MONSTER_H;
      let inside = false;
      let r = 0;
      let g = 0;
      let b = 0;

      // head
      if (ny > 0.02 && ny < 0.24) {
        const hx = nx / (0.42 + (0.24 - ny) * 0.35);
        const hy = (ny - 0.13) / 0.11;
        inside = hx * hx + hy * hy < 1;
        r = 78;
        g = 68;
        b = 42;
      }
      // neck
      if (ny >= 0.2 && ny < 0.3 && Math.abs(nx) < 0.14) {
        inside = true;
        r = 66;
        g = 58;
        b = 36;
      }
      // torso
      if (ny >= 0.26 && ny < 0.64) {
        const half = 0.26 + (ny - 0.26) * 0.1;
        if (Math.abs(nx) < half) {
          inside = true;
          r = 82;
          g = 72;
          b = 44;
        }
      }
      // long arms
      if (ny >= 0.28 && ny < 0.94) {
        const armX = 0.3 + (ny - 0.28) * 0.14;
        const armW = 0.09 + (ny > 0.68 ? (ny - 0.68) * 0.18 : 0);
        if (Math.abs(Math.abs(nx) - armX) < armW) {
          inside = true;
          r = 70;
          g = 60;
          b = 38;
        }
      }
      // legs
      if (ny >= 0.6 && ny < 0.99) {
        const legX = 0.11 + (ny - 0.6) * 0.07;
        if (Math.abs(Math.abs(nx) - legX) < 0.09) {
          inside = true;
          r = 58;
          g = 50;
          b = 32;
        }
      }

      if (!inside) continue;

      const stain = ((x * 17 + y * 31) & 15) / 15;
      r = Math.max(20, r - stain * 8);
      g = Math.max(16, g - stain * 6);
      b = Math.max(10, b - stain * 4);

      // glowing void eyes
      if (ny > 0.09 && ny < 0.16) {
        if (Math.abs(nx - 0.13) < 0.055 || Math.abs(nx + 0.13) < 0.055) {
          r = 255;
          g = 248;
          b = 210;
        }
      }
      // stretched pale smile
      if (ny > 0.15 && ny < 0.2) {
        const smile =
          Math.abs(nx) < 0.24 && Math.abs(ny - 0.172 - nx * nx * 0.45) < 0.016;
        if (smile) {
          r = 255;
          g = 250;
          b = 220;
        }
      }

      setPx(x, y, r, g, b, 255);
    }
  }
  return tex;
}

function hasLineOfSight(x0, y0, x1, y1) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const dist = Math.hypot(dx, dy);
  if (dist < 0.2) return true;
  const steps = Math.ceil(dist * 5);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (isWallCell(Math.floor(x0 + dx * t), Math.floor(y0 + dy * t))) {
      return false;
    }
  }
  return true;
}

/**
 * Spawn ahead in open LOS — slightly off-center so it reads as a side leap.
 */
function findScareSpawn(posX, posY, dirX, dirY) {
  const perpX = -dirY;
  const perpY = dirX;
  const side = Math.random() < 0.5 ? 1 : -1;

  for (const ahead of [3.2, 3.8, 2.7, 4.4, 2.3, 5.0]) {
    for (const sideDist of [0.7, 1.15, 0.35, 1.55, 0.15]) {
      const x = posX + dirX * ahead + perpX * side * sideDist;
      const y = posY + dirY * ahead + perpY * side * sideDist;
      if (!isOpen(x, y, 0.3)) continue;
      if (!hasLineOfSight(posX, posY, x, y)) continue;
      return { x, y, side };
    }
  }

  return {
    x: posX + dirX * 3.0 + perpX * side * 0.4,
    y: posY + dirY * 3.0 + perpY * side * 0.4,
    side,
  };
}

function nextScareAt(elapsed) {
  return elapsed + SCARE_GAP_MIN_S + Math.random() * (SCARE_GAP_MAX_S - SCARE_GAP_MIN_S);
}

export default function BackroomsDemo({ onClose, audioContextRef }) {
  const canvasRef = useRef(null);
  const distanceRef = useRef(null);
  const roomsRef = useRef(null);
  const [showCard, setShowCard] = useState(true);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const flickerRef = useRef(1);
  const footstepRef = useRef(null);
  const jumpScareRef = useRef(null);
  const bloodMeltRef = useRef(null);

  // --- Render loop: raycasting + procedural world -------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d', { alpha: false });
    const buffer = document.createElement('canvas');
    const bctx = buffer.getContext('2d', { alpha: false });

    const wallpaper = buildWallpaper();
    const noise = buildNoise();
    const monsterTex = buildMonsterTexture();

    let bw = 0;
    let bh = 0;
    let img = null;
    let px = null;
    let zBuf = null;
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
      zBuf = new Float32Array(bw);
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

    // Recurring entity jump-scare, then Doom-style blood melt back into rooms.
    const meltCanvas = document.createElement('canvas');
    const meltCtx = meltCanvas.getContext('2d', { alpha: false });
    const scare = {
      phase: 'wait', // wait | lurk | jump | aftermath | melt
      x: 0,
      y: 0,
      lurkX: 0,
      lurkY: 0,
      t: 0,
      triggerAt: SCARE_FIRST_S + Math.random() * 5,
      shake: 0,
      flash: 0,
      meltCapture: false,
      meltCols: null,
      meltColW: 4,
      meltDone: false,
    };

    const initBloodMelt = () => {
      const colW = width <= 480 ? 3 : 4;
      const cols = Math.ceil(width / colW);
      const offsets = new Int16Array(cols);
      // Doom melt: staggered column delays that wander like a ragged curtain.
      let delay = -((Math.random() * 12) | 0);
      for (let i = 0; i < cols; i++) {
        offsets[i] = delay;
        delay += ((Math.random() * 3) | 0) - 1;
        if (delay > 0) delay = 0;
        if (delay < -16) delay = -16;
      }
      scare.meltColW = colW;
      scare.meltCols = offsets;
      scare.meltDone = false;

      // Snapshot → low-res blood sheet → nearest-neighbor upscale (chunky pixels).
      const pw = Math.max(80, (width / 4) | 0);
      const ph = Math.max(50, (height / 4) | 0);
      meltCanvas.width = width;
      meltCanvas.height = height;
      meltCtx.imageSmoothingEnabled = false;
      meltCtx.drawImage(canvas, 0, 0, pw, ph);

      meltCtx.globalCompositeOperation = 'multiply';
      meltCtx.fillStyle = '#6a0505';
      meltCtx.fillRect(0, 0, pw, ph);
      meltCtx.globalCompositeOperation = 'source-over';
      meltCtx.fillStyle = 'rgba(120, 0, 0, 0.45)';
      meltCtx.fillRect(0, 0, pw, ph);

      const speck = meltCtx.getImageData(0, 0, pw, ph);
      const d = speck.data;
      for (let i = 0; i < d.length; i += 4) {
        const n = (Math.random() * 48) | 0;
        d[i] = Math.min(255, d[i] + n);
        d[i + 1] = Math.max(0, d[i + 1] - (n >> 2));
        d[i + 2] = Math.max(0, d[i + 2] - (n >> 1));
      }
      meltCtx.putImageData(speck, 0, 0);
      meltCtx.drawImage(meltCanvas, 0, 0, pw, ph, 0, 0, width, height);
    };

    const drawBloodMelt = (step) => {
      if (!scare.meltCols) return;
      const colW = scare.meltColW;
      const cols = scare.meltCols;
      let finished = 0;
      ctx.imageSmoothingEnabled = false;

      for (let i = 0; i < cols.length; i++) {
        let y = cols[i];
        if (y < 0) {
          y += 1;
          cols[i] = y;
          if (y < 0) {
            // still waiting — draw full column at top
            ctx.drawImage(
              meltCanvas,
              i * colW,
              0,
              colW,
              height,
              i * colW,
              0,
              colW,
              height
            );
            continue;
          }
        } else {
          y += step;
          cols[i] = y;
        }

        if (y >= height) {
          finished += 1;
          continue;
        }

        ctx.drawImage(
          meltCanvas,
          i * colW,
          0,
          colW,
          height,
          i * colW,
          y,
          colW,
          height
        );

        // Jagged bloody frontier + drips hanging into the revealed rooms.
        if (y > 0 && y < height) {
          ctx.fillStyle = i % 2 === 0 ? '#5c0404' : '#7a0808';
          ctx.fillRect(i * colW, y, colW, 2);
          if (i % 3 === 0) {
            const drip = 3 + (i % 8);
            ctx.fillStyle = '#3a0000';
            ctx.fillRect(
              i * colW + (colW > 2 ? 1 : 0),
              Math.max(0, y - drip),
              Math.max(1, colW - 1),
              drip
            );
          }
        }
      }

      scare.meltDone = finished >= cols.length;
    };

    const startTime = performance.now();
    let lastFrame = startTime;
    let raf = 0;
    let hudTick = 0;

    const render = (now) => {
      const elapsed = (now - startTime) / 1000;
      const dt = Math.min(0.05, (now - lastFrame) / 1000 || 0.016);
      lastFrame = now;

      // --- entity scare state machine --------------------------------------
      if (scare.phase === 'wait' && elapsed >= scare.triggerAt && distance >= SCARE_MIN_DIST) {
        const spawn = findScareSpawn(posX, posY, dirX, dirY);
        scare.lurkX = spawn.x;
        scare.lurkY = spawn.y;
        scare.x = spawn.x;
        scare.y = spawn.y;
        scare.t = 0;
        scare.phase = 'lurk';
        // Dim lights, but keep enough light for the silhouette to read.
        flickerEventEnd = elapsed + 0.9;
        flickerEventDepth = 0.55;
        nextFlickerEvent = elapsed + 8;
      } else if (scare.phase === 'lurk') {
        scare.t += dt;
        // Keep facing the spawn a bit so the player actually sees it.
        let toEntity = Math.atan2(scare.y - posY, scare.x - posX) - Math.atan2(dirY, dirX);
        while (toEntity > Math.PI) toEntity -= TAU;
        while (toEntity < -Math.PI) toEntity += TAU;
        rotateBy(Math.max(-2.8 * dt, Math.min(2.8 * dt, toEntity)));
        if (scare.t >= 0.85) {
          scare.phase = 'jump';
          scare.t = 0;
          jumpScareRef.current?.();
        }
      } else if (scare.phase === 'jump') {
        scare.t += dt;
        const p = Math.min(1, scare.t / 0.62);
        const leap = p * p * (3 - 2 * p);
        const targetX = posX + dirX * 0.95;
        const targetY = posY + dirY * 0.95;
        scare.x = scare.lurkX + (targetX - scare.lurkX) * leap;
        scare.y = scare.lurkY + (targetY - scare.lurkY) * leap;
        scare.shake = 6 + p * 22;
        scare.flash = p > 0.78 ? (p - 0.78) / 0.22 : 0;
        if (p >= 1) {
          scare.phase = 'aftermath';
          scare.t = 0;
          scare.flash = 1;
        }
      } else if (scare.phase === 'aftermath') {
        scare.t += dt;
        scare.flash = Math.max(0.35, 1 - scare.t * 0.7);
        scare.shake = Math.max(0, 16 * (1 - scare.t / 0.5));
        // Hold the close-up face, then blood-melt back into the rooms.
        if (scare.t > 0.4) {
          scare.phase = 'melt';
          scare.t = 0;
          scare.flash = 0;
          scare.shake = 0;
          scare.meltCapture = true;
        }
      } else if (scare.phase === 'melt') {
        scare.t += dt;
        if (scare.meltDone) {
          scare.phase = 'wait';
          scare.triggerAt = nextScareAt(elapsed);
          scare.meltCols = null;
          scare.x = 0;
          scare.y = 0;
        }
      }

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

      const inScare =
        scare.phase === 'lurk' ||
        scare.phase === 'jump' ||
        scare.phase === 'aftermath' ||
        scare.phase === 'melt';
      const speed =
        scare.phase === 'melt' ? 1.2 : scare.phase === 'lurk' ? 0.9 : inScare ? 0.25 : 2.35;
      const radius = 0.22;
      let wp = null;
      // During scare, hold the look — don't let autopilot turn away from the entity.
      if (!inScare && pathIndex < path.length) {
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
        zBuf[x] = perpDist;
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

      // --- entity billboard (occluded by walls via z-buffer) ---------------
      if (
        scare.phase === 'lurk' ||
        scare.phase === 'jump' ||
        scare.phase === 'aftermath'
      ) {
        const relX = scare.x - posX;
        const relY = scare.y - posY;
        const invDet = 1.0 / (planeX * dirY - dirX * planeY || 1e-9);
        const transformX = invDet * (dirY * relX - dirX * relY);
        const transformY = invDet * (-planeY * relX + planeX * relY);

        if (transformY > 0.12) {
          const scaleBoost =
            scare.phase === 'jump' || scare.phase === 'aftermath' ? 1.7 : 1.45;
          const spriteH = Math.abs(bh / transformY) * scaleBoost;
          const spriteW = spriteH * (MONSTER_W / MONSTER_H) * 0.78;
          const drawStartY = horizon - spriteH * 0.95;
          const drawEndY = drawStartY + spriteH;
          const screenX = (bw / 2) * (1 + transformX / transformY);
          const drawStartX = Math.floor(screenX - spriteW / 2);
          const drawEndX = Math.floor(screenX + spriteW / 2);
          const texStepX = MONSTER_W / (drawEndX - drawStartX || 1);
          const texStepY = MONSTER_H / (drawEndY - drawStartY || 1);
          const fog = Math.min(1, transformY / 12);
          const lurkFade =
            scare.phase === 'lurk' ? Math.min(1, 0.35 + scare.t / 0.4) : 1;
          const jumpPulse =
            scare.phase === 'jump'
              ? 0.9 + 0.7 * Math.min(1, scare.t / 0.62)
              : scare.phase === 'aftermath'
                ? 1.6
                : 1;
          // Keep the creature readable even during lamp failures.
          const shade =
            Math.max(0.7, flicker) * (1 - fog * 0.4) * lurkFade * jumpPulse;
          // Close leap punches through walls so it can't vanish behind a pillar.
          const punchThrough =
            scare.phase === 'jump' || scare.phase === 'aftermath'
              ? transformY < 2.8
              : false;

          for (let stripe = drawStartX; stripe < drawEndX; stripe++) {
            if (stripe < 0 || stripe >= bw) continue;
            if (!punchThrough && transformY >= zBuf[stripe]) continue;
            const texX = Math.min(
              MONSTER_W - 1,
              Math.max(0, ((stripe - drawStartX) * texStepX) | 0)
            );
            const y0 = Math.max(0, Math.ceil(drawStartY));
            const y1 = Math.min(bh - 1, Math.floor(drawEndY));
            for (let y = y0; y <= y1; y++) {
              const texY = Math.min(
                MONSTER_H - 1,
                Math.max(0, ((y - drawStartY) * texStepY) | 0)
              );
              const c = monsterTex[texY * MONSTER_W + texX];
              if ((c >>> 24) < 16) continue;
              let r = (c & 255) * shade;
              let g = ((c >> 8) & 255) * shade;
              let b = ((c >> 16) & 255) * shade;
              // Eyes / smile bloom on leap
              if (r > 170) {
                r = Math.min(255, r * 1.45);
                g = Math.min(255, g * 1.3);
                b = Math.min(255, b * 1.15);
              }
              px[y * bw + stripe] =
                (255 << 24) |
                ((Math.min(255, b | 0)) << 16) |
                ((Math.min(255, g | 0)) << 8) |
                (Math.min(255, r | 0));
            }
          }
        }
      }

      bctx.putImageData(img, 0, 0);
      ctx.imageSmoothingEnabled = true;
      const shakeX = scare.shake ? (Math.random() - 0.5) * scare.shake : 0;
      const shakeY = scare.shake ? (Math.random() - 0.5) * scare.shake : 0;
      if (scare.shake) {
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, width, height);
      }
      ctx.drawImage(buffer, shakeX, shakeY, width, height);

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

      if (scare.phase === 'lurk' || scare.phase === 'jump' || scare.phase === 'aftermath') {
        ctx.fillStyle = `rgba(40, 8, 4, ${
          scare.phase === 'jump' || scare.phase === 'aftermath' ? 0.22 : 0.1
        })`;
        ctx.fillRect(0, 0, width, height);
      }

      if (scare.flash > 0) {
        if (scare.phase === 'aftermath') {
          // Keep the face readable under the blood wash for the melt snapshot.
          ctx.fillStyle = `rgba(110, 0, 0, ${scare.flash * 0.45})`;
          ctx.fillRect(0, 0, width, height);
        } else {
          ctx.fillStyle = `rgba(0, 0, 0, ${scare.flash * 0.55})`;
          ctx.fillRect(0, 0, width, height);
        }
      }

      if (Math.random() > (scare.phase === 'jump' ? 0.7 : 0.978)) {
        const sliceY = Math.random() * height;
        const sliceH = Math.random() * 10 + 3;
        ctx.fillStyle = 'rgba(255, 249, 214, 0.06)';
        ctx.fillRect(0, sliceY, width, sliceH);
      }

      // Doom II-style column melt: pixel blood sheet slides off, rooms beneath.
      if (scare.phase === 'melt') {
        if (scare.meltCapture) {
          initBloodMelt();
          scare.meltCapture = false;
          bloodMeltRef.current?.();
        }
        const meltStep = Math.max(2, Math.round(height * dt * 1.65));
        drawBloodMelt(meltStep);
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

    // Scare FX bypass the quiet ambient bus so the roar actually cuts through.
    const scareBus = ac.createGain();
    scareBus.gain.setValueAtTime(0.0001, ac.currentTime);
    scareBus.gain.exponentialRampToValueAtTime(0.55, ac.currentTime + 0.4);
    scareBus.connect(ac.destination);

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

    // Entity leap: low roar + harsh scream on the loud scare bus.
    jumpScareRef.current = () => {
      ac.resume().catch(() => {});
      const t = ac.currentTime;

      const roar = ac.createOscillator();
      roar.type = 'sawtooth';
      roar.frequency.setValueAtTime(70, t);
      roar.frequency.exponentialRampToValueAtTime(26, t + 0.85);
      const roarFilter = ac.createBiquadFilter();
      roarFilter.type = 'lowpass';
      roarFilter.frequency.setValueAtTime(640, t);
      const roarGain = ac.createGain();
      roarGain.gain.setValueAtTime(0.0001, t);
      roarGain.gain.exponentialRampToValueAtTime(0.85, t + 0.03);
      roarGain.gain.exponentialRampToValueAtTime(0.0001, t + 1.0);
      roar.connect(roarFilter);
      roarFilter.connect(roarGain);
      roarGain.connect(scareBus);
      roar.start(t);
      roar.stop(t + 1.05);

      const scream = ac.createOscillator();
      scream.type = 'square';
      scream.frequency.setValueAtTime(920, t);
      scream.frequency.exponentialRampToValueAtTime(160, t + 0.5);
      const screamFilter = ac.createBiquadFilter();
      screamFilter.type = 'bandpass';
      screamFilter.frequency.setValueAtTime(1600, t);
      screamFilter.Q.setValueAtTime(3.5, t);
      const screamGain = ac.createGain();
      screamGain.gain.setValueAtTime(0.0001, t);
      screamGain.gain.exponentialRampToValueAtTime(0.35, t + 0.02);
      screamGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
      scream.connect(screamFilter);
      screamFilter.connect(screamGain);
      screamGain.connect(scareBus);
      scream.start(t);
      scream.stop(t + 0.6);

      const hit = ac.createBufferSource();
      hit.buffer = noiseBuffer;
      const hitFilter = ac.createBiquadFilter();
      hitFilter.type = 'highpass';
      hitFilter.frequency.setValueAtTime(700, t);
      const hitGain = ac.createGain();
      hitGain.gain.setValueAtTime(0.0001, t);
      hitGain.gain.exponentialRampToValueAtTime(0.55, t + 0.01);
      hitGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
      hit.connect(hitFilter);
      hitFilter.connect(hitGain);
      hitGain.connect(scareBus);
      hit.start(t, Math.random() * 1.2, 0.45);
    };

    // Wet Doom-style melt: descending filtered noise + low thud.
    bloodMeltRef.current = () => {
      ac.resume().catch(() => {});
      const t = ac.currentTime;

      const wet = ac.createBufferSource();
      wet.buffer = noiseBuffer;
      const wetFilter = ac.createBiquadFilter();
      wetFilter.type = 'lowpass';
      wetFilter.frequency.setValueAtTime(900, t);
      wetFilter.frequency.exponentialRampToValueAtTime(180, t + 1.4);
      const wetGain = ac.createGain();
      wetGain.gain.setValueAtTime(0.0001, t);
      wetGain.gain.exponentialRampToValueAtTime(0.4, t + 0.05);
      wetGain.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
      wet.connect(wetFilter);
      wetFilter.connect(wetGain);
      wetGain.connect(scareBus);
      wet.start(t, Math.random() * 0.8, 1.7);

      const thud = ac.createOscillator();
      thud.type = 'sine';
      thud.frequency.setValueAtTime(42, t);
      thud.frequency.exponentialRampToValueAtTime(18, t + 0.5);
      const thudGain = ac.createGain();
      thudGain.gain.setValueAtTime(0.0001, t);
      thudGain.gain.exponentialRampToValueAtTime(0.45, t + 0.02);
      thudGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
      thud.connect(thudGain);
      thudGain.connect(scareBus);
      thud.start(t);
      thud.stop(t + 0.6);
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
      jumpScareRef.current = null;
      bloodMeltRef.current = null;
      const t = ac.currentTime;
      master.gain.cancelScheduledValues(t);
      master.gain.setValueAtTime(Math.max(master.gain.value, 0.0001), t);
      master.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
      window.setTimeout(() => {
        try {
          osc.forEach((o) => o.stop());
          buzzSource.stop();
          master.disconnect();
          scareBus.disconnect();
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
