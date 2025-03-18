import React, { useState, useEffect, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import {
  SkinnedMesh,
  AnimationMixer,
  Clock,
  LoopRepeat,
  AnimationClip,
  VectorKeyframeTrack,
} from "three";
import { parsePvr } from "../lib/parsePvr";
import { parseNinjaModel, NinjaModel } from "../lib/njParse";

interface NJViewerProps {
  modelPath: string;
  texturePaths?: string[];
  width?: number;
  height?: number;
}

// Component to handle the rotation of the model and animation
const Model: React.FC<{ mesh: THREE.SkinnedMesh | THREE.Mesh }> = ({
  mesh,
}) => {
  const groupRef = useRef<THREE.Group>(null);
  const mixer = useRef<THREE.AnimationMixer | null>(null);
  const clock = useRef<THREE.Clock>(new THREE.Clock());

  // Initialize animation mixer if it's a skinned mesh
  useEffect(() => {
    if (mesh instanceof THREE.SkinnedMesh && mesh.skeleton) {
      // Create animation mixer for skeletal animation
      mixer.current = new THREE.AnimationMixer(mesh);

      // Create a simple animation for demonstration
      const tracks: THREE.KeyframeTrack[] = [];
      const times = [0, 1, 2]; // keyframe times
      const positions = [
        // Initial position
        0, 0, 0,
        // Slightly moved
        0, 0.1, 0,
        // Back to initial
        0, 0, 0,
      ];

      // Create position track for the first bone if it exists
      if (mesh.skeleton.bones.length > 0) {
        const positionKF = new THREE.VectorKeyframeTrack(
          `.skeleton.bones[0].position`,
          times,
          positions,
        );
        tracks.push(positionKF);

        // Create a clip and play it
        const clip = new THREE.AnimationClip("simpleAnimation", 2, tracks);
        const action = mixer.current.clipAction(clip);
        action.setLoop(THREE.LoopRepeat, Infinity);
        action.play();
      }
    }
  }, [mesh]);

  useFrame(() => {
    // Update animation mixer
    if (mixer.current) {
      mixer.current.update(clock.current.getDelta());
    }
  });

  return (
    <group ref={groupRef}>
      <primitive object={mesh} />
    </group>
  );
};

const NJViewer: React.FC<NJViewerProps> = ({
  modelPath,
  texturePaths = [],
  width = 600,
  height = 400,
}) => {
  const [model, setModel] = useState<THREE.SkinnedMesh | THREE.Mesh | null>(
    null,
  );
  const [textures, setTextures] = useState<Map<number, THREE.Texture>>(
    new Map(),
  );
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Load textures first
  useEffect(() => {
    const loadTextures = async () => {
      try {
        const textureMap = new Map<number, THREE.Texture>();

        for (let i = 0; i < texturePaths.length; i++) {
          const texturePath = texturePaths[i];
          try {
            // Fetch the PVR/PVM file
            const response = await fetch(`/iso/${texturePath}`);
            if (!response.ok) {
              console.warn(`Failed to load texture: ${texturePath}`);
              continue;
            }

            const buffer = await response.arrayBuffer();
            const { imageData } = await parsePvr(buffer);

            // Create a Three.js texture from the parsed image data
            const canvas = document.createElement("canvas");
            canvas.width = imageData.width;
            canvas.height = imageData.height;

            const context = canvas.getContext("2d");
            if (context) {
              context.putImageData(imageData, 0, 0);

              const texture = new THREE.CanvasTexture(canvas);
              texture.flipY = false; // PVR textures don't need to be flipped
              texture.name = texturePath.split("/").pop() || "";

              // Store texture with its index
              textureMap.set(i, texture);
            }
          } catch (err) {
            console.warn(`Error loading texture ${texturePath}:`, err);
          }
        }

        setTextures(textureMap);
      } catch (err) {
        console.error("Error loading textures:", err);
        setError("Failed to load textures");
      }
    };

    if (texturePaths.length > 0) {
      loadTextures();
    }
  }, [texturePaths]);

  // Parse NJ file after textures are loaded
  useEffect(() => {
    const loadModel = async () => {
      setLoading(true);
      setError(null);

      try {
        console.log(`Loading model: ${modelPath}`);
        // Fetch the NJ file
        const response = await fetch(`/iso/${modelPath}`);
        if (!response.ok) {
          throw new Error(`Failed to load model: ${response.statusText}`);
        }

        // Get the model data as ArrayBuffer
        const modelBuffer = await response.arrayBuffer();
        const parsedModel = parseNinjaModel(modelBuffer);

        if (parsedModel.geometry) {
          const mat = new THREE.MeshNormalMaterial();
          const mesh = new THREE.Mesh(parsedModel.geometry, mat);
          setModel(mesh);
        }
      } catch (err) {
        console.error("Error loading or parsing NJ model:", err);
        setError(
          err instanceof Error ? err.message : "Unknown error loading model",
        );
      } finally {
        setLoading(false);
      }
    };

    loadModel();
  }, [modelPath, textures]);

  return (
    <div
      className="nj-viewer-canvas border border-gray-300 rounded-md overflow-hidden relative"
      style={{ width, height }}
    >
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-30 z-10">
          <div className="text-white">Loading model...</div>
        </div>
      )}

      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-30 z-10">
          <div className="text-red-500">{error}</div>
        </div>
      )}

      <Canvas camera={{ position: [0, 2, 5], fov: 50 }}>
        <ambientLight intensity={0.5} />
        <pointLight position={[10, 10, 10]} intensity={1} />
        <pointLight
          position={[-10, -10, -10]}
          intensity={0.5}
          color="#8080ff"
        />

        {model ? (
          <Model mesh={model} />
        ) : (
          // Placeholder box while loading
          <mesh>
            <boxGeometry args={[1, 1, 1]} />
            <meshStandardMaterial color="#6be092" />
          </mesh>
        )}

        <OrbitControls />
        <gridHelper args={[10, 10]} />
        <axesHelper args={[5]} />
      </Canvas>
    </div>
  );
};

export default NJViewer;
