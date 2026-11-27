import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { cn } from "../lib/utils";
import { WHEEL } from "../lib/gameshow";
import { SEGMENT_DEG, segmentSector, boundaryAngle, wheelRotationZ } from "../lib/wheel-geometry";
import { useWheelSpin, flapperTilt, segmentFill, type GameWheelProps, type WheelSpin } from "./Wheel";

// The 3D studio wheel: a lit, metal-rimmed disc with pegs, a flapper pointer
// and chasing rim bulbs, filmed by a camera that leans in while it spins.
//
// It is driven by the same useWheelSpin as the 2D wheel, so it turns by the
// same rules and stops on the segment the game chose. Loaded lazily — see
// GameWheel in Wheel.tsx — so Three.js is only downloaded when it is used.

const FACE_RADIUS = 3;
const RIM_RADIUS = 3.22;
const BULBS = 24;
const DEG = Math.PI / 180;

/** The wheel face — segments and labels — painted once onto a texture. */
function useFaceTexture(): THREE.CanvasTexture {
  const texture = useMemo(() => {
    const size = 1024;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    const c = size / 2;
    const r = size / 2 - 2;

    WHEEL.forEach((seg, i) => {
      // Canvas angles run clockwise from +x, so the top is -90 degrees.
      const start = (i * SEGMENT_DEG - 90) * DEG;
      const end = ((i + 1) * SEGMENT_DEG - 90) * DEG;
      ctx.beginPath();
      ctx.moveTo(c, c);
      ctx.arc(c, c, r, start, end);
      ctx.closePath();
      ctx.fillStyle = segmentFill(i, seg.kind);
      ctx.fill();
      ctx.lineWidth = 8;
      ctx.strokeStyle = "#0b1220";
      ctx.stroke();

      const mid = (i + 0.5) * SEGMENT_DEG - 90;
      ctx.save();
      ctx.translate(c + r * 0.66 * Math.cos(mid * DEG), c + r * 0.66 * Math.sin(mid * DEG));
      ctx.rotate((mid + 90) * DEG);
      ctx.fillStyle = "#ffffff";
      ctx.shadowColor = "rgba(0,0,0,0.55)";
      ctx.shadowBlur = 10;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = seg.kind === "points" ? "900 78px Inter, system-ui, sans-serif" : "800 38px Inter, system-ui, sans-serif";
      ctx.fillText(seg.label, 0, 0);
      ctx.restore();
    });

    // A soft sheen from the centre, so the face reads as a lit surface.
    const sheen = ctx.createRadialGradient(c * 0.8, c * 0.7, 0, c, c, r);
    sheen.addColorStop(0, "rgba(255,255,255,0.16)");
    sheen.addColorStop(0.6, "rgba(255,255,255,0.03)");
    sheen.addColorStop(1, "rgba(0,0,0,0.25)");
    ctx.globalCompositeOperation = "source-atop";
    ctx.fillStyle = sheen;
    ctx.fillRect(0, 0, size, size);

    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  }, []);
  useEffect(() => () => texture.dispose(), [texture]);
  return texture;
}

/** Studio reflections from a generated room, so metal looks like metal. No downloads. */
function StudioEnvironment() {
  const { gl, scene } = useThree();
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
    return () => {
      scene.environment = null;
      env.dispose();
      pmrem.dispose();
    };
  }, [gl, scene]);
  return null;
}

