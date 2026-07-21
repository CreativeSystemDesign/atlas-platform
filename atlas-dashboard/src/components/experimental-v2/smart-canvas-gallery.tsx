"use client";

// The Midnight Gallery ambient layer (design target: "Smart Canvas v4" — the
// closing system). A full-screen Three.js scene BEHIND the whole workspace:
// an animated fbm nebula shader with real UnrealBloom, a field of drifting
// dust motes, and "work-beacons" — the atmosphere thickens and glows over
// unresolved work (open issues, coverage gaps), so peripheral vision learns
// that a dense, bright patch of air means "something here needs me."
//
// This is an ambient INFORMATION channel, not decoration: beacon positions are
// DATA-DRIVEN (passed in from real issue anchors / gap classes), never hardcoded.
// The palette is mode-reactive (cyan leads in Annotate, amber in Fingerprint)
// and a bloom-kicked ring pulse flares on mode switch.
//
// Degradation ladder (about correctness across viewers, not saving resources):
//   • no WebGL            → render nothing; the v3 CSS gallery-glow shows through
//   • prefers-reduced-motion → render nothing (static gradient shows through)
// The layer has pointer-events:none and z-index 0 — it never intercepts input.

import React, { useEffect, useRef } from "react";
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import type { SmartCanvasMode } from "./smart-canvas-header";

/** A place on the workspace that has unresolved work. `weight` scales the
 *  beacon's glow (e.g. number of open issues at that spot). `kind` tints it:
 *  amber for issues/attention, red for a hard coverage gap. */
export type WorkBeacon = {
  /** normalized [0,1] position over the canvas viewport (x right, y down) */
  x: number;
  y: number;
  weight?: number;
  kind?: "issue" | "gap";
};

const CYAN = new THREE.Color(0x22d3ee);
const AMBER = new THREE.Color(0xf59e0b);
const GAP_RED = new THREE.Color(0xf87171);

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  );
}

