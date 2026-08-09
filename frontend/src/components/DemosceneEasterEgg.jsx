import { useCallback, useEffect, useRef, useState } from 'react';
import { takePrimedDemosceneAudio } from '../utils/demosceneAudio';
import BackroomsDemo from './BackroomsDemo';
import './DemosceneEasterEgg.css';

const BACKROOMS_FLASH_MS = 11500;
const BACKROOMS_PHASE_MS = 12300;
const FALL_START_MS = 3000;
const FALL_DUR_MS = BACKROOMS_FLASH_MS - FALL_START_MS;

const VERT_SHADER = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const FRAG_SHADER = `
precision highp float;

uniform vec2  uRes;
uniform float uTime;
uniform float uAz;
uniform float uEl;
uniform float uDist;
uniform float uAb;

const float DISC_IN  = 2.6;
const float DISC_OUT = 12.0;
const float ESCAPE_R = 44.0;
const int   STEPS    = 320;

float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}
float hash31(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
}
float noise2(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) {
        v += a * noise2(p);
        p = p * 2.03 + 13.7;
        a *= 0.5;
    }
    return v;
}
vec2 rot2(vec2 p, float a) {
    float c = cos(a), s = sin(a);
    return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
}

vec3 tempRamp(float x) {
    x = clamp(x, 0.0, 1.0);
    vec3 cold = mix(vec3(1.00, 0.22, 0.03), vec3(1.00, 0.55, 0.18), smoothstep(0.0, 0.4, x));
    vec3 hot  = mix(vec3(1.00, 0.90, 0.70), vec3(0.72, 0.82, 1.00), smoothstep(0.65, 1.0, x));
    return mix(cold, hot, smoothstep(0.25, 0.75, x));
}

vec3 discShade(vec3 hit, vec3 photonVel, out float alpha) {
    float r = length(hit.xz);

    float omega = 1.1 * pow(r, -1.5);
    vec2 q = rot2(hit.xz, uTime * omega);
    float n1 = fbm(q * 0.85);
    float n2 = fbm(q * 2.6 + n1 * 2.2);
    float d = 0.55 * n1 + 0.55 * n2;
    d *= 0.60 + 0.40 * sin(r * 3.0 - 2.0 * n1);

    float edge = smoothstep(DISC_IN, DISC_IN + 0.7, r)
               * smoothstep(DISC_OUT, DISC_OUT - 4.5, r);
    alpha = clamp(edge * (0.30 + 1.30 * d), 0.0, 0.95);

    vec3 tangent = normalize(vec3(-hit.z, 0.0, hit.x));
    float beta = clamp(sqrt(0.5 / r), 0.0, 0.98);
    float gamma = 1.0 / sqrt(1.0 - beta * beta);
    vec3 toObserver = -normalize(photonVel);
    float doppler = 1.0 / (gamma * (1.0 - beta * dot(tangent, toObserver)));

    float gr = sqrt(max(1.0 - 1.0 / r, 0.0));
    float shift = doppler * gr;

    float temp = pow(DISC_IN / r, 0.75);
    float x = clamp(temp * shift * 1.05 - 0.15, 0.0, 1.0);

    float brightness = (0.25 + 2.75 * pow(temp, 2.2))
                     * (0.35 + 1.1 * d)
                     * pow(shift, 3.0);
    return tempRamp(x) * min(brightness, 22.0);
}

vec3 background(vec3 rd) {
    vec3 col = vec3(0.0);

    float neb = fbm(rd.xy * 2.6 + 7.3) * fbm(rd.yz * 2.2 - 4.1);
    col += vec3(0.10, 0.13, 0.22) * pow(neb, 1.6) * 2.6;
    col += vec3(0.14, 0.07, 0.16) * pow(fbm(rd.zx * 3.1 + 2.2), 3.0) * 1.6;

    for (int i = 0; i < 2; i++) {
        float scale = i == 0 ? 170.0 : 353.0;
        vec3 cell = floor(rd * scale);
        float h = hash31(cell);
        float star = pow(max(h - 0.995, 0.0) / 0.005, 8.0);
        float tint = hash31(cell + 17.0);
        col += star * mix(vec3(0.9, 0.95, 1.2), vec3(1.2, 0.9, 0.7), tint) * 0.8;
    }
    return col;
}

vec3 aces(vec3 x) {
    return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

void main() {
    if (uDist <= 1.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }

    vec2 uv = (2.0 * gl_FragCoord.xy - uRes) / uRes.y;

    vec3 ro = uDist * vec3(cos(uEl) * cos(uAz), sin(uEl), cos(uEl) * sin(uAz));
    vec3 fwd = normalize(-ro);
    vec3 rgt = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
    vec3 up  = cross(rgt, fwd);
    vec3 rd  = normalize(fwd * 1.7 + uv.x * rgt + uv.y * up);

    rd = normalize(mix(rd, fwd, uAb * 0.8));

    vec3 pos = ro;
    vec3 vel = rd;
    vec3 hVec = cross(pos, vel);
    float h2 = dot(hVec, hVec);

    vec3 col = vec3(0.0);
    float trans = 1.0;
    bool captured = false;

    for (int i = 0; i < STEPS; i++) {
        float r2 = dot(pos, pos);
        float r = sqrt(r2);

        if (r < 1.0) { captured = true; break; }
        if (r > ESCAPE_R && dot(pos, vel) > 0.0) break;

        float dt = clamp(r * 0.14, 0.03, 0.55);
        if (abs(pos.y) < 0.6 && r < DISC_OUT + 2.0) dt = min(dt, 0.11);

        vec3 acc = -1.5 * h2 * pos / (r2 * r2 * r);
        vec3 prev = pos;
        vel += acc * dt;
        pos += vel * dt;

        if (prev.y * pos.y < 0.0) {
            float k = prev.y / (prev.y - pos.y);
            vec3 hit = mix(prev, pos, k);
            float hr = length(hit.xz);
            if (hr > DISC_IN && hr < DISC_OUT) {
                float a;
                vec3 e = discShade(hit, vel, a);
                col += trans * a * e;
                trans *= 1.0 - a;
                if (trans < 0.02) break;
            }
        }
    }

    if (!captured && trans > 0.02) {
        col += trans * background(normalize(vel));
    }

    col *= 1.0 + 0.08 * exp(-dot(uv, uv) * 0.5);

    float fade = clamp(1.6 * sqrt(max(1.0 - 1.0 / uDist, 0.0)) - 0.05, 0.0, 1.0);
    col *= fade * fade;

    col = aces(col * 0.85);
    col = pow(col, vec3(1.0 / 2.2));

    float v = 1.0 - 0.35 * pow(length(uv * vec2(0.7, 1.0)), 2.4);
    gl_FragColor = vec4(col * v, 1.0);
}
`;