function WheelBody({ spin, reducedMotion, active }: { spin: WheelSpin; reducedMotion: boolean; active: boolean }) {
  const group = useRef<THREE.Group>(null);
  const winner = useRef<THREE.MeshBasicMaterial>(null);
  const face = useFaceTexture();

  useFrame(({ clock }) => {
    if (group.current) group.current.rotation.z = wheelRotationZ(spin.rot.get());
    if (winner.current) {
      const pulsing = active && !reducedMotion;
      winner.current.opacity = pulsing ? 0.22 + 0.2 * (0.5 + 0.5 * Math.sin(clock.elapsedTime * 7)) : 0.35;
    }
  });

  const winnerSector = spin.landedIndex === null ? null : segmentSector(spin.landedIndex);

  return (
    <group ref={group}>
      {/* The disc, standing face-on to the camera */}
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, -0.05]}>
        <cylinderGeometry args={[FACE_RADIUS + 0.04, FACE_RADIUS + 0.04, 0.42, 96]} />
        <meshStandardMaterial color="#0b1220" metalness={0.5} roughness={0.4} />
      </mesh>
      <mesh position={[0, 0, 0.17]}>
        <circleGeometry args={[FACE_RADIUS, 96]} />
        {/* Low reflection, so the segment colours stay as saturated as the 2D wheel's */}
        <meshStandardMaterial map={face} roughness={0.6} metalness={0} envMapIntensity={0.25} />
      </mesh>

      {/* The winning segment glows once the wheel stops */}
      {winnerSector && (
        <mesh position={[0, 0, 0.18]}>
          <circleGeometry args={[FACE_RADIUS - 0.02, 24, winnerSector.thetaStart, winnerSector.thetaLength]} />
          <meshBasicMaterial
            ref={winner}
            color="#fde68a"
            transparent
            opacity={0.35}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </mesh>
      )}

      {/* Pegs at each boundary — what the flapper clicks against */}
      {WHEEL.map((seg, i) => {
        const a = boundaryAngle(i);
        return (
          <mesh
            key={seg.id}
            position={[Math.cos(a) * (FACE_RADIUS - 0.1), Math.sin(a) * (FACE_RADIUS - 0.1), 0.32]}
            rotation={[Math.PI / 2, 0, 0]}
          >
            <cylinderGeometry args={[0.055, 0.055, 0.32, 16]} />
            <meshStandardMaterial color="#fbbf24" metalness={0.9} roughness={0.25} />
          </mesh>
        );
      })}

      {/* Hub */}
      <mesh position={[0, 0, 0.26]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.58, 0.62, 0.2, 48]} />
        <meshStandardMaterial color="#0b1220" metalness={0.7} roughness={0.3} />
      </mesh>
      <mesh position={[0, 0, 0.4]}>
        <sphereGeometry args={[0.24, 32, 16]} />
        <meshStandardMaterial color="#f59e0b" metalness={0.85} roughness={0.2} emissive="#b45309" emissiveIntensity={0.4} />
      </mesh>
    </group>
  );
}

/** The fixed rim and its bulbs: chase while spinning, flash on landing. */
function Rim({ spin, reducedMotion }: { spin: WheelSpin; reducedMotion: boolean }) {
  const bulbs = useMemo(
    () =>
      Array.from({ length: BULBS }, () => new THREE.MeshStandardMaterial({ color: "#fde68a", emissive: "#fbbf24" })),
    [],
  );
  useEffect(() => () => bulbs.forEach((m) => m.dispose()), [bulbs]);

  const settledAt = useRef<number | null>(null);
  const wasSettled = useRef(spin.settled);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (spin.settled && !wasSettled.current) settledAt.current = t;
    wasSettled.current = spin.settled;
    const sinceLanding = settledAt.current === null ? Infinity : t - settledAt.current;

    bulbs.forEach((m, i) => {
      let level = 0.6;
      if (!reducedMotion) {
        if (spin.spinning) level = (Math.floor(t * 11) + i) % 4 === 0 ? 2.6 : 0.25;
        else if (sinceLanding < 2.2) level = Math.floor(t * 6) % 2 === 0 ? 2.4 : 0.35;
      }
      m.emissiveIntensity = level;
    });
  });

  return (
    <group>
      <mesh>
        <torusGeometry args={[RIM_RADIUS, 0.15, 24, 128]} />
        <meshStandardMaterial color="#f59e0b" metalness={0.95} roughness={0.22} />
      </mesh>
      {bulbs.map((material, i) => {
        const a = (i / BULBS) * Math.PI * 2;
        return (
          <mesh key={i} position={[Math.cos(a) * RIM_RADIUS, Math.sin(a) * RIM_RADIUS, 0.16]} material={material}>
            <sphereGeometry args={[0.075, 16, 12]} />
          </mesh>
        );
      })}
    </group>
  );
}

