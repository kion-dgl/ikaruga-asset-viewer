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
import { parsePvr, parsePvm } from "../lib/parsePvr";
import type { PVMEntry } from "../lib/parsePvr";
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
  const [textures, setTextures] = useState<Map<string | number, THREE.Texture>>(
    new Map(),
  );
  const [textureCanvases, setTextureCanvases] = useState<Map<string | number, HTMLCanvasElement>>(
    new Map(),
  );
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Combined loading function for sequential loading
  useEffect(() => {
    const loadAll = async () => {
      console.log("Starting sequential loading process");
      setLoading(true);
      setError(null);
      
      try {
        // Step 1: Load textures first
        console.log("Step 1: Loading textures");
        const textureMap = new Map<number, THREE.Texture>();
        const canvasesMap = new Map<number, HTMLCanvasElement>();

        if (texturePaths.length > 0) {
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
              
              // Check if this is a PVM file (container) or direct PVR
              const isPVM = texturePath.toLowerCase().endsWith('.pvm');
              
              if (isPVM) {
                console.log("Processing PVM file...");
                try {
                  // Parse the PVM container to get all textures inside
                  const entries = await parsePvm(buffer);
                  console.log(`Successfully extracted ${entries.length} textures from PVM`);
                  
                  // Process each texture in the PVM
                  for (let j = 0; j < entries.length; j++) {
                    const entry = entries[j];
                    try {
                      // Parse the individual PVR texture
                      const { imageData } = await parsePvr(entry.data);
                      
                      // Create a Three.js texture from the parsed image data
                      const canvas = document.createElement("canvas");
                      canvas.width = imageData.width;
                      canvas.height = imageData.height;
                      canvas.style.border = "1px solid white";
                      canvas.title = entry.name;
                      
                      const context = canvas.getContext("2d");
                      if (context) {
                        context.putImageData(imageData, 0, 0);
                        
                        const texture = new THREE.CanvasTexture(canvas);
                        texture.flipY = false; // PVR textures don't need to be flipped
                        texture.name = entry.name;
                        texture.needsUpdate = true; // Ensure texture updates
                        
                        // For debugging, add an attribute to track where the texture is applied
                        texture.userData = {
                          applied: false,
                          index: j,
                          path: `${texturePath}/${entry.name}`,
                          fromPVM: true
                        };
                        
                        console.log(`Successfully loaded texture: ${texture.name} (${imageData.width}x${imageData.height}) from PVM`);
                        
                        // Store texture and canvas - use the texture name as the key for matching
                        textureMap.set(entry.name, texture);
                        canvasesMap.set(entry.name, canvas);
                      }
                    } catch (err) {
                      console.warn(`Error processing PVR entry ${entry.name} in ${texturePath}:`, err);
                    }
                  }
                  
                  // Skip the rest of the loop for this PVM since we've processed all entries
                  continue;
                } catch (err) {
                  console.error(`Failed to parse PVM file ${texturePath}:`, err);
                  // Fall back to treating it as a regular PVR if the PVM parsing fails
                  console.warn("Falling back to treating as regular PVR file...");
                }
              }
              
              // If we get here, handle as a regular PVR file
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
                
                // Store texture and canvas
                textureMap.set(i, texture);
                canvasesMap.set(i, canvas);
              }
            } catch (err) {
              console.warn(`Error loading texture ${texturePath}:`, err);
            }
          }
        }

        console.log(`Loaded ${textureMap.size} textures`);
        
        // Update state with loaded textures
        setTextures(textureMap);
        setTextureCanvases(canvasesMap);
        
        // Step 2: Now load and process the model with the loaded textures
        console.log("Step 2: Loading model with textures available");
        
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
            // Create materials from the parsed model
            const materials: THREE.Material[] = parsedModel.materials.map((materialOpts, index) => {
              // Basic material properties
              const material = new THREE.MeshPhongMaterial({
                side: materialOpts.doubleSide ? THREE.DoubleSide : THREE.FrontSide,
                transparent: materialOpts.blending || false,
                alphaTest: 0.05, // Use alphaTest to discard fully transparent pixels
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

              // Configure custom blending if needed
              if (materialOpts.blending && 
                  materialOpts.srcAlpha !== undefined && 
                  materialOpts.dstAlpha !== undefined) {
                
                // Set material to use custom blending
                material.blending = THREE.CustomBlending;
                
                // Map the NJ alpha blend instructions to THREE.js constants
                // NJ Format values from documentation:
                // ZER: 0 - Zero
                // ONE: 1 - One
                // OC: 2 - 'Other' Color
                // IOC: 3 - Inverse 'Other' Color
                // SA: 4 - Src Alpha
                // ISA: 5 - Inverse Src Alpha
                // DA: 6 - DST Alpha
                // IDA: 7 - Inverse DST Alpha
                
                // Map source alpha
                switch (materialOpts.srcAlpha) {
                  case 0: // ZER - Zero
                    material.blendSrc = THREE.ZeroFactor;
                    break;
                  case 1: // ONE - One
                    material.blendSrc = THREE.OneFactor;
                    break;
                  case 2: // OC - 'Other' Color (Destination Color)
                    material.blendSrc = THREE.DstColorFactor;
                    break;
                  case 3: // IOC - Inverse 'Other' Color (One Minus Destination Color)
                    material.blendSrc = THREE.OneMinusDstColorFactor;
                    break;
                  case 4: // SA - Src Alpha
                    material.blendSrc = THREE.SrcAlphaFactor;
                    break;
                  case 5: // ISA - Inverse Src Alpha
                    material.blendSrc = THREE.OneMinusSrcAlphaFactor;
                    break;
                  case 6: // DA - DST Alpha
                    material.blendSrc = THREE.DstAlphaFactor;
                    break;
                  case 7: // IDA - Inverse DST Alpha
                    material.blendSrc = THREE.OneMinusDstAlphaFactor;
                    break;
                  default:
                    material.blendSrc = THREE.SrcAlphaFactor; // Default to standard alpha
                }

                // Map destination alpha
                switch (materialOpts.dstAlpha) {
                  case 0: // ZER - Zero
                    material.blendDst = THREE.ZeroFactor;
                    break;
                  case 1: // ONE - One
                    material.blendDst = THREE.OneFactor;
                    break;
                  case 2: // OC - 'Other' Color (Source Color)
                    material.blendDst = THREE.SrcColorFactor;
                    break;
                  case 3: // IOC - Inverse 'Other' Color (One Minus Source Color)
                    material.blendDst = THREE.OneMinusSrcColorFactor;
                    break;
                  case 4: // SA - Src Alpha
                    material.blendDst = THREE.SrcAlphaFactor;
                    break;
                  case 5: // ISA - Inverse Src Alpha
                    material.blendDst = THREE.OneMinusSrcAlphaFactor;
                    break;
                  case 6: // DA - DST Alpha
                    material.blendDst = THREE.DstAlphaFactor;
                    break;
                  case 7: // IDA - Inverse DST Alpha
                    material.blendDst = THREE.OneMinusDstAlphaFactor;
                    break;
                  default:
                    material.blendDst = THREE.OneMinusSrcAlphaFactor; // Default to standard alpha
                }
                
                // Common alpha blending equation
                material.blendEquation = THREE.AddEquation;
                
                // For very transparent objects, disable depth write to prevent z-fighting
                if (materialOpts.diffuseColor && materialOpts.diffuseColor.a < 0.5) {
                  material.depthWrite = false;
                }
                
                // Store blend mode description for debugging
                const blendMode = `${getBlendModeName(materialOpts.srcAlpha)}-${getBlendModeName(materialOpts.dstAlpha)}`;
                material.userData.blendMode = blendMode;
              }
              
              // Helper function to convert blend mode numbers to readable names
              function getBlendModeName(mode: number): string {
                switch(mode) {
                  case 0: return 'ZERO';
                  case 1: return 'ONE';
                  case 2: return 'OC';
                  case 3: return 'IOC';
                  case 4: return 'SA';
                  case 5: return 'ISA';
                  case 6: return 'DA';
                  case 7: return 'IDA';
                  default: return `?${mode}`;
                }
              }
              
              let textureApplied = false;
              
              // For PVM files, the texture names are directly used as keys
              if (parsedModel.textureNames && parsedModel.textureNames.length > materialOpts.texId) {
                const textureName = parsedModel.textureNames[materialOpts.texId];
                if (textureName && textureMap.has(textureName.toString())) {
                  // Direct match by texture name from PVM
                  const texture = textureMap.get(textureName.toString());
                  if (texture) {
                    material.map = texture;
                    material.needsUpdate = true;
                    texture.userData.applied = true;
                    // Pass the blend mode to the texture for debugging display
                    if (material.userData.blendMode) {
                      texture.userData.blendMode = material.userData.blendMode;
                    }
                    console.log(`Applied texture "${textureName}" directly from PVM to material ${index}`);
                    textureApplied = true;
                  }
                }
              }
              
              // If no texture applied yet, try by index for single PVR files
              if (!textureApplied && materialOpts.texId >= 0 && textureMap.has(materialOpts.texId)) {
                const texture = textureMap.get(materialOpts.texId);
                if (texture) {
                  material.map = texture;
                  material.needsUpdate = true;
                  texture.userData.applied = true;
                  // Pass the blend mode to the texture for debugging display
                  if (material.userData.blendMode) {
                    texture.userData.blendMode = material.userData.blendMode;
                  }
                  console.log(`Applied texture by index ${materialOpts.texId} to material ${index}`);
                  textureApplied = true;
                }
              }
              
              // If still no texture, try texture name matching with filenames
              if (!textureApplied && parsedModel.textureNames && parsedModel.textureNames.length > materialOpts.texId) {
                const textureName = parsedModel.textureNames[materialOpts.texId];
                
                // Try all keys in textureMap to find a matching filename pattern
                for (const [key, texture] of textureMap.entries()) {
                  const keyStr = key.toString();
                  const textureNameStr = textureName.toString();
                  if (
                    // Try exact match first
                    keyStr === textureNameStr ||
                    // Try matching with case insensitivity 
                    keyStr.toLowerCase() === textureNameStr.toLowerCase() ||
                    // Try matching the end of the key (filename part)
                    keyStr.split('/').pop()?.split('.')[0]?.toLowerCase() === textureNameStr.toLowerCase()
                  ) {
                    material.map = texture;
                    material.needsUpdate = true;
                    texture.userData.applied = true;
                    // Pass the blend mode to the texture for debugging display
                    if (material.userData.blendMode) {
                      texture.userData.blendMode = material.userData.blendMode;
                    }
                    console.log(`Applied texture "${key}" to material ${index} by name matching with "${textureName}"`);
                    textureApplied = true;
                    break;
                  }
                }
                
                if (!textureApplied) {
                  console.log(`No matching texture found for name: ${textureName}`);
                }
              }
              
              if (!textureApplied) {
                console.log(`No texture applied to material ${index} with texId: ${materialOpts.texId}`);
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
        }
      } catch (err) {
        console.error("Error in sequential loading process:", err);
        setError("Failed to load resources");
      } finally {
        setLoading(false);
      }
    };

    loadAll(); // Start the sequential loading process
  }, [modelPath, texturePaths]); // Only depends on the paths, not the loaded textures

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
        {Array.from(textureCanvases.entries()).map(([key, canvas]) => {
          // Get texture from the map using the same key (string or number)
          const texture = textures.get(key);
          const isApplied = texture?.userData?.applied || false;
          const textureName = texture?.name || `Texture ${key.toString()}`;
          const texturePath = texture?.userData?.path || '';
          const fromPVM = texture?.userData?.fromPVM || false;
          
          return (
            <div key={key.toString()} style={{ 
              display: 'flex', 
              flexDirection: 'column',
              alignItems: 'center', 
              border: isApplied ? '2px solid green' : '2px solid red',
              padding: '5px',
              borderRadius: '4px',
              background: fromPVM ? '#223322' : '#222'
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
                  title={`Key: ${key}, Name: ${textureName}, Applied: ${isApplied}${fromPVM ? ', From PVM' : ''}, Path: ${texturePath}`}
                />
              </div>
              <div style={{ fontSize: '10px', color: '#aaa', marginTop: '3px' }}>
                {canvas.width}x{canvas.height}
              </div>
              {/* Check if texture is applied to any material with blending */}
              {isApplied && texture?.userData?.blendMode && (
                <div style={{ fontSize: '9px', color: '#aaffaa', marginTop: '2px' }}>
                  Blend: {texture.userData.blendMode}
                </div>
              )}
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
