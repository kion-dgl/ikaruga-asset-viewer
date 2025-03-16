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

        console.log("model loaded");

        const arrayBuffer = await response.arrayBuffer();
        const dataView = new DataView(arrayBuffer);

        // Check magic (NJTL, NJCM, etc)
        const magic = String.fromCharCode(
          dataView.getUint8(0),
          dataView.getUint8(1),
          dataView.getUint8(2),
          dataView.getUint8(3),
        );
        console.log(`Model magic: ${magic}`);

        // Basic header info for display
        const header: NJHeader = {
          magic,
          dataSize: dataView.getUint32(4, true),
          bones: 0, // To be calculated during parsing
          vertices: 0,
          polygons: 0,
        };

        // For now, always create a placeholder model instead of trying to parse
        // the actual NJ data which will require a more complete implementation
        const parsedModel = parseNinjaModelData(dataView, textures);

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
        console.error("Error parsing NJ model:", err);
        setError(err instanceof Error ? err.message : "Failed to parse model");
        setLoading(false);
      }
    };

    parseNinjaModel();
  }, [modelPath, textures]);

  // Parse Ninja Model data 
  const parseNinjaModelData = (
    dataView: DataView,
    textures: THREE.Texture[],
  ): NJMesh => {
    try {
      // Parse the Ninja model format
      const magic = String.fromCharCode(
        dataView.getUint8(0),
        dataView.getUint8(1),
        dataView.getUint8(2),
        dataView.getUint8(3)
      );
      
      console.log(`Processing NJ model with format: ${magic}`);
      
      // Check if this is a valid Ninja model
      if (magic !== 'NJTL' && magic !== 'NJCM' && magic !== 'NJBM') {
        console.warn(`Unknown NJ format: ${magic}, attempting to parse anyway`);
      }
    
    let offset = 8; // Skip header and size
    
    // Process any texture list if present (NJTL format)
    if (magic === 'NJTL') {
      const textureListCount = dataView.getUint16(offset, true);
      offset += 2;
      console.log(`Texture list contains ${textureListCount} textures`);
      
      // Skip texture list data for now - we're using externally loaded textures
      // Each texture entry has name (16 bytes) + attributes (4 bytes)
      offset += textureListCount * 20;
      
      // Check for another chunk after texture list
      if (offset + 4 <= dataView.byteLength) {
        const nextMagic = String.fromCharCode(
          dataView.getUint8(offset),
          dataView.getUint8(offset+1),
          dataView.getUint8(offset+2),
          dataView.getUint8(offset+3)
        );
        
        if (nextMagic === 'NJCM' || nextMagic === 'NJBM') {
          console.log(`Found model data after texture list: ${nextMagic}`);
          offset += 8; // Skip header and size of model chunk
        }
      }
    }
    
    // Extract vertex data
    const vertexCount = dataView.getUint16(offset, true);
    offset += 2;
    console.log(`Vertex count: ${vertexCount}`);
    
    // Sanity check for reasonable vertex count
    if (vertexCount <= 0 || vertexCount > 10000) {
      console.warn(`Unusual vertex count: ${vertexCount}, might indicate parsing error`);
    }
    
    // Create arrays for vertex data
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    
    // Parse vertex data
    for (let i = 0; i < vertexCount; i++) {
      // Position (XYZ)
      const x = dataView.getFloat32(offset, true);
      offset += 4;
      const y = dataView.getFloat32(offset, true);
      offset += 4;
      const z = dataView.getFloat32(offset, true);
      offset += 4;
      
      positions.push(x, y, z);
      
      // Normal (XYZ) - handle case where normals might not be included
      if (magic === 'NJCM' || magic === 'NJBM') {
        const nx = dataView.getFloat32(offset, true);
        offset += 4;
        const ny = dataView.getFloat32(offset, true);
        offset += 4;
        const nz = dataView.getFloat32(offset, true);
        offset += 4;
        
        normals.push(nx, ny, nz);
      } else {
        // Generate default normal
        normals.push(0, 1, 0);
      }
      
      // UV coordinates - handle cases where UVs might not be included
      if (offset + 8 <= dataView.byteLength) {
        const u = dataView.getFloat32(offset, true);
        offset += 4;
        const v = dataView.getFloat32(offset, true);
        offset += 4;
        
        uvs.push(u, v);
      } else {
        // Generate default UVs
        uvs.push(0, 0);
      }
    }
    
    // Parse triangle data
    const triCount = dataView.getUint16(offset, true);
    offset += 2;
    console.log(`Triangle count: ${triCount}`);
    
    const indices: number[] = [];
    const materialIndices: number[] = [];
    
    // Parse triangle indices
    for (let i = 0; i < triCount; i++) {
      // Each triangle has 3 vertex indices
      const a = dataView.getUint16(offset, true);
      offset += 2;
      const b = dataView.getUint16(offset, true);
      offset += 2;
      const c = dataView.getUint16(offset, true);
      offset += 2;
      
      indices.push(a, b, c);
      
      // Try to read material or texture index if available
      // Some formats have material/texture info after triangle vertices
      if (offset + 2 <= dataView.byteLength && i === 0) {
        try {
          const materialIndex = dataView.getUint16(offset, true);
          // Don't increment offset here - just peeking to check format
          
          // Store for later if in a reasonable range
          if (materialIndex < 100) {
            materialIndices.push(materialIndex);
          }
        } catch (e) {
          // Ignore errors when peeking
        }
      }
    }
    
    // Create Three.js geometry
    const geometry = new THREE.BufferGeometry();
    
    // Add attributes
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    
    if (normals.length > 0) {
      geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    } else {
      geometry.computeVertexNormals();
    }
    
    if (uvs.length > 0) {
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    }
    
    // Add indices
    if (indices.length > 0) {
      geometry.setIndex(indices);
    }
    
    // Parse bone data if present
    const bones: THREE.Bone[] = [];
    let boneCount = 0;
    
    // Try to parse bone hierarchy if format supports it and offset is still within range
    if (magic === 'NJBM' && offset + 2 <= dataView.byteLength) {
      boneCount = dataView.getUint16(offset, true);
      offset += 2;
      console.log(`Bone count: ${boneCount}`);
      
      // Root bone
      const rootBone = new THREE.Bone();
      rootBone.position.set(0, 0, 0);
      bones.push(rootBone);
      
      // Parse child bones
      for (let i = 1; i < boneCount; i++) {
        const parentIndex = dataView.getUint16(offset, true);
        offset += 2;
        
        const x = dataView.getFloat32(offset, true);
        offset += 4;
        const y = dataView.getFloat32(offset, true);
        offset += 4;
        const z = dataView.getFloat32(offset, true);
        offset += 4;
        
        const bone = new THREE.Bone();
        bone.position.set(x, y, z);
        
        // Add to parent
        if (parentIndex < bones.length) {
          bones[parentIndex].add(bone);
        } else {
          console.warn(`Invalid parent index: ${parentIndex} for bone ${i}`);
          rootBone.add(bone);
        }
        
        bones.push(bone);
      }
    } else {
      // Create default bones if not present in file
      const rootBone = new THREE.Bone();
      rootBone.position.set(0, 0, 0);
      bones.push(rootBone);
      
      const childBone = new THREE.Bone();
      childBone.position.set(0, 1, 0);
      rootBone.add(childBone);
      bones.push(childBone);
      
      boneCount = 2;
    }
    
    // Create materials
    const materials: THREE.Material[] = [];
    
    if (textures.length > 0) {
      // Use the loaded textures
      textures.forEach((texture, index) => {
        // Check if we have material/color info
        // For now, we'll use some predefined colors
        const colors = [
          0xffffff, // white
          0xff8888, // light red
          0x88ff88, // light green
          0x8888ff, // light blue
          0xffff88, // light yellow
        ];
        
        const materialColor = colors[index % colors.length];
        
        const material = new THREE.MeshStandardMaterial({
          map: texture,
          color: materialColor,
          metalness: 0.2,
          roughness: 0.8,
          skinning: true,
          transparent: true,
        });
        materials.push(material);
      });
    } else {
      // Create some default colored materials
      const defaultColors = [0x44aaff, 0xff6644, 0x88cc33, 0xffcc22];
      
      // Use material indices if available, otherwise create one default material
      if (materialIndices.length > 0) {
        materialIndices.forEach((matIndex) => {
          materials.push(
            new THREE.MeshStandardMaterial({
              color: defaultColors[matIndex % defaultColors.length],
              metalness: 0.2,
              roughness: 0.8,
              wireframe: false,
              skinning: true,
              transparent: true,
            }),
          );
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
    }
    
    console.log(`Successfully parsed model with ${vertexCount} vertices, ${triCount} triangles, and ${boneCount} bones`);
    
    return {
      id: 1,
      bones,
      skeleton: new THREE.Skeleton(bones),
      vertices: vertexCount,
      polygons: triCount,
      geometry,
      materials,
    };
    
    } catch (error) {
      console.error("Error parsing NJ model:", error);
      
      // Create a fallback cube model in case of error
      console.warn("Using fallback cube model");
      
      const geometry = new THREE.BoxGeometry(1, 1, 1);
      geometry.computeVertexNormals();
      
      // Create dummy bones
      const bones: THREE.Bone[] = [];
      const rootBone = new THREE.Bone();
      rootBone.position.set(0, 0, 0);
      bones.push(rootBone);
      
      const childBone = new THREE.Bone();
      childBone.position.set(0, 1, 0);
      rootBone.add(childBone);
      bones.push(childBone);
      
      // Create fallback material
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
        // Fallback to basic colored material with wireframe
        materials.push(
          new THREE.MeshStandardMaterial({
            color: 0xff4444, // Red to indicate error
            metalness: 0.2,
            roughness: 0.8,
            wireframe: true,
            skinning: true,
            transparent: true,
          }),
        );
      }
      
      return {
        id: 0,
        bones,
        skeleton: new THREE.Skeleton(bones),
        vertices: 8,  // 8 vertices in a cube
        polygons: 12, // 12 triangles in a cube (2 per face × 6 faces)
        geometry,
        materials,
      };
    }
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
