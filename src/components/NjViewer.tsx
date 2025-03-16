import React, { useState, useEffect, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Stats } from "@react-three/drei";
import * as THREE from "three";
import { parsePvr } from "../lib/parsePvr";
import { parseNinjaModel, NJMeshData } from "../lib/njParse";

interface NJHeader {
  magic: string;
  dataSize: number;
  bones: number;
  vertices: number;
  polygons: number;
}

// Use the interface from njParse.ts
type NJMesh = NJMeshData;

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
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [mesh, setMesh] = useState<NJMesh | null>(null);
  const [textures, setTextures] = useState<THREE.Texture[]>([]);
  const [metaData, setMetaData] = useState<NJHeader | null>(null);

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
        setError("Failed to load one or more textures");
      }
    };

    if (texturePaths.length > 0) {
      loadTextures();
    }
  }, [texturePaths]);

  // Parse NJ file after textures are loaded
  useEffect(() => {
    const loadAndParseModel = async () => {
      setLoading(true);
      setError(null);

      try {
        console.log(`Loading model: ${modelPath}`);
        // Fetch the NJ file
        const response = await fetch(`/iso/${modelPath}`);
        if (!response.ok) {
          throw new Error(`Failed to load model: ${response.statusText}`);
        }

        console.log("Model file fetched successfully");

        // Get the model data as ArrayBuffer
        const modelBuffer = await response.arrayBuffer();
        const dataView = new DataView(modelBuffer);

        // Check magic (NJTL, NJCM, etc)
        const magic = String.fromCharCode(
          dataView.getUint8(0),
          dataView.getUint8(1),
          dataView.getUint8(2),
          dataView.getUint8(3),
        );
        console.log(`Model format: ${magic}`);

        // Create header info for display
        const header: NJHeader = {
          magic,
          dataSize: modelBuffer.byteLength,
          bones: 0, // To be calculated after parsing
          vertices: 0,
          polygons: 0,
        };

        // Call the dedicated parser from njParse.ts
        // This function will be implemented separately by the user
        const parsedModel = parseNinjaModel(modelBuffer, textures);

        // Update header with model details
        header.bones = parsedModel.bones.length;
        header.vertices = parsedModel.vertices;
        header.polygons = parsedModel.polygons;

        console.log(
          `Model loaded with ${header.vertices} vertices and ${header.bones} bones`,
        );

        setMetaData(header);
        setMesh(parsedModel);
        setLoading(false);
      } catch (err) {
        console.error("Error loading or parsing NJ model:", err);
        setError(err instanceof Error ? err.message : "Failed to parse model");
        setLoading(false);
        
        // Create a placeholder model on error
        setMesh(loadPlaceholderModel(textures));
      }
    };

    loadAndParseModel();
  }, [modelPath, textures]);

  // This will be replaced by the dedicated parser from lib/njParse.ts
  const loadPlaceholderModel = (
    textures: THREE.Texture[],
  ): NJMesh => {
    console.log("Using placeholder model until njParse.ts is implemented");
    
    // Create a simple cube geometry
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    geometry.computeVertexNormals();
    
    // Create dummy bones for the placeholder
    const bones: THREE.Bone[] = [];
    const rootBone = new THREE.Bone();
    rootBone.position.set(0, 0, 0);
    bones.push(rootBone);
    
    const childBone = new THREE.Bone();
    childBone.position.set(0, 1, 0);
    rootBone.add(childBone);
    bones.push(childBone);
    
    // Create material
    const materials: THREE.Material[] = [];
    
    if (textures.length > 0) {
      // Use the loaded textures if available
      textures.forEach((texture) => {
        const material = new THREE.MeshStandardMaterial({
          map: texture,
          metalness: 0.2,
          roughness: 0.8,
          skinning: true,
          transparent: true,
        });
        materials.push(material);
      });
    } else {
      // Fallback to basic colored material
      materials.push(
        new THREE.MeshStandardMaterial({
          color: 0x44aaff,
          metalness: 0.2,
          roughness: 0.8,
          wireframe: false,
          skinning: true,
          transparent: true,
        }),
      );
    }
    
    return {
      id: 1,
      bones,
      skeleton: new THREE.Skeleton(bones),
      vertices: 8,
      polygons: 12,
      geometry,
      materials,
    };
  };

  // Component to render and animate the model
  const Model: React.FC<{ mesh: NJMesh }> = ({ mesh }) => {
    const modelRef = useRef<THREE.SkinnedMesh>(null);

    // Animation
    useFrame((state) => {
      if (modelRef.current) {
        modelRef.current.rotation.y += 0.005;
      }
    });

    return (
      <skinnedMesh
        ref={modelRef}
        geometry={mesh.geometry}
        material={mesh.materials}
        skeleton={mesh.skeleton}
      >
        {mesh.bones.map((bone, i) => (
          <primitive key={i} object={bone} />
        ))}
      </skinnedMesh>
    );
  };

  // Create a placeholder mesh even while loading - this avoids the "Loading..." message
  // that might not render correctly due to client/server hydration issues
  const placeholderMesh = React.useMemo(() => {
    if (!loading && !error && mesh) return null;

    // Create a minimal placeholder
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshBasicMaterial({
      color: 0x888888,
      wireframe: true,
    });

    const bones: THREE.Bone[] = [];
    const rootBone = new THREE.Bone();
    rootBone.position.set(0, 0, 0);
    bones.push(rootBone);

    return {
      id: 0,
      bones,
      skeleton: new THREE.Skeleton(bones),
      vertices: 8,
      polygons: 12,
      geometry,
      materials: [material],
    } as NJMesh;
  }, [loading, error, mesh]);

  if (error) {
    console.error(`Error in NJViewer: ${error}`);
    return (
      <div
        className="nj-viewer-canvas border border-gray-300 rounded-md overflow-hidden"
        style={{ width, height }}
      >
        <Canvas camera={{ position: [0, 2, 5], fov: 50 }}>
          <ambientLight intensity={0.5} />
          <pointLight position={[10, 10, 10]} intensity={1} />
          <pointLight position={[-10, -10, -10]} intensity={0.5} color="#8080ff" />
          <Model mesh={placeholderMesh!} />
          <OrbitControls />
          <gridHelper args={[10, 10]} />
          <axesHelper args={[5]} />
          <Stats />
        </Canvas>
        <div className="error-overlay absolute top-0 left-0 w-full h-full flex items-center justify-center bg-red-500 bg-opacity-50 text-white font-bold p-4 text-center">
          Error: {error}
        </div>
      </div>
    );
  }

  return (
    <div className="nj-viewer-container">
      <h2 className="text-xl font-bold mb-4">
        3D Model: {modelPath.split("/").pop()}
      </h2>

      {/* Always render the 3D viewer first */}
      <div
        className="nj-viewer-canvas border border-gray-300 rounded-md overflow-hidden relative"
        style={{ width, height }}
      >
        <Canvas camera={{ position: [0, 2, 5], fov: 50 }}>
          <ambientLight intensity={0.5} />
          <pointLight position={[10, 10, 10]} intensity={1} />
          <pointLight position={[-10, -10, -10]} intensity={0.5} color="#8080ff" />
          <Model mesh={mesh || placeholderMesh!} />
          <OrbitControls />
          <gridHelper args={[10, 10]} />
          <axesHelper args={[5]} />
          <Stats />
        </Canvas>

        {/* Loading overlay */}
        {loading && (
          <div className="loading-overlay absolute top-0 left-0 w-full h-full flex items-center justify-center bg-black bg-opacity-30 text-white font-bold">
            Loading...
          </div>
        )}
      </div>

      {/* Metadata section */}
      {metaData && (
        <div className="nj-metadata py-4">
          <h3 className="text-lg font-semibold mb-2">Model Information</h3>
          <table className="w-full border-collapse mb-4 text-sm">
            <tbody>
              <tr className="border-b border-gray-200">
                <td className="py-2 pr-4 font-medium">Format:</td>
                <td className="py-2">{metaData.magic}</td>
              </tr>
              <tr className="border-b border-gray-200">
                <td className="py-2 pr-4 font-medium">Bones:</td>
                <td className="py-2">{metaData.bones}</td>
              </tr>
              <tr className="border-b border-gray-200">
                <td className="py-2 pr-4 font-medium">Vertices:</td>
                <td className="py-2">{metaData.vertices}</td>
              </tr>
              <tr className="border-b border-gray-200">
                <td className="py-2 pr-4 font-medium">Polygons:</td>
                <td className="py-2">{metaData.polygons}</td>
              </tr>
              <tr className="border-b border-gray-200">
                <td className="py-2 pr-4 font-medium">Textures:</td>
                <td className="py-2">{textures.length} loaded</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* Texture previews */}
      {textures.length > 0 && (
        <div className="texture-list mt-4">
          <h3 className="text-lg font-semibold mb-2">Textures</h3>
          <div className="flex flex-wrap gap-4">
            {textures.map((texture, index) => (
              <div
                key={index}
                className="texture-preview border border-gray-300 p-2"
              >
                <div className="texture-name text-sm mb-1">{texture.name}</div>
                <canvas
                  width={128}
                  height={128}
                  ref={(canvas) => {
                    if (canvas) {
                      const ctx = canvas.getContext("2d");
                      if (ctx && texture instanceof THREE.CanvasTexture) {
                        ctx.drawImage(texture.image, 0, 0, 128, 128);
                      }
                    }
                  }}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default NJViewer;
