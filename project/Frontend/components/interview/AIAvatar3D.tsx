"use client"

import { useRef, useEffect, Suspense, useState } from "react"
import { Canvas, useFrame } from "@react-three/fiber"
import { useGLTF, OrbitControls, Environment } from "@react-three/drei"
import * as THREE from "three"

// Avatar at position [0, -1.65, 0] → head is at world Y ≈ 0
const AVATAR_URL =
  "https://models.readyplayer.me/699efa24f005c9608f683347.glb?morphTargets=ARKit,Oculus+Visemes"

useGLTF.preload(AVATAR_URL)

const VISEME_CYCLE = [
  "viseme_aa", "viseme_E", "viseme_I", "viseme_O", "viseme_U",
  "viseme_PP", "viseme_FF", "viseme_CH", "viseme_DD", "viseme_sil",
]

function AvatarModel({ isSpeaking, amplitude }: { isSpeaking: boolean; amplitude: number }) {
  const { scene } = useGLTF(AVATAR_URL)
  const morphMeshes = useRef<THREE.SkinnedMesh[]>([])
  const visemeIdx = useRef(0)
  const visemeTimer = useRef(0)
  const blinkTimer = useRef(Math.random() * 2)
  const nextBlink = useRef(2 + Math.random() * 3)

  useEffect(() => {
    const found: THREE.SkinnedMesh[] = []
    scene.traverse((obj) => {
      if (
        obj instanceof THREE.SkinnedMesh &&
        obj.morphTargetDictionary &&
        Object.keys(obj.morphTargetDictionary).some((k) => k.startsWith("viseme_"))
      ) {
        found.push(obj)
      }
    })
    morphMeshes.current = found
  }, [scene])
  useFrame((_, delta) => {
    const meshes = morphMeshes.current
    if (!meshes.length) return
    const primary = meshes[0]
    if (!primary.morphTargetInfluences || !primary.morphTargetDictionary) return
    const dict = primary.morphTargetDictionary
    const inf = primary.morphTargetInfluences

    // ── Real amplitude-driven lip sync ────────────────────────────────────
    // amplitude = 0-1 from Web Audio AnalyserNode (or 0 when fallback TTS used)
    const mouthTarget = isSpeaking
      ? amplitude > 0
        ? amplitude * 0.9                              // real audio amplitude
        : 0.2 + Math.abs(Math.sin(Date.now() * 0.01)) * 0.4  // fallback sine
      : 0

    // Apply to jawOpen + viseme_aa (both control mouth opening in RPM avatars)
    if (dict["jawOpen"] !== undefined)
      inf[dict["jawOpen"]] = THREE.MathUtils.lerp(inf[dict["jawOpen"]], mouthTarget, delta * 15)
    if (dict["viseme_aa"] !== undefined)
      inf[dict["viseme_aa"]] = THREE.MathUtils.lerp(inf[dict["viseme_aa"]], mouthTarget * 0.7, delta * 15)
    if (dict["mouthOpen"] !== undefined)
      inf[dict["mouthOpen"]] = THREE.MathUtils.lerp(inf[dict["mouthOpen"]], mouthTarget, delta * 15)

    // Ease all other visemes to 0
    for (const k of Object.keys(dict)) {
      if (k.startsWith("viseme_") && k !== "viseme_aa" && k !== "viseme_sil" && dict[k] !== undefined)
        inf[dict[k]] = THREE.MathUtils.lerp(inf[dict[k]], 0, delta * 8)
    }

    blinkTimer.current += delta
    if (blinkTimer.current >= nextBlink.current) {
      blinkTimer.current = 0
      nextBlink.current = 2 + Math.random() * 4
      for (const mesh of meshes) {
        const d = mesh.morphTargetDictionary; const i = mesh.morphTargetInfluences
        if (!d || !i) continue
        if (d["eyeBlinkLeft"] !== undefined) i[d["eyeBlinkLeft"]] = 1
        if (d["eyeBlinkRight"] !== undefined) i[d["eyeBlinkRight"]] = 1
        setTimeout(() => {
          if (d["eyeBlinkLeft"] !== undefined) i[d["eyeBlinkLeft"]] = 0
          if (d["eyeBlinkRight"] !== undefined) i[d["eyeBlinkRight"]] = 0
        }, 120)
      }
    }

    for (let m = 1; m < meshes.length; m++) {
      const mesh = meshes[m]
      if (!mesh.morphTargetInfluences || !mesh.morphTargetDictionary) continue
      const d = mesh.morphTargetDictionary; const i = mesh.morphTargetInfluences
      for (const k of Object.keys(d)) {
        if (dict[k] !== undefined) i[d[k]] = inf[dict[k]]
      }
    }
  })

  // Avatar feet at y=0 in local space; position shifts them to y=-1.65 in world
  // so head (≈1.65 above feet) ends up at world y ≈ 0
  return <primitive object={scene} position={[0, -1.65, 0]} scale={1} />
}

function Loader() {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-500 border-t-transparent" />
    </div>
  )
}

export function AIAvatar3D({ isSpeaking, amplitude = 0 }: { isSpeaking: boolean; amplitude?: number }) {
  const [error, setError] = useState(false)

  if (error) {
    return (
      <div className="flex h-64 w-full flex-col items-center justify-center gap-2">
        <span className="text-5xl">🤖</span>
        <p className="text-xs text-muted-foreground">Avatar unavailable</p>
      </div>
    )
  }

  return (
    <div className="relative w-full" style={{ height: 420 }}>
      <Suspense fallback={<Loader />}>
        <Canvas
          // Tight portrait: face + upper chest only — arms hidden below frame
          camera={{ position: [0, -0.1, 1.3], fov: 30 }}
          gl={{ antialias: true, alpha: true }}
          style={{ background: "transparent", width: "100%", height: "100%" }}
          onError={() => setError(true)}
        >
          {/* Look at the head, no user controls */}
          <OrbitControls
            target={[0, -0.08, 0]}
            enableZoom={false}
            enablePan={false}
            enableRotate={false}
          />

          <ambientLight intensity={0.8} />
          <directionalLight position={[-1.5, 2, 2]} intensity={1.8} color="#fff8f0" />
          <directionalLight position={[2, 1, 1]} intensity={0.6} color="#c7d2fe" />
          <directionalLight position={[0, 0.5, -2]} intensity={0.3} color="#818cf8" />

          <AvatarModel isSpeaking={isSpeaking} amplitude={amplitude} />
          <Environment preset="studio" />
        </Canvas>
      </Suspense>
    </div>
  )
}
}
