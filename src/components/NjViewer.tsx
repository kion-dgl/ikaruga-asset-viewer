import React, { useState, useEffect, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Stats } from "@react-three/drei";
import * as THREE from "three";
import { parsePvr } from "../lib/parsePvr";
import { parseNinjaModel } from "../lib/njParse";

interface NJViewerProps {
  modelPath: string;
  texturePaths?: string[];
  width?: number;
  height?: number;
}

const NJViewer: React.FC<NJViewerProps> = ({
  modelPath,
  texturePaths = [],
  width = 600,
  height = 400,
}) => {
  const [mesh, setMesh] = useState<THREE.Mesh | null>(null);
  const [textures, setTextures] = useState<THREE.Texture[] | null>(null);

  // Load textures first
  useEffect(() => {
    const loadTextures = async () => {
      try {
        const loadedTextures: THREE.Texture[] = [];

        for (const texturePath of texturePaths) {
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

              loadedTextures.push(texture);
            }
          } catch (err) {
            console.warn(`Error loading texture ${texturePath}:`, err);
          }
        }

        setTextures(loadedTextures);
      } catch (err) {
        console.error("Error loading textures:", err);
      }
    };

    // if (texturePaths.length > 0) {
    //   loadTextures();
    // }
  }, [texturePaths]);

  // Parse NJ file after textures are loaded
  useEffect(() => {
    const loadModel = async () => {
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
      } catch (err) {
        console.error("Error loading or parsing NJ model:", err);
      }
    };

    loadModel();
  }, [modelPath]);

  return (
    <div
      className="nj-viewer-canvas border border-gray-300 rounded-md overflow-hidden"
      style={{ width, height }}
    >
      <Canvas camera={{ position: [0, 2, 5], fov: 50 }}>
        <ambientLight intensity={0.5} />
        <pointLight position={[10, 10, 10]} intensity={1} />
        <pointLight
          position={[-10, -10, -10]}
          intensity={0.5}
          color="#8080ff"
        />
        <mesh>
          <boxGeometry attach="geometry" args={[1, 1, 1]} />
          <meshStandardMaterial attach="material" color="#6be092" />
        </mesh>
        <OrbitControls />
        <gridHelper args={[10, 10]} />
        <axesHelper args={[5]} />
      </Canvas>
    </div>
  );
};

export default NJViewer;