function compileShader(gl, type, src) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(info || 'Shader compile failed');
  }
  return shader;
}

export default function DemosceneEasterEgg({ onClose }) {
  const canvasRef = useRef(null);
  const [showText, setShowText] = useState(false);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [phase, setPhase] = useState('warp');
  const [backroomsFlash, setBackroomsFlash] = useState(false);
  const animationRef = useRef(null);
  const audioRef = useRef(null);
  const sharedAudioContextRef = useRef(null);
  const pointerStateRef = useRef({ dragging: false, moved: false, lastX: 0, lastY: 0 });

  const handleClose = useCallback(() => {
    audioRef.current?.stop();
    audioRef.current = null;
    onClose();
  }, [onClose]);

  // ESC works in every phase; the warp intro noclips into the backrooms.
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        handleClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    const flashTimer = window.setTimeout(
      () => setBackroomsFlash(true),
      BACKROOMS_FLASH_MS
    );
    const phaseTimer = window.setTimeout(
      () => setPhase('backrooms'),
      BACKROOMS_PHASE_MS
    );

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.clearTimeout(flashTimer);
      window.clearTimeout(phaseTimer);
    };
  }, [handleClose]);

  // The shared AudioContext is owned here and closed on unmount.
  useEffect(() => {
    return () => {
      try {
        sharedAudioContextRef.current?.close?.();
      } catch {
        // already closed
      }
      sharedAudioContextRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (phase !== 'warp') {
      return undefined;
    }

    const canvas = canvasRef.current;
    const gl = canvas.getContext('webgl', { antialias: false, alpha: false });
    if (!gl) {
      setShowText(true);
      return undefined;
    }

    let az = 0.6;
    let el = 0.18;
    let dist = 15.0;
    let lastInput = 0;
    let mode = 'orbit';
    let fallT0 = 0;
    let fallFrom = 15;
    const pointer = pointerStateRef.current;

    let prog;
    let vs;
    let fs;
    try {
      prog = gl.createProgram();
      vs = compileShader(gl, gl.VERTEX_SHADER, VERT_SHADER);
      fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAG_SHADER);
      gl.attachShader(prog, vs);
      gl.attachShader(prog, fs);
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        throw new Error(gl.getProgramInfoLog(prog) || 'Program link failed');
      }
      gl.useProgram(prog);
    } catch {
      setShowText(true);
      return undefined;
    }

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const uniforms = {};
    for (const name of ['uRes', 'uTime', 'uAz', 'uEl', 'uDist', 'uAb']) {
      uniforms[name] = gl.getUniformLocation(prog, name);
    }

    const startFall = () => {
      if (mode !== 'orbit') return;
      mode = 'falling';
      fallT0 = performance.now();
      fallFrom = dist;
    };

    const fallTimer = window.setTimeout(startFall, FALL_START_MS);

    const onPointerDown = (e) => {
      pointer.dragging = true;
      pointer.moved = false;
      pointer.lastX = e.clientX;
      pointer.lastY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    };
    const onPointerMove = (e) => {
      if (!pointer.dragging || mode !== 'orbit') return;
      const dx = e.clientX - pointer.lastX;
      const dy = e.clientY - pointer.lastY;
      if (Math.abs(dx) + Math.abs(dy) > 3) pointer.moved = true;
      az += dx * 0.005;
      el = Math.min(1.2, Math.max(-1.2, el + dy * 0.004));
      pointer.lastX = e.clientX;
      pointer.lastY = e.clientY;
      lastInput = performance.now();
    };
    const onPointerUp = (e) => {
      const wasDrag = pointer.moved;
      pointer.dragging = false;
      if (!wasDrag) {
        handleClose();
      }
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {
        // already released
      }
    };
    const onWheel = (e) => {
      e.preventDefault();
      if (mode !== 'orbit') return;
      dist = Math.min(28, Math.max(5, dist * (1 + e.deltaY * 0.001)));
      lastInput = performance.now();
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });

    const resize = () => {
      const dprCap = window.innerWidth <= 480 ? 1 : 2;
      const dpr = Math.min(window.devicePixelRatio || 1, dprCap);
      const w = Math.round(canvas.clientWidth * dpr);
      const h = Math.round(canvas.clientHeight * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
    };

    const t0 = performance.now();
    const frame = (now) => {
      resize();
      const t = (now - t0) / 1000;

      if (mode === 'orbit' && !pointer.dragging && now - lastInput > 4000) {
        az += 0.0009;
      }

      let ab = 0;
      if (mode === 'falling') {
        const p = Math.min(1, (now - fallT0) / FALL_DUR_MS);
        dist = fallFrom + (0.6 - fallFrom) * (p ** 2.6);
        ab = Math.min(1, 1.3 * p * p);
        if (dist <= 1.0) mode = 'inside';
      } else if (mode === 'inside') {
        ab = 1;
        dist = 0.6;
      }

      gl.uniform2f(uniforms.uRes, canvas.width, canvas.height);
      gl.uniform1f(uniforms.uTime, t);
      gl.uniform1f(uniforms.uAz, az);
      gl.uniform1f(uniforms.uEl, el);
      gl.uniform1f(uniforms.uDist, dist);
      gl.uniform1f(uniforms.uAb, ab);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      animationRef.current = requestAnimationFrame(frame);
    };

    const textTimer = window.setTimeout(() => setShowText(true), 900);
    animationRef.current = requestAnimationFrame(frame);

    return () => {
      window.clearTimeout(textTimer);
      window.clearTimeout(fallTimer);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      gl.deleteBuffer(buf);
      gl.deleteProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
    };
  }, [phase, handleClose]);

  useEffect(() => {
    if (phase !== 'warp') {
      return undefined;
    }

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
        sharedAudioContextRef.current = audioContext;
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
            // The AudioContext is NOT closed here: it is handed off to the
            // backrooms phase and closed when the overlay unmounts.
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
  }, [phase]);

  return (
    <div
      className={`demoscene-overlay ${backroomsFlash && phase === 'warp' ? 'backrooms-flash' : ''}`}
    >
      {phase === 'backrooms' ? (
        <BackroomsDemo
          onClose={handleClose}
          audioContextRef={sharedAudioContextRef}
        />
      ) : (
        <>
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
              <span className="blink">[</span> DRAG TO ORBIT · ESC OR CLICK TO EXIT <span className="blink">]</span>
            </div>
            {audioBlocked && (
              <div className="demoscene-audio-note">
                AUDIO SYSTEM MUTED BY BROWSER
              </div>
            )}
          </div>

          <div className="demoscene-credits">
            <span>SCHWARZSCHILD</span>
            <span className="separator">///</span>
            <span>RAY TRACER 2026</span>
          </div>
        </>
      )}
    </div>
  );
}