/** The flapper at the top, knocked sideways by each passing peg. */
function Pointer({ spin }: { spin: WheelSpin }) {
  const flap = useRef<THREE.Group>(null);
  useFrame(() => {
    // flapperTilt is clockwise-positive (CSS); Three.js is anticlockwise.
    if (flap.current) flap.current.rotation.z = -flapperTilt(spin.rot.get(), spin.direction.current) * DEG;
  });
  return (
    <group ref={flap} position={[0, RIM_RADIUS + 0.2, 0.55]}>
      <mesh position={[0, -0.36, 0]} rotation={[0, 0, Math.PI]}>
        <coneGeometry args={[0.24, 0.72, 32]} />
        <meshStandardMaterial color="#fbbf24" metalness={0.75} roughness={0.25} emissive="#92400e" emissiveIntensity={0.3} />
      </mesh>
      <mesh>
        <sphereGeometry args={[0.16, 24, 16]} />
        <meshStandardMaterial color="#78350f" metalness={0.6} roughness={0.35} />
      </mesh>
    </group>
  );
}

/** Asks for a fresh frame when the scene changes while rendering on demand. */
function RenderOnChange({ deps }: { deps: unknown[] }) {
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => {
    invalidate();
    // A second frame lets the camera settle after an instant (reduced-motion) jump.
    const id = requestAnimationFrame(() => invalidate());
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return null;
}

/** How long to keep animating after the wheel lands: the flash and the camera easing back. */
const AFTERGLOW_MS = 3000;

/** The camera leans in while the wheel spins, and eases back when it stops. */
function CameraRig({ spin, reducedMotion }: { spin: WheelSpin; reducedMotion: boolean }) {
  useFrame(({ camera, clock }, delta) => {
    const leanIn = spin.spinning && !reducedMotion;
    const targetZ = leanIn ? 13.6 : 15;
    const targetX = leanIn ? Math.sin(clock.elapsedTime * 0.9) * 0.35 : 0;
    const k = 1 - Math.exp(-delta * 2.2);
    camera.position.z += (targetZ - camera.position.z) * k;
    camera.position.x += (targetX - camera.position.x) * k;
    camera.lookAt(0, 0, 0);
  });
  return null;
}

export default function Wheel3D({
  rotation,
  duration,
  onTick,
  onSpinStart,
  onLand,
  className,
  reducedMotion = false,
}: GameWheelProps) {
  const spin = useWheelSpin(rotation, duration, { onTick, onSpinStart, onLand });

  // Render every frame only while something moves: the spin, then the landing
  // flash and the camera easing back. Otherwise draw on demand, so a wheel
  // standing still costs nothing — this matters on school Chromebooks.
  const [afterglow, setAfterglow] = useState(false);
  useEffect(() => {
    if (!spin.settled || reducedMotion) return;
    setAfterglow(true);
    const id = window.setTimeout(() => setAfterglow(false), AFTERGLOW_MS);
    return () => window.clearTimeout(id);
  }, [spin.settled, reducedMotion]);
  const active = spin.spinning || afterglow;

  return (
    <div className={cn("relative aspect-square shrink-0", className ?? "w-[300px]")} aria-hidden="true">
      <div
        className={cn(
          "absolute inset-[6%] rounded-full blur-2xl transition-opacity duration-700",
          "bg-[radial-gradient(circle,rgba(251,191,36,0.35),rgba(59,130,246,0.15)_60%,transparent_70%)]",
          spin.spinning ? "opacity-100" : "opacity-50",
        )}
      />
      <Canvas
        className="!absolute inset-0"
        camera={{ fov: 30, position: [0, 0.5, 15], near: 0.1, far: 100 }}
        dpr={[1, 1.75]}
        frameloop={active ? "always" : "demand"}
        gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
        // Neutral tone mapping keeps brand colours true; the default (ACES)
        // washed the segment blues out to lavender.
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.NeutralToneMapping;
        }}
      >
        <StudioEnvironment />
        <ambientLight intensity={0.35} />
        <directionalLight position={[-4, 6, 9]} intensity={1.6} />
        <pointLight position={[5, -3, 6]} intensity={30} distance={25} color="#fbbf24" />
        <pointLight position={[-6, -2, 5]} intensity={22} distance={25} color="#60a5fa" />
        <RenderOnChange deps={[rotation, spin.landedIndex, active]} />
        <WheelBody spin={spin} reducedMotion={reducedMotion} active={active} />
        <Rim spin={spin} reducedMotion={reducedMotion} />
        <Pointer spin={spin} />
        <CameraRig spin={spin} reducedMotion={reducedMotion} />
      </Canvas>
    </div>
  );
}
