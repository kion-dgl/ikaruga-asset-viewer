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
  const [textureCanvases, setTextureCanvases] = useState<Map<number, HTMLCanvasElement>>(
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
            console.log(`Loading texture from: /iso/${texturePath}`);
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
            canvas.style.border = "1px solid white";
            canvas.title = texturePath.split("/").pop() || "";

            const context = canvas.getContext("2d");
            if (context) {
              context.putImageData(imageData, 0, 0);

              const texture = new THREE.CanvasTexture(canvas);
              texture.flipY = false; // PVR textures don't need to be flipped
              texture.name = texturePath.split("/").pop() || "";
              texture.needsUpdate = true; // Ensure texture updates
              
              // For debugging, add an attribute to track where the texture is applied
              texture.userData = { 
                applied: false,
                index: i,
                path: texturePath 
              };

              console.log(`Successfully loaded texture: ${texture.name} (${imageData.width}x${imageData.height})`);
              
              // Store texture and canvas with its index
              textureMap.set(i, texture);
              const canvasesMap = new Map(textureCanvases);
              canvasesMap.set(i, canvas);
              setTextureCanvases(canvasesMap);
            }
          } catch (err) {
            console.warn(`Error loading texture ${texturePath}:`, err);
          }
        }

        console.log(`Loaded ${textureMap.size} textures`);
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

        console.log("Parsed model:", parsedModel);
        console.log("TextureNames:", parsedModel.textureNames);
        console.log("Materials count:", parsedModel.materials?.length);
        
        if (parsedModel.geometry && parsedModel.materials) {
          // Create a mapping from texture names to texture objects
          const textureNameMap = new Map<string, THREE.Texture>();
          
          // Extract filenames without extensions from texturePaths
          texturePaths.forEach((path, index) => {
            const filename = path.split('/').pop()?.split('.')[0] || '';
            if (textures.has(index)) {
              textureNameMap.set(filename, textures.get(index));
              console.log(`Mapped texture name ${filename} to texture at index ${index}`);
            }
          });
          
          // Create materials from the parsed model
          const materials: THREE.Material[] = parsedModel.materials.map((materialOpts, index) => {
            // Basic material properties
            const material = new THREE.MeshPhongMaterial({
              side: materialOpts.doubleSide ? THREE.DoubleSide : THREE.FrontSide,
              transparent: materialOpts.blending || false,
              name: `Material_${index}`,
            });
            
            // Set colors if available
            if (materialOpts.diffuseColor) {
              material.color.setRGB(
                materialOpts.diffuseColor.r,
                materialOpts.diffuseColor.g,
                materialOpts.diffuseColor.b
              );
              material.opacity = materialOpts.diffuseColor.a;
            }
            
            // Apply texture if available - first try by texId
            if (materialOpts.texId >= 0 && textures.has(materialOpts.texId)) {
              const texture = textures.get(materialOpts.texId);
              material.map = texture;
              material.needsUpdate = true;
              // Mark texture as applied for debugging
              texture.userData.applied = true;
              console.log(`Applied texture ${materialOpts.texId} to material ${index}`);
            } 
            // If texture name is available, try to match by name
            else if (parsedModel.textureNames && parsedModel.textureNames.length > materialOpts.texId) {
              const textureName = parsedModel.textureNames[materialOpts.texId];
              if (textureName && textureNameMap.has(textureName)) {
                const texture = textureNameMap.get(textureName);
                material.map = texture;
                material.needsUpdate = true;
                // Mark texture as applied for debugging
                texture.userData.applied = true;
                console.log(`Applied texture "${textureName}" to material ${index}`);
              } else {
                console.log(`No matching texture found for name: ${textureName}`);
              }
            } else {
              console.log(`No texture found for material ${index} with texId: ${materialOpts.texId}`);
            }
            
            // Always ensure textures are properly updated
            if (material.map) {
              material.map.needsUpdate = true;
            }
            
            return material;
          });
          
          // If no materials defined, create a default material
          if (materials.length === 0) {
            materials.push(new THREE.MeshNormalMaterial());
          }
          
          // Log groups info for debugging
          if (parsedModel.geometry.groups && parsedModel.geometry.groups.length > 0) {
            console.log("Material groups in geometry:", parsedModel.geometry.groups);
            parsedModel.geometry.groups.forEach((group, i) => {
              console.log(`Group ${i}: materialIndex=${group.materialIndex}, start=${group.start}, count=${group.count}`);
            });
          } else {
            console.log("No material groups found in geometry");
          }

          // Create the mesh with the geometry and materials
          const mesh = new THREE.Mesh(parsedModel.geometry, materials);
          console.log("Created mesh with", materials.length, "materials");
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
    <div className="nj-viewer-container">
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
      
      {/* Texture Debug Panel */}
      <div className="texture-debug-panel" style={{ marginTop: '10px', display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
        <div style={{ width: '100%' }}>
          <h3 style={{ fontSize: '14px', marginBottom: '5px' }}>Texture Debug Panel:</h3>
        </div>
        {Array.from(textureCanvases.entries()).map(([index, canvas]) => {
          const texture = textures.get(index);
          const isApplied = texture?.userData?.applied || false;
          const textureName = texture?.name || `Texture ${index}`;
          const texturePath = texture?.userData?.path || '';
          
          return (
            <div key={index} style={{ 
              display: 'flex', 
              flexDirection: 'column',
              alignItems: 'center', 
              border: isApplied ? '2px solid green' : '2px solid red',
              padding: '5px',
              borderRadius: '4px',
              background: '#222'
            }}>
              <div style={{ 
                fontSize: '12px',
                color: isApplied ? 'lightgreen' : 'salmon',
                marginBottom: '3px',
                whiteSpace: 'nowrap'
              }}>
                {isApplied ? '✓ ' : '✗ '}
                {textureName}
              </div>
              <div style={{ 
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                width: '64px',
                height: '64px',
                overflow: 'hidden'
              }}>
                <canvas
                  ref={(ref) => {
                    if (ref) {
                      const ctx = ref.getContext('2d');
                      if (ctx) {
                        const scale = Math.min(64 / canvas.width, 64 / canvas.height);
                        ref.width = canvas.width * scale;
                        ref.height = canvas.height * scale;
                        ctx.scale(scale, scale);
                        ctx.drawImage(canvas, 0, 0);
                      }
                    }
                  }}
                  width={64}
                  height={64}
                  title={`Index: ${index}, Applied: ${isApplied}, Path: ${texturePath}`}
                />
              </div>
              <div style={{ fontSize: '10px', color: '#aaa', marginTop: '3px' }}>
                {canvas.width}x{canvas.height}
              </div>
            </div>
          );
        })}
        {textureCanvases.size === 0 && (
          <div style={{ color: '#aaa', fontSize: '12px' }}>No textures loaded</div>
        )}
      </div>
    </div>
  );
};

export default NJViewer;
