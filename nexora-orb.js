// ╔══════════════════════════════════════════════════════════════════════╗
// ║  NEXORA ORB — Unified Orchestration System                          ║
// ║  Single config drives: shader · springs · rings · audio · timeline  ║
// ╚══════════════════════════════════════════════════════════════════════╝

// ── 1. Master state config — every system reads from here ──────────────
const ORB_CONFIG = {
  idle: {
    colorA:        [0.05, 0.72, 1.00],
    colorB:        [0.00, 0.28, 0.75],
    scale:         1.00,
    motion:        0.20,   // auto-spin speed multiplier
    audioInfluence:0.12,   // how much audio moves the orb
    ringSpeed:     0.10,   // CSS ring animation speed multiplier
    hexScale:      8.0,
    flowDir:       [0.18, 0.12],  // energy flow direction in shader
    nodeCluster:   0.0,   // 0=scattered, 1=converged to center
    breatheAmp:    0.042, // idle breathing amplitude
    breatheSpeed:  0.55,
  },
  listening: {
    colorA:        [0.00, 0.95, 0.82],
    colorB:        [0.00, 0.50, 0.68],
    scale:         1.06,
    motion:        0.55,
    audioInfluence:1.00,
    ringSpeed:     0.80,
    hexScale:      9.0,
    flowDir:       [0.0, 0.0],   // outward radial during listening
    nodeCluster:   0.0,
    breatheAmp:    0.06,
    breatheSpeed:  1.2,
  },
  processing: {
    colorA:        [1.00, 0.62, 0.05],
    colorB:        [0.55, 0.22, 0.00],
    scale:         1.02,
    motion:        0.30,
    audioInfluence:0.00,
    ringSpeed:     0.50,
    hexScale:      7.5,
    flowDir:       [-0.08, -0.08], // inward flow while thinking
    nodeCluster:   0.75,  // nodes converge
    breatheAmp:    0.02,
    breatheSpeed:  0.8,
  },
  speaking: {
    colorA:        [0.30, 0.98, 0.22],
    colorB:        [0.08, 0.48, 0.04],
    scale:         1.05,
    motion:        0.65,
    audioInfluence:0.55,
    ringSpeed:     0.65,
    hexScale:      8.5,
    flowDir:       [0.25, 0.0],  // outward from center
    nodeCluster:   0.0,
    breatheAmp:    0.07,
    breatheSpeed:  1.5,
  },
  error: {
    colorA:        [1.00, 0.12, 0.28],
    colorB:        [0.48, 0.04, 0.10],
    scale:         0.96,
    motion:        0.10,
    audioInfluence:0.00,
    ringSpeed:     0.20,
    hexScale:      8.0,
    flowDir:       [0.0, 0.0],
    nodeCluster:   0.0,
    breatheAmp:    0.01,
    breatheSpeed:  0.3,
  },
};

