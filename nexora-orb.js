// ╔══════════════════════════════════════════════════════════════════════╗
// ║  NEXORA ORB v3 — Semantic Visual Intelligence System                ║
// ║                                                                      ║
// ║  Principle: every visual maps to cognition, not just state.         ║
// ║  The orb reflects HOW it thinks, not just WHAT it's doing.          ║
// ║                                                                      ║
// ║  Architecture:                                                       ║
// ║   · Behavior engine (tension/coherence/energy) drives everything    ║
// ║   · Shader: SSS + chromatic aberration + node paths + attention     ║
// ║   · Memory: residual energy from previous state lingers             ║
// ║   · Ignition: first-activation sequence                             ║
// ║   · Gyro: tilt-based parallax on mobile                             ║
// ╚══════════════════════════════════════════════════════════════════════╝

// ── Master state config ────────────────────────────────────────────────
const ORB_CONFIG = {
  idle: {
    colorA: [0.05, 0.72, 1.00], colorB: [0.00, 0.28, 0.75],
    scale: 1.00, motion: 0.20, audioInfluence: 0.12, ringSpeed: 0.10,
    hexScale: 8.0, flowDir: [0.18, 0.12], nodeCluster: 0.0,
    breatheAmp: 0.042, breatheSpeed: 0.55,
    // Behavior engine targets
    tension: 0.05, coherence: 0.85, energy: 0.30,
  },
  listening: {
    colorA: [0.00, 0.95, 0.82], colorB: [0.00, 0.50, 0.68],
    scale: 1.06, motion: 0.55, audioInfluence: 1.00, ringSpeed: 0.80,
    hexScale: 9.0, flowDir: [0.0, 0.0], nodeCluster: 0.0,
    breatheAmp: 0.06, breatheSpeed: 1.2,
    tension: 0.15, coherence: 0.70, energy: 0.75,
  },
  processing: {
    colorA: [1.00, 0.62, 0.05], colorB: [0.55, 0.22, 0.00],
    scale: 1.02, motion: 0.30, audioInfluence: 0.00, ringSpeed: 0.50,
    hexScale: 7.5, flowDir: [-0.08, -0.08], nodeCluster: 0.75,
    breatheAmp: 0.02, breatheSpeed: 0.8,
    tension: 0.60, coherence: 0.40, energy: 0.55,
  },
  speaking: {
    colorA: [0.30, 0.98, 0.22], colorB: [0.08, 0.48, 0.04],
    scale: 1.05, motion: 0.65, audioInfluence: 0.55, ringSpeed: 0.65,
    hexScale: 8.5, flowDir: [0.25, 0.0], nodeCluster: 0.0,
    breatheAmp: 0.07, breatheSpeed: 1.5,
    tension: 0.10, coherence: 0.90, energy: 0.85,
  },
  error: {
    colorA: [1.00, 0.12, 0.28], colorB: [0.48, 0.04, 0.10],
    scale: 0.96, motion: 0.10, audioInfluence: 0.00, ringSpeed: 0.20,
    hexScale: 8.0, flowDir: [0.0, 0.0], nodeCluster: 0.0,
    breatheAmp: 0.01, breatheSpeed: 0.3,
    tension: 0.90, coherence: 0.15, energy: 0.40,
  },
};