function hasWebGL(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

const NEBULA_FRAG = /* glsl */ `
  varying vec2 vUv;
  uniform float uTime; uniform vec2 uMouse;
  uniform vec3 uColorA; uniform vec3 uColorB;
  uniform float uAspect; uniform float uPulse;
  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p){
    vec2 i = floor(p); vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1,0)), u.x),
               mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), u.x), u.y);
  }
  float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 6; i++){ v += a * noise(p); p *= 2.02; a *= 0.5; } return v; }
  void main(){
    vec2 uv = vUv; vec2 p = uv * 3.0; p.x *= uAspect;
    float t = uTime * 0.025;
    vec2 q = vec2(fbm(p + t), fbm(p + vec2(5.2, 1.3) - t));
    float n = fbm(p + q * 1.9 + t);
    float d = distance(uv, vec2(0.5));
    vec3 col = vec3(0.02, 0.05, 0.09);
    float glowA = smoothstep(0.42, 0.92, n) * (0.6 + 0.4 * sin(uTime * 0.18));
    float glowB = smoothstep(0.5, 0.95, fbm(p * 1.5 - t));
    col += uColorA * glowA * 0.38;
    col += uColorB * glowB * 0.16;
    float m = 1.0 - smoothstep(0.0, 0.5, distance(uv, uMouse));
    col += uColorA * m * 0.14;
    float ring = smoothstep(0.03, 0.0, abs(d - (1.0 - uPulse) * 0.8));
    col += uColorA * ring * uPulse * 0.9;
    col += uColorA * uPulse * 0.18;
    col *= 1.0 - d * 0.72;
    gl_FragColor = vec4(col, 1.0);
  }
`;

const NEBULA_VERT = /* glsl */ `
  varying vec2 vUv;
  void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const MOTE_COUNT = 700;

export function SmartCanvasGallery({
  mode,
  beacons,
}: {
  mode: SmartCanvasMode;
  beacons: WorkBeacon[];
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Live values the animation loop reads without re-subscribing.
  const modeRef = useRef<SmartCanvasMode>(mode);
  const beaconsRef = useRef<WorkBeacon[]>(beacons);
  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { beaconsRef.current = beacons; }, [beacons]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (prefersReducedMotion() || !hasWebGL()) return; // degradation ladder

    let raf = 0;
    let alive = true;
    const mouse = { x: 0, y: 0 };

    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.autoClear = false;

    // ── Nebula backdrop: fullscreen quad running the fbm shader ──
    const bgScene = new THREE.Scene();
    const bgCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const bgUniforms = {
      uTime: { value: 0 },
      uMouse: { value: new THREE.Vector2(0.5, 0.5) },
      uColorA: { value: CYAN.clone() },
      uColorB: { value: AMBER.clone() },
      uAspect: { value: 1 },
      uPulse: { value: 0 },
    };
    const bgMat = new THREE.ShaderMaterial({
      uniforms: bgUniforms,
      depthTest: false,
      depthWrite: false,
      vertexShader: NEBULA_VERT,
      fragmentShader: NEBULA_FRAG,
    });
    bgScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), bgMat));

    // ── Foreground scene: motes + halos + beacons ──
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x0a0f1a, 0.055);
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
    camera.position.z = 14;

    // Soft round sprite for the motes/halos.
    const sc = document.createElement("canvas");
    sc.width = sc.height = 64;
    const g2d = sc.getContext("2d")!;
    const grd = g2d.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, "rgba(255,255,255,1)");
    grd.addColorStop(0.25, "rgba(190,240,255,0.85)");
    grd.addColorStop(1, "rgba(34,211,238,0)");
    g2d.fillStyle = grd;
    g2d.fillRect(0, 0, 64, 64);
    const sprite = new THREE.CanvasTexture(sc);

    const pos = new Float32Array(MOTE_COUNT * 3);
    const spd = new Float32Array(MOTE_COUNT);
    for (let i = 0; i < MOTE_COUNT; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 40;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 26;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 30;
      spd[i] = 0.06 + Math.random() * 0.14;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const moteMat = new THREE.PointsMaterial({
      size: 0.42,
      map: sprite,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      color: 0x8fe6ff,
      opacity: 0.9,
      sizeAttenuation: true,
    });
    const motes = new THREE.Points(geo, moteMat);
    scene.add(motes);
    const basePos = pos.slice(); // rest positions for the pointer-repel spring

    // Two faint colored "exhibit lights" for depth.
    const makeHalo = (hex: number, x: number, y: number, z: number, s: number) => {
      const m = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: sprite, color: hex, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false })
      );
      m.position.set(x, y, z);
      m.scale.set(s, s, 1);
      scene.add(m);
      return m;
    };
    const haloA = makeHalo(0x22d3ee, -10, 4, -6, 22);
    const haloB = makeHalo(0xf59e0b, 12, -5, -8, 18);

    // Work-beacons: created up to a generous cap and shown/hidden per frame from
    // the live beacon list, so the data can change without rebuilding the scene.
    const MAX_BEACONS = 24;
    const beaconSprites = Array.from({ length: MAX_BEACONS }, () => {
      const s = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: sprite, color: 0xf59e0b, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })
      );
      s.visible = false;
      scene.add(s);
      return s;
    });
    // Map a normalized viewport position to the mote world plane (approx).
    const beaconWorld = (b: WorkBeacon) => ({ x: (b.x - 0.5) * 34, y: -(b.y - 0.5) * 22 });

    // ── Post-processing: real UnrealBloom ──
    const composer = new EffectComposer(renderer);
    const rpBg = new RenderPass(bgScene, bgCam);
    const rpFg = new RenderPass(scene, camera);
    rpFg.clear = false;
    const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.9, 0.65, 0.12);
    composer.addPass(rpBg);
    composer.addPass(rpFg);
    composer.addPass(bloom);

    const resize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      bgUniforms.uAspect.value = w / h;
      composer.setSize(w, h);
    };
    resize();
    window.addEventListener("resize", resize);

    const onMove = (e: PointerEvent) => {
      mouse.x = e.clientX / window.innerWidth - 0.5;
      mouse.y = e.clientY / window.innerHeight - 0.5;
    };
    window.addEventListener("pointermove", onMove);

    const timer = new THREE.Timer(); // Clock is deprecated in r185; Timer is core now
    let lastMode = modeRef.current;
    let pulse = 0;

    const animate = () => {
      if (!alive) return;
      timer.update();
      const dt = Math.min(timer.getDelta(), 0.05);
      const et = timer.getElapsed();
      const fp = modeRef.current === "fingerprint";

      // Mode-switch pulse: bright ring flare + bloom kick.
      if (modeRef.current !== lastMode) { pulse = 1; lastMode = modeRef.current; }
      pulse *= 0.94;
      bgUniforms.uPulse.value = pulse;
      bloom.strength = 0.9 + pulse * 1.1;

      // Mode-reactive accent: cyan leads in Annotate, amber in Fingerprint.
      const lead = fp ? AMBER : CYAN;
      const follow = fp ? CYAN : AMBER;
      moteMat.color.lerp(lead, 0.03);
      haloA.material.color.lerp(lead, 0.03);
      haloB.material.color.lerp(follow, 0.03);
      bgUniforms.uColorA.value.lerp(lead, 0.03);
      bgUniforms.uColorB.value.lerp(follow, 0.03);
      bgUniforms.uTime.value = et;
      bgUniforms.uMouse.value.set(mouse.x + 0.5, 0.5 - mouse.y);

      // Beacons: show the live list, color to the current job, breathe.
      const list = beaconsRef.current;
      for (let i = 0; i < MAX_BEACONS; i++) {
        const s = beaconSprites[i];
        const b = list[i];
        if (!b) { s.visible = false; continue; }
        s.visible = true;
        const w = beaconWorld(b);
        s.position.set(w.x, w.y, -1);
        const col = b.kind === "gap" ? GAP_RED : AMBER;
        s.material.color.lerp(col, 0.05);
        const weight = b.weight ?? 1;
        const breathe = 0.4 + 0.24 * Math.sin(et * 1.6 + i * 2.1);
        s.material.opacity = Math.min(0.85, breathe * (0.7 + 0.25 * weight));
        const size = 2.0 + 0.5 * Math.sin(et * 1.6 + i * 2.1) + 0.4 * weight;
        s.scale.set(size, size, 1);
      }

      // Motes rise, drift, gravitate toward the nearest beacon, repel from pointer.
      const mx = mouse.x * 18;
      const my = -mouse.y * 12;
      const arr = geo.attributes.position.array as Float32Array;
      const beaconW = list.map(beaconWorld);
      for (let i = 0; i < MOTE_COUNT; i++) {
        const ix = i * 3;
        basePos[ix + 1] += spd[i] * dt;
        if (basePos[ix + 1] > 13) basePos[ix + 1] = -13;
        basePos[ix] += Math.sin((et + i) * 0.12) * 0.004;
        // gravitate toward the nearest work-beacon — atmosphere thickens over work
        let bx = 0, by = 0, bd = 1e9;
        for (let k = 0; k < beaconW.length; k++) {
          const ddx = beaconW[k].x - basePos[ix];
          const ddy = beaconW[k].y - basePos[ix + 1];
          const dd = ddx * ddx + ddy * ddy;
          if (dd < bd) { bd = dd; bx = ddx; by = ddy; }
        }
        if (bd < 25) { const pull = ((25 - bd) / 25) * 0.5 * dt; basePos[ix] += bx * pull; basePos[ix + 1] += by * pull; }
        // radial repel from pointer
        let x = basePos[ix], y = basePos[ix + 1];
        const dx = x - mx, dy = y - my;
        const d2 = dx * dx + dy * dy;
        if (d2 < 16) { const f = ((16 - d2) / 16) * 1.6; const inv = 1 / (Math.sqrt(d2) + 0.001); x += dx * inv * f; y += dy * inv * f; }
        arr[ix] = x; arr[ix + 1] = y; arr[ix + 2] = basePos[ix + 2];
      }
      geo.attributes.position.needsUpdate = true;
      motes.rotation.y += dt * 0.02;

      camera.position.x += (mouse.x * 3 - camera.position.x) * 0.03;
      camera.position.y += (-mouse.y * 2 - camera.position.y) * 0.03;
      camera.lookAt(0, 0, 0);

      composer.render();
      raf = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onMove);
      sprite.dispose();
      geo.dispose();
      moteMat.dispose();
      bgMat.dispose();
      composer.dispose();
      renderer.dispose();
    };
  }, []); // scene built once; live values flow through refs

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-0 h-full w-full"
      style={{ zIndex: 0 }}
    />
  );
}