function initNexoraOrb() {
  const container = document.getElementById('nexoraOrbContainer');
  const canvas    = document.getElementById('orbCanvas');
  if (!container || !canvas || !window.THREE) return;

  // ── Adaptive quality ────────────────────────────────────────
  const isLowEnd = (navigator.hardwareConcurrency || 4) < 4
                || /Android.*Mobile|iPhone|iPad/i.test(navigator.userAgent);
  const SPHERE_SEGMENTS = isLowEnd ? 40 : 64;
  const TARGET_FPS      = isLowEnd ? 30 : 60;
  const FRAME_MS        = 1000 / TARGET_FPS;

  // ── Renderer ────────────────────────────────────────────────
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !isLowEnd, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, isLowEnd ? 1 : 2));
  renderer.setClearColor(0x000000, 0);

  const scene  = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.z = 2.8;

  function resizeRenderer() {
    const s = container.offsetWidth;
    renderer.setSize(s, s, false);
    canvas.style.width  = s + 'px';
    canvas.style.height = s + 'px';
  }
  resizeRenderer();
  window.addEventListener('resize', resizeRenderer);

  // ── GLSL Vertex Shader ──────────────────────────────────────
  const vertexShader = `
    varying vec3 vNormal;
    varying vec3 vPosition;
    varying vec2 vUv;
    uniform float uCluster;   // 0=normal, 1=nodes pulled to center
    uniform float uBurst;
    uniform float uTime;
    void main() {
      vNormal   = normalize(normalMatrix * normal);
      vPosition = position;
      vUv       = uv;
      // Subtle vertex displacement on burst — surface ripple
      vec3 displaced = position;
      float ripple = sin(dot(position, vec3(1.0)) * 8.0 - uTime * 10.0) * uBurst * 0.04;
      displaced += normal * ripple;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
    }
  `;

  // ── GLSL Fragment Shader ────────────────────────────────────
  const fragmentShader = `
    precision highp float;

    uniform float uTime;
    uniform float uBass;
    uniform float uMid;
    uniform float uTreble;
    uniform float uBurst;
    uniform float uGlitch;
    uniform float uMotion;        // from config.motion
    uniform float uAudioInfl;     // from config.audioInfluence
    uniform float uHexScale;      // from config.hexScale
    uniform float uCluster;       // node convergence 0..1
    uniform float uBreath;        // current breathe value 0..1
    uniform vec2  uMouse;
    uniform vec2  uFlowDir;       // directional energy flow
    uniform vec2  uBurstOrigin;   // localised tap origin on sphere UV
    uniform vec3  uColorA;
    uniform vec3  uColorB;

    varying vec3 vNormal;
    varying vec3 vPosition;
    varying vec2 vUv;

    // ── Hex SDF ─────────────────────────────────────────────
    float hexDist(vec2 p) {
      p = abs(p);
      return max(dot(p, normalize(vec2(1.0, 1.732))), p.x);
    }
    vec2 hexCoords(vec2 uv, float scale) {
      uv *= scale;
      vec2 r = vec2(1.0, 1.732), h = r * 0.5;
      vec2 a = mod(uv,     r) - h;
      vec2 b = mod(uv - h, r) - h;
      return dot(a,a) < dot(b,b) ? a : b;
    }

    // ── Hash + smooth noise ──────────────────────────────────
    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }
    float noise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      f = f*f*(3.0-2.0*f);
      return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),
                 mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);
    }
    // FBM — 3 octaves for richer texture
    float fbm(vec2 p) {
      float v=0.0, a=0.5;
      for(int i=0;i<3;i++){ v+=a*noise(p); p*=2.1; a*=0.5; }
      return v;
    }

    void main() {
      // ── Fresnel ─────────────────────────────────────────────
      vec3 viewDir = normalize(vec3(uMouse * 0.25, 1.0));
      float fresnel = pow(1.0 - max(dot(vNormal, viewDir), 0.0), 3.2);

      // ── Spherical UV ─────────────────────────────────────────
      vec2 sUv = vec2(
        atan(vPosition.z, vPosition.x) / 6.28318 + 0.5,
        asin(clamp(vPosition.y,-1.0,1.0)) / 3.14159 + 0.5
      );

      // ── Directional energy flow ──────────────────────────────
      // Flow direction shifts per state (inward/outward/cursor)
      vec2 flowOffset = uFlowDir * uTime;
      // Cursor attraction — flow toward mouse when hovering
      vec2 cursorFlow = (uMouse * 0.5 + 0.5) - sUv;
      flowOffset += cursorFlow * 0.04 * uMotion;
      vec2 flowedUv = sUv + flowOffset;

      // ── Depth layers ─────────────────────────────────────────
      float depth = max(dot(vNormal, vec3(0,0,1)), 0.0);

      // Layer 1 — inner core slow pulse (deep glow)
      float core = smoothstep(0.0, 0.6, depth);
      float corePulse = 0.5 + 0.5 * sin(uTime * 0.8 + uBreath * 6.28);
      float innerGlow = core * corePulse * 0.4;

      // Layer 2 — hex grid (structure)
      float hexScale = uHexScale + uBass * uAudioInfl * 1.5;
      vec2  hc = hexCoords(flowedUv, hexScale);
      float hd = hexDist(hc);
      float hexEdge = 1.0 - smoothstep(0.42, 0.46, hd);

      // Layer 3 — nodes (intelligence points)
      // Cluster: lerp node position toward center when processing
      vec2 nodePos = mix(hc, hc * 0.3, uCluster);
      float nodeDist = length(nodePos);
      float nodeGlow = smoothstep(0.16, 0.0, nodeDist);
      // Per-node unique pulse — imperfection via hash
      float nodeId    = hash(floor(flowedUv * hexScale));
      // Tiny timing offset per node — feels alive, not mechanical
      float nodePhase = nodeId * 6.28 + nodeId * 0.37; // asymmetric offset
      float nodePulse = 0.35 + 0.65 * sin(uTime * (1.4 + nodeId * 0.6) + nodePhase);
      nodePulse      *= (1.0 + uMid * uAudioInfl * 1.4);
      // Occasional micro-flicker — imperfection
      float flicker = step(0.97, hash(vec2(nodeId, floor(uTime * 7.3))));
      nodePulse     = mix(nodePulse, nodePulse * 0.3, flicker * 0.6);
      nodeGlow      *= nodePulse;

      // Layer 4 — outer energy field (FBM noise)
      float field = fbm(flowedUv * 3.5 + vec2(uTime * 0.15));
      field = field * 0.5 + 0.5;

      // ── Light source follows mouse ────────────────────────────
      vec3 lightDir = normalize(vec3(uMouse.x*0.7-0.25, uMouse.y*0.7+0.25, 1.0));
      float specular = pow(max(dot(reflect(-lightDir, vNormal), viewDir), 0.0), 28.0);

      // ── Localised burst ripple from tap origin ────────────────
      float burstDist   = distance(sUv, uBurstOrigin);
      float burstRipple = sin(burstDist * 18.0 - uTime * 9.0) * 0.5 + 0.5;
      burstRipple      *= uBurst * smoothstep(0.8, 0.0, burstDist);

      // ── Signature heartbeat — unique rhythm ───────────────────
      // Double-pulse at 1.2s interval — like a heartbeat
      float hb = mod(uTime, 1.2);
      float beat = exp(-hb * 8.0) + 0.4 * exp(-(hb - 0.15) * 12.0);
      beat = clamp(beat, 0.0, 1.0) * 0.06;

      // ── Glitch scanlines ─────────────────────────────────────
      float glitchNoise = hash(vec2(floor(sUv.y * 22.0), floor(uTime * 28.0)));
      float glitch = step(0.88, glitchNoise) * uGlitch;

      // ── Compose — 4 layers + effects ─────────────────────────
      vec3 col = mix(uColorA * 0.55, uColorB, depth * 0.65 + uBass * uAudioInfl * 0.28);
      col *= (0.45 + 0.55 * field);                                    // field modulation
      col += uColorA * innerGlow;                                       // inner core
      col += uColorA * hexEdge * (0.30 + uMid * uAudioInfl * 0.38);   // hex lines
      col += vec3(0.82, 0.96, 1.0) * nodeGlow * 0.88;                  // nodes
      col += vec3(1.0) * specular * (0.28 + uTreble * uAudioInfl * 0.35); // specular
      col += uColorA * fresnel * (0.55 + uBass * uAudioInfl * 0.45);   // fresnel
      col += uColorB * burstRipple * 0.55;                              // burst
      col += uColorA * beat;                                            // heartbeat
      col += vec3(0.95, 0.18, 0.45) * glitch;                          // glitch

      float alpha = clamp(depth * 2.1 + 0.12 + fresnel * 0.45, 0.0, 1.0);
      alpha = mix(alpha, 1.0, uBass * uAudioInfl * 0.25);

      gl_FragColor = vec4(col, alpha);
    }
  `;

  // ── Geometry + Material ─────────────────────────────────────
  const geo = new THREE.SphereGeometry(1, SPHERE_SEGMENTS, SPHERE_SEGMENTS);
  const uniforms = {
    uTime:        { value: 0 },
    uBass:        { value: 0 },
    uMid:         { value: 0 },
    uTreble:      { value: 0 },
    uBurst:       { value: 0 },
    uGlitch:      { value: 0 },
    uMotion:      { value: 0.2 },
    uAudioInfl:   { value: 0.12 },
    uHexScale:    { value: 8.0 },
    uCluster:     { value: 0.0 },
    uBreath:      { value: 0.0 },
    uMouse:       { value: new THREE.Vector2(0, 0) },
    uFlowDir:     { value: new THREE.Vector2(0.18, 0.12) },
    uBurstOrigin: { value: new THREE.Vector2(0.5, 0.5) },
    uColorA:      { value: new THREE.Vector3(0.05, 0.72, 1.0) },
    uColorB:      { value: new THREE.Vector3(0.00, 0.28, 0.75) },
  };
  const mat = new THREE.ShaderMaterial({
    vertexShader, fragmentShader, uniforms,
    transparent: true, side: THREE.FrontSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  scene.add(mesh);

  // ── Spring physics ──────────────────────────────────────────
  function makeSpring(val, k = 7, d = 0.74) {
    return { value: val, target: val, vel: 0, k, d };
  }
  function stepSpring(sp, dt) {
    const f = (sp.target - sp.value) * sp.k;
    sp.vel   = sp.vel * sp.d + f * dt;
    sp.value += sp.vel * dt;
  }
  const springs = {
    scale:   makeSpring(1.0,  6,  0.72),
    rotX:    makeSpring(0.0,  4,  0.80),
    rotY:    makeSpring(0.0,  4,  0.80),
    colR:    makeSpring(0.05, 3,  0.86),
    colG:    makeSpring(0.72, 3,  0.86),
    colB:    makeSpring(1.0,  3,  0.86),
    motion:  makeSpring(0.2,  2,  0.90),
    cluster: makeSpring(0.0,  3,  0.82),
    hexSc:   makeSpring(8.0,  2,  0.88),
    breath:  makeSpring(0.0,  1.5,0.92),
  };

  // ── 2. Intelligent audio — smoothed, gated, event-detecting ─
  let analyser = null, freqData = null, audioCtx = null;
  // Smoothed levels with exponential decay
  const audio = { bass: 0, mid: 0, treble: 0, smoothBass: 0, smoothMid: 0, smoothTreble: 0 };
  // Speech event detection
  let speechActive = false, silenceFrames = 0;
  const SPEECH_THRESHOLD = 0.08;  // gate — ignore background noise below this
  const SILENCE_FRAMES   = 18;    // ~0.3s of silence = speech ended

  function initAudio() {
    if (analyser) return;
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.75; // browser-level smoothing
      freqData = new Uint8Array(analyser.frequencyBinCount);
      navigator.mediaDevices.getUserMedia({ audio: true, video: false })
        .then(stream => {
          audioCtx.createMediaStreamSource(stream).connect(analyser);
        }).catch(() => {});
    } catch(e) {}
  }

  function updateAudio(dt) {
    if (!analyser) { audio.bass = audio.mid = audio.treble = 0; return; }
    analyser.getByteFrequencyData(freqData);
    let rawBass = 0, rawMid = 0, rawTreble = 0;
    for (let i = 0;   i < 10;  i++) rawBass   += freqData[i];
    for (let i = 10;  i < 50;  i++) rawMid    += freqData[i];
    for (let i = 50;  i < 120; i++) rawTreble += freqData[i];
    rawBass   = Math.min(rawBass   / (10  * 255), 1);
    rawMid    = Math.min(rawMid    / (40  * 255), 1);
    rawTreble = Math.min(rawTreble / (70  * 255), 1);

    // Threshold gate — ignore noise floor
    rawBass   = rawBass   > SPEECH_THRESHOLD ? rawBass   : 0;
    rawMid    = rawMid    > SPEECH_THRESHOLD ? rawMid    : 0;
    rawTreble = rawTreble > SPEECH_THRESHOLD ? rawTreble : 0;

    // Exponential smoothing — fast attack, slow decay
    const atk = 1 - Math.exp(-dt * 18);  // ~55ms attack
    const rel = 1 - Math.exp(-dt * 4);   // ~250ms release
    const lerpBass = rawBass > audio.smoothBass ? atk : rel;
    audio.smoothBass   = audio.smoothBass   + (rawBass   - audio.smoothBass)   * lerpBass;
    audio.smoothMid    = audio.smoothMid    + (rawMid    - audio.smoothMid)    * rel;
    audio.smoothTreble = audio.smoothTreble + (rawTreble - audio.smoothTreble) * rel;
    audio.bass   = audio.smoothBass;
    audio.mid    = audio.smoothMid;
    audio.treble = audio.smoothTreble;

    // Speech event detection
    const energy = audio.bass + audio.mid;
    if (energy > SPEECH_THRESHOLD * 2) {
      silenceFrames = 0;
      if (!speechActive) {
        speechActive = true;
        _orbBurst(0.5, 0.5); // micro burst on speech start
      }
    } else {
      silenceFrames++;
      if (speechActive && silenceFrames > SILENCE_FRAMES) {
        speechActive = false;
        // Micro ripple on speech end
        uniforms.uBurst.value = Math.max(uniforms.uBurst.value, 0.35);
      }
    }
  }

  document.addEventListener('pointerdown', () => initAudio(), { once: true });

  // ── 3. CSS ring speed control ───────────────────────────────
  const rings = [
    document.querySelector('.orb-orbital-1'),
    document.querySelector('.orb-orbital-2'),
    document.querySelector('.orb-orbital-3'),
  ];
  const RING_BASE_DURATIONS = [7, 10, 5]; // seconds
  function updateRingSpeed(speedMult) {
    rings.forEach((r, i) => {
      if (r) r.style.animationDuration = (RING_BASE_DURATIONS[i] / Math.max(speedMult, 0.1)) + 's';
    });
  }

  // ── 4. Event spikes ─────────────────────────────────────────
  function _orbBurst(u = 0.5, v = 0.5) {
    uniforms.uBurstOrigin.value.set(u, v);
    uniforms.uBurst.value = 1.0;
  }
  function _orbGlitch() { uniforms.uGlitch.value = 1.0; }

  // Localised tap — raycast UV from pointer position
  canvas.addEventListener('pointerdown', e => {
    const r = canvas.getBoundingClientRect();
    const u = (e.clientX - r.left)  / r.width;
    const v = 1.0 - (e.clientY - r.top) / r.height;
    _orbBurst(u, v);
  });

  // ── 5. Temporal storytelling timelines ──────────────────────
  // Each timeline is a sequence of { delay, action } steps
  let timelineTimers = [];
  function clearTimelines() {
    timelineTimers.forEach(t => clearTimeout(t));
    timelineTimers = [];
  }
  function runTimeline(steps) {
    clearTimelines();
    steps.forEach(({ delay, action }) => {
      timelineTimers.push(setTimeout(action, delay));
    });
  }

  const TIMELINES = {
    listening: [
      { delay:   0, action: () => { springs.scale.target = 0.94; } },  // inhale — contract
      { delay: 120, action: () => { _orbBurst(0.5, 0.5); } },          // bright flash
      { delay: 180, action: () => { springs.scale.target = ORB_CONFIG.listening.scale; } }, // expand
      { delay: 280, action: () => { updateRingSpeed(ORB_CONFIG.listening.ringSpeed * 8); } }, // rings accelerate
    ],
    processing: [
      { delay:   0, action: () => { springs.cluster.target = 0.75; } }, // nodes converge
      { delay: 200, action: () => { springs.scale.target = 1.01; } },   // slight contract
    ],
    speaking: [
      { delay:   0, action: () => { springs.cluster.target = 0.0; } },  // nodes release
      { delay:  80, action: () => { springs.scale.target = ORB_CONFIG.speaking.scale; } },
      { delay: 160, action: () => { _orbBurst(0.5, 0.5); } },           // energy release
    ],
    idle: [
      { delay:   0, action: () => { springs.cluster.target = 0.0; } },
      { delay: 100, action: () => { updateRingSpeed(ORB_CONFIG.idle.ringSpeed * 8); } },
    ],
    error: [
      { delay:   0, action: () => { _orbGlitch(); } },
      { delay: 120, action: () => { _orbGlitch(); } },
      { delay: 280, action: () => { _orbGlitch(); } },
    ],
  };

  // ── 6. State setter — single source of truth ────────────────
  let currentState = 'idle';
  window._nexoraOrbState = function(state) {
    if (state === currentState) return;
    currentState = state;
    const cfg = ORB_CONFIG[state] || ORB_CONFIG.idle;

    // Springs — color, scale, motion, hex scale
    springs.colR.target   = cfg.colorA[0];
    springs.colG.target   = cfg.colorA[1];
    springs.colB.target   = cfg.colorA[2];
    springs.scale.target  = cfg.scale;
    springs.motion.target = cfg.motion;
    springs.hexSc.target  = cfg.hexScale;

    // ColorB — instant (secondary, less visible)
    uniforms.uColorB.value.set(cfg.colorB[0], cfg.colorB[1], cfg.colorB[2]);

    // Flow direction
    uniforms.uFlowDir.value.set(cfg.flowDir[0], cfg.flowDir[1]);

    // Audio influence — spring toward new value
    uniforms.uAudioInfl.value = cfg.audioInfluence;

    // Run temporal timeline for this state
    if (TIMELINES[state]) runTimeline(TIMELINES[state]);
  };

  // ── Mouse parallax ──────────────────────────────────────────
  const mouse = { x: 0, y: 0 };
  container.addEventListener('pointermove', e => {
    const r = container.getBoundingClientRect();
    mouse.x = ((e.clientX - r.left) / r.width  - 0.5) * 2;
    mouse.y = ((e.clientY - r.top)  / r.height - 0.5) * -2;
    springs.rotY.target = mouse.x * 0.32;
    springs.rotX.target = mouse.y * 0.22;
  });
  container.addEventListener('pointerleave', () => {
    springs.rotX.target = 0;
    springs.rotY.target = 0;
  });

  // ── Animation loop ───────────────────────────────────────────
  let lastTime = 0, rafId = null, lastFrameTime = 0;

  function animate(now) {
    rafId = requestAnimationFrame(animate);

    // FPS cap for low-end devices
    if (isLowEnd && now - lastFrameTime < FRAME_MS) return;
    lastFrameTime = now;

    const dt = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;

    // Step all springs
    Object.values(springs).forEach(sp => stepSpring(sp, dt));

    // Update audio
    updateAudio(dt);

    // Breathing — driven by config breatheAmp/Speed
    const cfg = ORB_CONFIG[currentState] || ORB_CONFIG.idle;
    const breatheVal = 0.5 + 0.5 * Math.sin(now * 0.001 * cfg.breatheSpeed);
    springs.breath.target = breatheVal;
    stepSpring(springs.breath, dt);

    const breatheScale = 1.0 + cfg.breatheAmp * springs.breath.value;

    // Apply to mesh
    const audioScale = 1 + audio.bass * uniforms.uAudioInfl.value * 0.09;
    mesh.scale.setScalar(springs.scale.value * breatheScale * audioScale);
    mesh.rotation.x  = springs.rotX.value;
    mesh.rotation.y  = springs.rotY.value + now * 0.0002 * springs.motion.value;

    // Update uniforms
    uniforms.uTime.value     = now * 0.001;
    uniforms.uBass.value     = audio.bass;
    uniforms.uMid.value      = audio.mid;
    uniforms.uTreble.value   = audio.treble;
    uniforms.uMotion.value   = springs.motion.value;
    uniforms.uHexScale.value = springs.hexSc.value;
    uniforms.uCluster.value  = springs.cluster.value;
    uniforms.uBreath.value   = springs.breath.value;
    uniforms.uMouse.value.set(mouse.x, mouse.y);
    uniforms.uColorA.value.set(springs.colR.value, springs.colG.value, springs.colB.value);

    // Decay burst + glitch
    uniforms.uBurst.value  = Math.max(0, uniforms.uBurst.value  - dt * 2.2);
    uniforms.uGlitch.value = Math.max(0, uniforms.uGlitch.value - dt * 1.6);

    // Update ring speed from motion spring
    updateRingSpeed(springs.motion.value * 8);

    renderer.render(scene, camera);
  }

  // ── Visibility management ────────────────────────────────────
  const nameScreen = document.getElementById('nameScreen');
  new MutationObserver(() => {
    if (nameScreen && nameScreen.classList.contains('active')) {
      if (!rafId) { lastTime = performance.now(); rafId = requestAnimationFrame(animate); }
    } else {
      if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    }
  }).observe(nameScreen || document.body, { attributes: true, attributeFilter: ['class'] });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    } else if (nameScreen && nameScreen.classList.contains('active')) {
      lastTime = performance.now();
      rafId = requestAnimationFrame(animate);
    }
  });

  if (nameScreen && nameScreen.classList.contains('active')) {
    lastTime = performance.now();
    rafId = requestAnimationFrame(animate);
  }
}