function initNexoraOrb() {
  const container = document.getElementById('nexoraOrbContainer');
  const canvas    = document.getElementById('orbCanvas');
  if (!container || !canvas || !window.THREE) return;

  // ── Adaptive quality ────────────────────────────────────────
  const isLowEnd = (navigator.hardwareConcurrency || 4) < 4
                || /Android.*Mobile|iPhone|iPad/i.test(navigator.userAgent);
  const SEG      = isLowEnd ? 40 : 64;
  const FRAME_MS = isLowEnd ? 1000 / 30 : 0;

  // ── Renderer ────────────────────────────────────────────────
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !isLowEnd, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, isLowEnd ? 1 : 2));
  renderer.setClearColor(0x000000, 0);
  const scene  = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.z = 2.8;

  function resize() {
    const s = container.offsetWidth;
    renderer.setSize(s, s, false);
    canvas.style.width = canvas.style.height = s + 'px';
  }
  resize();
  window.addEventListener('resize', resize);

  // ── Vertex shader — surface ripple on burst ─────────────────
  const vertexShader = `
    varying vec3 vNormal;
    varying vec3 vPosition;
    varying vec2 vUv;
    uniform float uBurst;
    uniform float uTime;
    void main() {
      vNormal   = normalize(normalMatrix * normal);
      vPosition = position;
      vUv       = uv;
      vec3 pos  = position;
      float ripple = sin(dot(position, vec3(1.0)) * 8.0 - uTime * 10.0) * uBurst * 0.035;
      pos += normal * ripple;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
    }
  `;

  // ── Fragment shader — full semantic visual system ────────────
  const fragmentShader = `
    precision highp float;

    // ── Uniforms ─────────────────────────────────────────────
    uniform float uTime;
    uniform float uBass, uMid, uTreble;
    uniform float uBurst, uGlitch;
    uniform float uMotion, uAudioInfl, uHexScale;
    uniform float uCluster;       // node convergence 0..1
    uniform float uBreath;
    // Behavior engine — maps to cognition
    uniform float uTension;       // 0=calm, 1=struggling
    uniform float uCoherence;     // 0=scattered, 1=confident
    uniform float uEnergy;        // 0=dormant, 1=active
    // Memory residual from previous state
    uniform float uMemory;        // 0..1 lingering energy
    uniform vec3  uMemoryColor;   // color of previous state
    // Attention — where the orb is "looking"
    uniform vec2  uAttention;     // UV focus point
    uniform float uAttentionStr;  // 0..1 strength
    // Node paths — neuron firing
    uniform float uPathPhase;     // 0..1 path animation
    uniform vec2  uMouse;
    uniform vec2  uFlowDir;
    uniform vec2  uBurstOrigin;
    uniform vec3  uColorA, uColorB;
    // Ignition
    uniform float uIgnition;      // 0..1 first-activation sweep

    varying vec3 vNormal;
    varying vec3 vPosition;
    varying vec2 vUv;

    // ── Utilities ────────────────────────────────────────────
    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }
    float hash1(float n) { return fract(sin(n) * 43758.5453); }
    float noise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      f = f*f*(3.0-2.0*f);
      return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),
                 mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);
    }
    float fbm(vec2 p) {
      float v=0.0,a=0.5;
      for(int i=0;i<3;i++){v+=a*noise(p);p*=2.1;a*=0.5;}
      return v;
    }
    float hexDist(vec2 p) {
      p=abs(p); return max(dot(p,normalize(vec2(1.0,1.732))),p.x);
    }
    vec2 hexCoords(vec2 uv, float scale) {
      uv*=scale;
      vec2 r=vec2(1.0,1.732),h=r*0.5;
      vec2 a=mod(uv,r)-h, b=mod(uv-h,r)-h;
      return dot(a,a)<dot(b,b)?a:b;
    }

    void main() {
      // ── Geometry ─────────────────────────────────────────
      vec3 viewDir = normalize(vec3(uMouse*0.22, 1.0));
      float depth  = max(dot(vNormal, vec3(0,0,1)), 0.0);
      float fresnel= pow(1.0 - max(dot(vNormal, viewDir), 0.0), 3.0);

      // Spherical UV
      vec2 sUv = vec2(
        atan(vPosition.z, vPosition.x)/6.28318 + 0.5,
        asin(clamp(vPosition.y,-1.0,1.0))/3.14159 + 0.5
      );

      // ── Directional flow + attention ─────────────────────
      vec2 flowOffset = uFlowDir * uTime;
      // Cursor/attention attraction
      vec2 attentionPull = (uAttention - sUv) * uAttentionStr * 0.06;
      flowOffset += attentionPull;
      // Tension adds turbulence to flow
      float turbulence = noise(sUv * 6.0 + uTime * 0.4) * uTension * 0.04;
      flowOffset += vec2(turbulence, -turbulence);
      vec2 flowedUv = sUv + flowOffset;

      // ── Layer 1: Inner core — subsurface scattering approx ─
      // SSS: light scatters through the sphere, brighter at thin edges
      float sss = pow(1.0 - depth, 2.2) * 0.5;
      float corePulse = 0.5 + 0.5 * sin(uTime * 0.75 + uBreath * 6.28);
      // Coherence drives core stability — confident = steady glow
      float coreStability = mix(corePulse * (0.7 + noise(sUv*2.0+uTime*0.3)*0.6),
                                corePulse, uCoherence);
      vec3 coreColor = mix(uColorB * 1.4, uColorA * 0.9, depth);
      float innerGlow = (smoothstep(0.0, 0.55, depth) * coreStability * 0.38)
                      + sss * uEnergy * 0.3;

      // ── Layer 2: Hex grid ─────────────────────────────────
      float hexScale = uHexScale + uBass * uAudioInfl * 1.4;
      vec2  hc = hexCoords(flowedUv, hexScale);
      float hd = hexDist(hc);
      float hexEdge = 1.0 - smoothstep(0.41, 0.455, hd);
      // Tension makes hex lines jitter slightly
      float hexJitter = noise(hc * 8.0 + uTime * 3.0) * uTension * 0.08;
      hexEdge = clamp(hexEdge + hexJitter, 0.0, 1.0);

      // ── Layer 3: Nodes — distributed intelligence ─────────
      vec2 nodePos = mix(hc, hc * 0.28, uCluster);
      float nodeId = hash(floor(flowedUv * hexScale));
      // Asymmetric per-node timing — imperfection
      float nodePhase = nodeId * 6.28 + nodeId * 0.41 + hash1(nodeId * 7.3) * 1.2;
      float nodePulse = 0.32 + 0.68 * sin(uTime * (1.3 + nodeId * 0.65) + nodePhase);
      nodePulse *= (1.0 + uMid * uAudioInfl * 1.3);
      // Tension = uneven pulses (struggling)
      float unevenness = noise(vec2(nodeId * 4.1, uTime * 2.2)) * uTension;
      nodePulse = mix(nodePulse, nodePulse * (0.4 + unevenness), uTension * 0.5);
      // Micro-flicker — imperfection
      float flicker = step(0.965, hash(vec2(nodeId, floor(uTime * 6.8))));
      nodePulse = mix(nodePulse, nodePulse * 0.25, flicker * 0.55);
      float nodeGlow = smoothstep(0.15, 0.0, length(nodePos)) * nodePulse;

      // ── Node connection paths — neuron firing ─────────────
      // Short-lived lines between nearby nodes during processing
      float pathActive = uCluster * (0.5 + 0.5 * sin(uPathPhase * 6.28));
      // Approximate path as thin band between two hash-derived points
      vec2 pathA = vec2(hash(floor(flowedUv * hexScale)),
                        hash(floor(flowedUv * hexScale + vec2(1.7, 2.3))));
      vec2 pathB = vec2(hash(floor(flowedUv * hexScale + vec2(3.1, 0.9))),
                        hash(floor(flowedUv * hexScale + vec2(0.5, 4.1))));
      float pathDist = abs(dot(normalize(pathB - pathA), hc - pathA));
      float pathGlow = smoothstep(0.08, 0.0, pathDist)
                     * pathActive
                     * step(length(pathA - pathB), 0.6); // only short connections
      pathGlow *= 0.5 + 0.5 * sin(uTime * 4.0 + nodeId * 3.14);

      // ── Layer 4: Energy field ─────────────────────────────
      float field = fbm(flowedUv * 3.2 + vec2(uTime * 0.14));
      field = field * 0.5 + 0.5;
      // Energy level modulates field intensity
      field = mix(field * 0.6, field, uEnergy);

      // ── Lighting ─────────────────────────────────────────
      vec3 lightDir = normalize(vec3(uMouse.x*0.65-0.22, uMouse.y*0.65+0.22, 1.0));
      // View-dependent specular shift — coherence drives sharpness
      float specPow = mix(12.0, 38.0, uCoherence);
      float specular = pow(max(dot(reflect(-lightDir, vNormal), viewDir), 0.0), specPow);
      // Chromatic aberration on edges — subtle, only at low coherence
      float aberration = fresnel * (1.0 - uCoherence) * 0.04;

      // ── Burst ripple — localised ──────────────────────────
      float burstDist   = distance(sUv, uBurstOrigin);
      float burstRipple = sin(burstDist * 16.0 - uTime * 8.5) * 0.5 + 0.5;
      burstRipple      *= uBurst * smoothstep(0.75, 0.0, burstDist);

      // ── Memory residual — previous state lingers ──────────
      float memoryGlow = uMemory * (0.5 + 0.5 * sin(uTime * 1.1)) * depth * 0.25;

      // ── Signature heartbeat — double-pulse ────────────────
      float hb   = mod(uTime, 1.2);
      float beat = (exp(-hb * 8.0) + 0.38 * exp(-(hb - 0.14) * 11.0))
                 * uCoherence * 0.055; // only beats when coherent

      // ── Ignition sweep — first activation ─────────────────
      float ignitionLine = smoothstep(0.04, 0.0, abs(depth - uIgnition));
      float ignitionGlow = ignitionLine * uIgnition * (1.0 - uIgnition) * 4.0;

      // ── Glitch ────────────────────────────────────────────
      float glitchN = hash(vec2(floor(sUv.y * 20.0), floor(uTime * 26.0)));
      float glitch  = step(0.87, glitchN) * uGlitch;

      // ── Compose ───────────────────────────────────────────
      // Base: depth-blended A→B, modulated by energy field
      vec3 col = mix(uColorA * 0.52, uColorB, depth * 0.62 + uBass * uAudioInfl * 0.25);
      col *= (0.42 + 0.58 * field);

      // Chromatic aberration: R channel shifts slightly on edges
      float rShift = noise(sUv + vec2(aberration, 0.0));
      col.r = mix(col.r, col.r * (0.9 + rShift * 0.2), aberration * 8.0);

      col += coreColor * innerGlow;                                        // SSS core
      col += uColorA * hexEdge * (0.28 + uMid * uAudioInfl * 0.35);       // hex lines
      col += vec3(0.80, 0.95, 1.0) * nodeGlow * 0.85;                     // nodes
      col += uColorA * pathGlow * 0.7;                                     // node paths
      col += vec3(1.0) * specular * (0.26 + uTreble * uAudioInfl * 0.32); // specular
      col += uColorA * fresnel * (0.50 + uBass * uAudioInfl * 0.40);      // fresnel
      col += uColorB * burstRipple * 0.50;                                 // burst
      col += uMemoryColor * memoryGlow;                                    // memory
      col += uColorA * beat;                                               // heartbeat
      col += vec3(1.0, 0.95, 0.6) * ignitionGlow;                         // ignition
      col += vec3(0.95, 0.18, 0.45) * glitch;                             // glitch

      float alpha = clamp(depth * 2.0 + 0.10 + fresnel * 0.42, 0.0, 1.0);
      alpha = mix(alpha, 1.0, uBass * uAudioInfl * 0.22);

      gl_FragColor = vec4(col, alpha);
    }
  `;

  // ── Geometry + Material ─────────────────────────────────────
  const geo = new THREE.SphereGeometry(1, SEG, SEG);
  const uniforms = {
    uTime:        { value: 0 },
    uBass:        { value: 0 }, uMid: { value: 0 }, uTreble: { value: 0 },
    uBurst:       { value: 0 }, uGlitch: { value: 0 },
    uMotion:      { value: 0.2 }, uAudioInfl: { value: 0.12 },
    uHexScale:    { value: 8.0 }, uCluster: { value: 0.0 }, uBreath: { value: 0.0 },
    // Behavior engine
    uTension:     { value: 0.05 },
    uCoherence:   { value: 0.85 },
    uEnergy:      { value: 0.30 },
    // Memory
    uMemory:      { value: 0.0 },
    uMemoryColor: { value: new THREE.Vector3(0.05, 0.72, 1.0) },
    // Attention
    uAttention:   { value: new THREE.Vector2(0.5, 0.5) },
    uAttentionStr:{ value: 0.0 },
    // Node paths
    uPathPhase:   { value: 0.0 },
    // Other
    uMouse:       { value: new THREE.Vector2(0, 0) },
    uFlowDir:     { value: new THREE.Vector2(0.18, 0.12) },
    uBurstOrigin: { value: new THREE.Vector2(0.5, 0.5) },
    uColorA:      { value: new THREE.Vector3(0.05, 0.72, 1.0) },
    uColorB:      { value: new THREE.Vector3(0.00, 0.28, 0.75) },
    uIgnition:    { value: 0.0 },
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
    scale:     makeSpring(1.0,  6,   0.72),
    rotX:      makeSpring(0.0,  4,   0.80),
    rotY:      makeSpring(0.0,  4,   0.80),
    colR:      makeSpring(0.05, 3,   0.86),
    colG:      makeSpring(0.72, 3,   0.86),
    colB:      makeSpring(1.0,  3,   0.86),
    motion:    makeSpring(0.2,  2,   0.90),
    cluster:   makeSpring(0.0,  3,   0.82),
    hexSc:     makeSpring(8.0,  2,   0.88),
    breath:    makeSpring(0.0,  1.5, 0.92),
    tension:   makeSpring(0.05, 2.5, 0.88),
    coherence: makeSpring(0.85, 2.5, 0.88),
    energy:    makeSpring(0.30, 2.5, 0.88),
    memory:    makeSpring(0.0,  1.2, 0.94), // slow decay — lingers
    attStr:    makeSpring(0.0,  3,   0.82),
  };

  // ── Behavior engine — continuous, not scripted ──────────────
  // Instead of timelines, we set behavior targets and springs
  // interpolate continuously. Everything emerges from these 3 values.
  function setBehavior(t, c, e) {
    springs.tension.target   = Math.max(0, Math.min(1, t));
    springs.coherence.target = Math.max(0, Math.min(1, c));
    springs.energy.target    = Math.max(0, Math.min(1, e));
  }

  // ── Cognitive modulation — maps AI context to behavior ──────
  // Called from outside with semantic hints about the AI's state
  window._nexoraOrbCognition = function({ latency, confidence, complexity, emotion } = {}) {
    // latency (ms) → tension: long wait = more tension
    if (latency !== undefined) {
      const t = Math.min(latency / 4000, 1.0); // 4s = max tension
      springs.tension.target = Math.max(springs.tension.target, t * 0.8);
    }
    // confidence (0..1) → coherence + energy
    if (confidence !== undefined) {
      springs.coherence.target = 0.3 + confidence * 0.65;
      springs.energy.target    = 0.4 + confidence * 0.5;
    }
    // complexity (0..1) → cluster + tension
    if (complexity !== undefined) {
      springs.cluster.target = complexity * 0.6;
      springs.tension.target = Math.max(springs.tension.target, complexity * 0.4);
    }
    // emotion string → color tint (subtle, doesn't override state color)
    if (emotion === 'calm')    springs.energy.target  = Math.min(springs.energy.target, 0.4);
    if (emotion === 'curious') springs.tension.target = Math.max(springs.tension.target, 0.2);
  };

  // ── Memory system — residual from previous state ────────────
  let prevColorA = [0.05, 0.72, 1.0];
  function captureMemory() {
    prevColorA = [springs.colR.value, springs.colG.value, springs.colB.value];
    uniforms.uMemoryColor.value.set(prevColorA[0], prevColorA[1], prevColorA[2]);
    springs.memory.target = 0.6; // inject residual energy
    // Memory decays naturally via spring
    setTimeout(() => { springs.memory.target = 0.0; }, 800);
  }

  // ── Intelligent audio ───────────────────────────────────────
  let analyser = null, freqData = null, audioCtx = null;
  const audio = { bass: 0, mid: 0, treble: 0, sb: 0, sm: 0, st: 0 };
  let speechActive = false, silenceFrames = 0;
  const GATE = 0.08, SILENCE_F = 18;

  function initAudio() {
    if (analyser) return;
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.75;
      freqData = new Uint8Array(analyser.frequencyBinCount);
      navigator.mediaDevices.getUserMedia({ audio: true, video: false })
        .then(s => audioCtx.createMediaStreamSource(s).connect(analyser))
        .catch(() => {});
    } catch(e) {}
  }

  function updateAudio(dt) {
    if (!analyser) { audio.bass = audio.mid = audio.treble = 0; return; }
    analyser.getByteFrequencyData(freqData);
    let rb = 0, rm = 0, rt = 0;
    for (let i = 0;  i < 10;  i++) rb += freqData[i];
    for (let i = 10; i < 50;  i++) rm += freqData[i];
    for (let i = 50; i < 120; i++) rt += freqData[i];
    rb = Math.min(rb / (10*255), 1); rm = Math.min(rm / (40*255), 1); rt = Math.min(rt / (70*255), 1);
    rb = rb > GATE ? rb : 0; rm = rm > GATE ? rm : 0; rt = rt > GATE ? rt : 0;
    const atk = 1 - Math.exp(-dt * 18), rel = 1 - Math.exp(-dt * 4);
    audio.sb = audio.sb + (rb - audio.sb) * (rb > audio.sb ? atk : rel);
    audio.sm = audio.sm + (rm - audio.sm) * rel;
    audio.st = audio.st + (rt - audio.st) * rel;
    audio.bass = audio.sb; audio.mid = audio.sm; audio.treble = audio.st;
    const energy = audio.bass + audio.mid;
    if (energy > GATE * 2) {
      silenceFrames = 0;
      if (!speechActive) { speechActive = true; _orbBurst(0.5, 0.5); }
    } else {
      if (++silenceFrames > SILENCE_F && speechActive) {
        speechActive = false;
        uniforms.uBurst.value = Math.max(uniforms.uBurst.value, 0.3);
      }
    }
  }
  document.addEventListener('pointerdown', () => initAudio(), { once: true });

  // ── CSS ring speed ──────────────────────────────────────────
  const rings = [
    document.querySelector('.orb-orbital-1'),
    document.querySelector('.orb-orbital-2'),
    document.querySelector('.orb-orbital-3'),
  ];
  const RING_BASE = [7, 10, 5];
  function updateRings(speedMult) {
    rings.forEach((r, i) => {
      if (r) r.style.animationDuration = (RING_BASE[i] / Math.max(speedMult, 0.05)) + 's';
    });
  }

  // ── Event spikes ────────────────────────────────────────────
  function _orbBurst(u = 0.5, v = 0.5) {
    uniforms.uBurstOrigin.value.set(u, v);
    uniforms.uBurst.value = 1.0;
  }
  function _orbGlitch() { uniforms.uGlitch.value = 1.0; }
  canvas.addEventListener('pointerdown', e => {
    const r = canvas.getBoundingClientRect();
    _orbBurst((e.clientX - r.left) / r.width, 1 - (e.clientY - r.top) / r.height);
  });

  // ── Ignition sequence — first activation ────────────────────
  let ignitionDone = false;
  function runIgnition() {
    if (ignitionDone) return;
    ignitionDone = true;
    let t = 0;
    const dur = 1.8; // seconds
    function step() {
      t += 0.016;
      const p = Math.min(t / dur, 1.0);
      // Sweep from 0→1 (bottom to top of sphere)
      uniforms.uIgnition.value = p < 0.85 ? p / 0.85 : 1.0 - (p - 0.85) / 0.15;
      if (p < 1.0) requestAnimationFrame(step);
      else uniforms.uIgnition.value = 0.0;
    }
    // Brief scale pulse during ignition
    springs.scale.target = 0.88;
    setTimeout(() => { springs.scale.target = 1.08; }, 400);
    setTimeout(() => { springs.scale.target = ORB_CONFIG.idle.scale; }, 900);
    requestAnimationFrame(step);
  }

  // ── Attention system ────────────────────────────────────────
  // Attention shifts based on state and cursor
  function updateAttention(state, mx, my) {
    if (state === 'processing') {
      // Attention disperses — no strong focus
      springs.attStr.target = 0.1;
      uniforms.uAttention.value.set(0.5, 0.5);
    } else if (state === 'listening' || state === 'speaking') {
      // Attention at center — focused on user
      springs.attStr.target = 0.6;
      uniforms.uAttention.value.set(0.5, 0.5);
    } else {
      // Idle — attention follows cursor subtly
      springs.attStr.target = 0.25;
      uniforms.uAttention.value.set(mx * 0.5 + 0.5, my * 0.5 + 0.5);
    }
  }

  // ── State setter — single source of truth ───────────────────
  let currentState = 'idle';
  window._nexoraOrbState = function(state) {
    if (state === currentState) return;
    captureMemory(); // snapshot current color before transition
    currentState = state;
    const cfg = ORB_CONFIG[state] || ORB_CONFIG.idle;

    // Color springs
    springs.colR.target = cfg.colorA[0];
    springs.colG.target = cfg.colorA[1];
    springs.colB.target = cfg.colorA[2];
    uniforms.uColorB.value.set(cfg.colorB[0], cfg.colorB[1], cfg.colorB[2]);

    // Motion springs
    springs.scale.target  = cfg.scale;
    springs.motion.target = cfg.motion;
    springs.hexSc.target  = cfg.hexScale;

    // Flow
    uniforms.uFlowDir.value.set(cfg.flowDir[0], cfg.flowDir[1]);
    uniforms.uAudioInfl.value = cfg.audioInfluence;

    // Behavior engine — set targets, springs do the rest
    setBehavior(cfg.tension, cfg.coherence, cfg.energy);

    // State-specific behavior
    if (state === 'listening') {
      springs.cluster.target = 0.0;
      springs.scale.target   = 0.93; // inhale
      setTimeout(() => {
        _orbBurst(0.5, 0.5);
        springs.scale.target = cfg.scale; // exhale
      }, 130);
    } else if (state === 'processing') {
      springs.cluster.target = 0.75; // nodes converge
    } else if (state === 'speaking') {
      springs.cluster.target = 0.0;  // nodes release
      setTimeout(() => _orbBurst(0.5, 0.5), 80);
    } else if (state === 'error') {
      springs.cluster.target = 0.0;
      setTimeout(() => _orbGlitch(), 0);
      setTimeout(() => _orbGlitch(), 140);
      setTimeout(() => _orbGlitch(), 320);
    } else {
      springs.cluster.target = 0.0;
    }
  };

  // ── Sleep drift — signature behavior after prolonged idle ───
  // After 8s of idle, the orb enters a slow dreamy drift.
  // Any state change wakes it immediately.
  let _sleepTimer = null;
  let _isSleeping = false;

  function _enterSleep() {
    if (_isSleeping || currentState !== 'idle') return;
    _isSleeping = true;
    // Gently reduce energy + motion — orb breathes slower, drifts
    springs.energy.target   = 0.10;
    springs.motion.target   = 0.08;
    springs.coherence.target = 0.60;
    springs.hexSc.target    = 7.2;
    // Slight cool color shift — deeper blue, like resting
    springs.colR.target = 0.02;
    springs.colG.target = 0.45;
    springs.colB.target = 0.90;
  }

  function _exitSleep() {
    if (!_isSleeping) return;
    _isSleeping = false;
    // Restore idle config
    const cfg = ORB_CONFIG.idle;
    springs.colR.target = cfg.colorA[0];
    springs.colG.target = cfg.colorA[1];
    springs.colB.target = cfg.colorA[2];
    springs.energy.target    = cfg.energy;
    springs.motion.target    = cfg.motion;
    springs.coherence.target = cfg.coherence;
    springs.hexSc.target     = cfg.hexScale;
  }

  function _resetSleepTimer() {
    if (_sleepTimer) clearTimeout(_sleepTimer);
    if (_isSleeping) _exitSleep();
    _sleepTimer = setTimeout(_enterSleep, 8000); // 8s idle → sleep
  }

  // Patch state setter to reset sleep on any state change
  const _origOrbState = window._nexoraOrbState;
  window._nexoraOrbState = function(state) {
    _resetSleepTimer();
    _origOrbState(state);
  };

  // Also wake on mouse interaction
  container.addEventListener('pointermove', _resetSleepTimer, { passive: true });
  container.addEventListener('pointerdown', _resetSleepTimer, { passive: true });

  // Start sleep timer on load
  _resetSleepTimer();

  // ── Mouse parallax ──────────────────────────────────────────
  const mouse = { x: 0, y: 0 };
  container.addEventListener('pointermove', e => {
    const r = container.getBoundingClientRect();
    mouse.x = ((e.clientX - r.left) / r.width  - 0.5) * 2;
    mouse.y = ((e.clientY - r.top)  / r.height - 0.5) * -2;
    springs.rotY.target = mouse.x * 0.30;
    springs.rotX.target = mouse.y * 0.20;
  });
  container.addEventListener('pointerleave', () => {
    springs.rotX.target = springs.rotY.target = 0;
  });

  // ── Gyroscope — mobile tilt parallax ────────────────────────
  if (isLowEnd && window.DeviceOrientationEvent) {
    window.addEventListener('deviceorientation', e => {
      if (e.gamma == null) return;
      const gx = Math.max(-30, Math.min(30, e.gamma)) / 30; // -1..1
      const gy = Math.max(-30, Math.min(30, e.beta  - 45)) / 30;
      springs.rotY.target = gx * 0.20;
      springs.rotX.target = gy * 0.15;
    }, { passive: true });
  }

  // ── Animation loop ───────────────────────────────────────────
  let lastTime = 0, rafId = null, lastFrameTime = 0;
  let pathPhase = 0;

  function animate(now) {
    rafId = requestAnimationFrame(animate);
    if (FRAME_MS > 0 && now - lastFrameTime < FRAME_MS) return;
    lastFrameTime = now;
    const dt = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;

    // Step all springs
    Object.values(springs).forEach(sp => stepSpring(sp, dt));

    // Audio
    updateAudio(dt);

    // Breathing
    const cfg = ORB_CONFIG[currentState] || ORB_CONFIG.idle;
    springs.breath.target = 0.5 + 0.5 * Math.sin(now * 0.001 * cfg.breatheSpeed);
    stepSpring(springs.breath, dt);
    const breatheScale = 1.0 + cfg.breatheAmp * springs.breath.value;

    // Node path animation — only active during processing
    pathPhase = (pathPhase + dt * 0.4 * springs.cluster.value) % 1.0;

    // Attention
    updateAttention(currentState, mouse.x, mouse.y);

    // Mesh
    const audioScale = 1 + audio.bass * uniforms.uAudioInfl.value * 0.08;
    mesh.scale.setScalar(springs.scale.value * breatheScale * audioScale);
    mesh.rotation.x = springs.rotX.value;
    mesh.rotation.y = springs.rotY.value + now * 0.0002 * springs.motion.value;

    // Uniforms
    uniforms.uTime.value      = now * 0.001;
    uniforms.uBass.value      = audio.bass;
    uniforms.uMid.value       = audio.mid;
    uniforms.uTreble.value    = audio.treble;
    uniforms.uMotion.value    = springs.motion.value;
    uniforms.uHexScale.value  = springs.hexSc.value;
    uniforms.uCluster.value   = springs.cluster.value;
    uniforms.uBreath.value    = springs.breath.value;
    uniforms.uTension.value   = springs.tension.value;
    uniforms.uCoherence.value = springs.coherence.value;
    uniforms.uEnergy.value    = springs.energy.value;
    uniforms.uMemory.value    = springs.memory.value;
    uniforms.uAttentionStr.value = springs.attStr.value;
    uniforms.uPathPhase.value = pathPhase;
    uniforms.uMouse.value.set(mouse.x, mouse.y);
    uniforms.uColorA.value.set(springs.colR.value, springs.colG.value, springs.colB.value);

    // Decay
    uniforms.uBurst.value  = Math.max(0, uniforms.uBurst.value  - dt * 2.2);
    uniforms.uGlitch.value = Math.max(0, uniforms.uGlitch.value - dt * 1.6);

    // Ring speed driven by energy + motion springs
    updateRings(springs.motion.value * 7 * (0.5 + springs.energy.value * 0.5));

    renderer.render(scene, camera);
  }

  // ── Visibility management ────────────────────────────────────
  const nameScreen = document.getElementById('nameScreen');
  function startLoop() {
    if (!rafId) { lastTime = performance.now(); rafId = requestAnimationFrame(animate); }
  }
  function stopLoop() {
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
  }
  new MutationObserver(() => {
    nameScreen && nameScreen.classList.contains('active') ? startLoop() : stopLoop();
  }).observe(nameScreen || document.body, { attributes: true, attributeFilter: ['class'] });
  document.addEventListener('visibilitychange', () => {
    document.hidden ? stopLoop()
      : (nameScreen && nameScreen.classList.contains('active') && startLoop());
  });

  // Start + ignition
  if (nameScreen && nameScreen.classList.contains('active')) {
    startLoop();
    setTimeout(runIgnition, 300); // brief delay so renderer is ready
  }
}
