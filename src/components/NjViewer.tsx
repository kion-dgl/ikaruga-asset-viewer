import React, { useState, useEffect, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Stats } from "@react-three/drei";
import * as THREE from "three";
import { parsePvr } from "../lib/parsePvr";

interface NJHeader {
  magic: string;
  dataSize: number;
  bones: number;
  vertices: number;
  polygons: number;
}

interface NJMesh {
  id: number;
  bones: THREE.Bone[];
  skeleton: THREE.Skeleton;
  vertices: number;
  polygons: number;
  geometry: THREE.BufferGeometry;
  materials: THREE.Material[];
}

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
            const canvas = document.createElement('canvas');
            canvas.width = imageData.width;
            canvas.height = imageData.height;
            
            const context = canvas.getContext('2d');
            if (context) {
              context.putImageData(imageData, 0, 0);
              
              const texture = new THREE.CanvasTexture(canvas);
              texture.flipY = false; // PVR textures don't need to be flipped
              texture.name = texturePath.split('/').pop() || '';
              
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
    const parseNinjaModel = async () => {
      setLoading(true);
      setError(null);
      
      try {
        console.log(`Loading model: ${modelPath}`);
        // Fetch the NJ file
        const response = await fetch(`/iso/${modelPath}`);
        if (!response.ok) {
          throw new Error(`Failed to load model: ${response.statusText}`);
        }
        
        const arrayBuffer = await response.arrayBuffer();
        const dataView = new DataView(arrayBuffer);
        
        // Check magic (NJTL, NJCM, etc)
        const magic = String.fromCharCode(
          dataView.getUint8(0),
          dataView.getUint8(1),
          dataView.getUint8(2),
          dataView.getUint8(3)
        );
        console.log(`Model magic: ${magic}`);
        
        // Basic header info for display
        const header: NJHeader = {
          magic,
          dataSize: dataView.getUint32(4, true),
          bones: 0,  // To be calculated during parsing
          vertices: 0,
          polygons: 0
        };
        
        // For now, always create a placeholder model instead of trying to parse
        // the actual NJ data which will require a more complete implementation
        const parsedModel = parseNinjaModelData(dataView, textures);
        
        header.bones = parsedModel.bones.length;
        header.vertices = parsedModel.vertices;
        header.polygons = parsedModel.polygons;
        
        console.log(`Model loaded with ${header.vertices} vertices and ${header.bones} bones`);
        
        setMetaData(header);
        setMesh(parsedModel);
        setLoading(false);
      } catch (err) {
        console.error("Error parsing NJ model:", err);
        setError(err instanceof Error ? err.message : "Failed to parse model");
        setLoading(false);
      }
    };
    
    parseNinjaModel();
  }, [modelPath, textures]);

  // Placeholder function - this would need a full implementation based on the Ninja format
  const parseNinjaModelData = (dataView: DataView, textures: THREE.Texture[]): NJMesh => {
    // This is a simplified placeholder implementation
    // In a real implementation, you would:
    // 1. Parse the model headers
    // 2. Extract bone hierarchy
    // 3. Read vertices, normals, UVs
    // 4. Parse material definitions
    // 5. Create THREE.js geometries, materials, and skinned mesh
    
    // Create placeholder geometry
    const geometry = new THREE.BufferGeometry();
    
    // Add a cube as placeholder
    const vertices = new Float32Array([
      // Front face
      -1, -1,  1,
       1, -1,  1,
       1,  1,  1,
      -1,  1,  1,
      // Back face
      -1, -1, -1,
      -1,  1, -1,
       1,  1, -1,
       1, -1, -1,
      // Top face
      -1,  1, -1,
      -1,  1,  1,
       1,  1,  1,
       1,  1, -1,
      // Bottom face
      -1, -1, -1,
       1, -1, -1,
       1, -1,  1,
      -1, -1,  1,
      // Right face
       1, -1, -1,
       1,  1, -1,
       1,  1,  1,
       1, -1,  1,
      // Left face
      -1, -1, -1,
      -1, -1,  1,
      -1,  1,  1,
      -1,  1, -1,
    ]);
    
    const indices = [
      0, 1, 2,    0, 2, 3,    // front
      4, 5, 6,    4, 6, 7,    // back
      8, 9, 10,   8, 10, 11,  // top
      12, 13, 14, 12, 14, 15, // bottom
      16, 17, 18, 16, 18, 19, // right
      20, 21, 22, 20, 22, 23  // left
    ];
    
    // Add UVs
    const uvs = new Float32Array([
      0, 0,  1, 0,  1, 1,  0, 1, // front
      0, 0,  1, 0,  1, 1,  0, 1, // back
      0, 0,  1, 0,  1, 1,  0, 1, // top
      0, 0,  1, 0,  1, 1,  0, 1, // bottom
      0, 0,  1, 0,  1, 1,  0, 1, // right
      0, 0,  1, 0,  1, 1,  0, 1  // left
    ]);
    
    geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
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
    
    // Create materials
    const materials: THREE.Material[] = [];
    
    if (textures.length > 0) {
      // Use the loaded textures if available
      textures.forEach(texture => {
        const material = new THREE.MeshBasicMaterial({
          map: texture,
          skinning: true,
          transparent: true
        });
        materials.push(material);
      });
    } else {
      // Fallback to basic colored materials
      materials.push(
        new THREE.MeshBasicMaterial({
          color: 0x44aaff,
          wireframe: false,
          skinning: true,
          transparent: true
        })
      );
    }
    
    return {
      id: 1,
      bones,
      skeleton: new THREE.Skeleton(bones),
      vertices: vertices.length / 3,
      polygons: indices.length / 3,
      geometry,
      materials
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
    const material = new THREE.MeshBasicMaterial({ color: 0x888888, wireframe: true });
    
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
      materials: [material]
    } as NJMesh;
  }, [loading, error, mesh]);
  
  if (error) {
    console.error(`Error in NJViewer: ${error}`);
    return (
      <div className="nj-viewer-canvas border border-gray-300 rounded-md overflow-hidden" style={{ width, height }}>
        <Canvas camera={{ position: [0, 2, 5], fov: 50 }}>
          <ambientLight intensity={0.5} />
          <pointLight position={[10, 10, 10]} intensity={1} />
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
              <div key={index} className="texture-preview border border-gray-300 p-2">
                <div className="texture-name text-sm mb-1">{texture.name}</div>
                <canvas
                  width={128}
                  height={128}
                  ref={(canvas) => {
                    if (canvas) {
                      const ctx = canvas.getContext('2d');
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