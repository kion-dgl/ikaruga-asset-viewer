import {
  Bone,
  Vector3,
  Euler,
  Quaternion,
  Matrix3,
  Matrix4,
  BufferGeometry,
  BufferAttribute,
  SkinnedMesh,
  MeshBasicMaterial,
  Material,
  DoubleSide,
} from "three";
import ByteReader from "bytereader";

interface MaterialOptions {
  texId: number;
  blending: boolean;
  doubleSide: boolean;
}

interface Vertex {
  position: Vector3;
  normal?: Vector3;
  color?: {
    r: number;
    g: number;
    b: number;
    a: number;
  };
  uv?: {
    x: number;
    y: number;
  };
  skinIndices?: number[];
  skinWeights?: number[];
  globalIndex?: number;
}

class NinjaModel {
  private reader: ByteReader;
  private bones: Bone[];
  private vertices: number[] = [];
  private normals: number[] = [];
  private colors: number[] = [];
  private uvs: number[] = [];
  private skinIndices: number[] = [];
  private skinWeights: number[] = [];
  private indices: number[] = [];
  private materialIndices: number[] = [];
  private materials: MaterialOptions[] = [];
  private vertexStack: Vertex[] = [];
  private memStack: number[] = [];
  private currentBone: Bone | null = null;
  private currentMaterial: MaterialOptions = {
    texId: -1,
    blending: false,
    doubleSide: false,
  };
  private currentColor = { r: 1, g: 1, b: 1, a: 1 };
  private flipV: boolean = false;

  constructor(reader: ByteReader) {
    this.reader = reader;
    this.bones = [];
  }

  readVector3() {
    const x = this.reader.readFloat();
    const y = this.reader.readFloat();
    const z = this.reader.readFloat();
    return new Vector3(x, y, z);
  }

  readRotation(isZxy: boolean) {
    const ratio = (2 * Math.PI) / 0xffff;
    const x = this.reader.readInt32() * ratio;
    const y = this.reader.readInt32() * ratio;
    const z = this.reader.readInt32() * ratio;
    return isZxy ? new Euler(z, x, y) : new Euler(x, y, z);
  }

  readQuaternion() {
    const x = this.reader.readFloat();
    const y = this.reader.readFloat();
    const z = this.reader.readFloat();
    const w = this.reader.readFloat();
    return new Quaternion(x, y, z, w);
  }

  readColor() {
    const b = this.reader.readUInt8() / 255;
    const g = this.reader.readUInt8() / 255;
    const r = this.reader.readUInt8() / 255;
    const a = this.reader.readUInt8() / 255;
    return { r, g, b, a };
  }

  isBitFlagSet(value: number, bit: number): boolean {
    return (value & (1 << bit)) !== 0;
  }

  getBitMask(value: number, bits: number[]): number {
    let result = 0;
    for (let i = 0; i < bits.length; i++) {
      const bit = bits[i];
      if (this.isBitFlagSet(value, bit)) {
        result |= 1 << i;
      }
    }
    return result;
  }

  readBone(parentBone?: Bone) {
    // Read bone structure
    const boneOffset = this.reader.tell();
    const flags = this.reader.readUInt32();
    const chunkOfs = this.reader.readUInt32();
    const pos = this.readVector3();

    // Euler rotation
    const rot = this.readRotation(this.isBitFlagSet(flags, 5));
    const scl = this.readVector3();
    const childOfs = this.reader.readUInt32();
    const siblingOfs = this.reader.readUInt32();

    // Create new bone
    const bone = new Bone();
    bone.name = `bone_${this.bones.length.toString().padStart(3, "0")}`;
    this.bones.push(bone);
    this.currentBone = bone;

    // Apply scale if not ignoring scale
    if (!this.isBitFlagSet(flags, 2)) {
      bone.scale.copy(scl);
    }

    // Apply rotation if not ignoring rotation
    if (!this.isBitFlagSet(flags, 1)) {
      // Euler rotation
      bone.rotation.copy(rot);
    }

    // Apply position if not ignoring position
    if (!this.isBitFlagSet(flags, 0)) {
      bone.position.copy(pos);
    }

    // Update matrices
    bone.updateMatrix();
    bone.updateWorldMatrix(true, true);

    // If parent bone exists, add this bone as a child
    if (parentBone) {
      parentBone.add(bone);
      bone.updateMatrix();
      bone.updateWorldMatrix(true, true);
    }

    // If there's a chunk for this bone, process it
    if (chunkOfs) {
      const currentPos = this.reader.tell();
      this.reader.seek(chunkOfs);

      console.log("Seeking to submesh definition: 0x%s", chunkOfs.toString(16));
      const vertexOfs = this.reader.readUInt32();
      const stripOfs = this.reader.readUInt32();

      if (vertexOfs) {
        console.log(
          "READING CHUNK VERTEX LIST AT: 0x%s",
          vertexOfs.toString(16),
        );
        this.reader.seek(vertexOfs);
        this.readChunk();
      }

      // if (stripOfs) {
      //   this.reader.seek(stripOfs);
      //   this.readChunk();
      // }

      this.reader.seek(currentPos);
    }

    // Process child and sibling bones if needed
    if (childOfs) {
      const currentPos = this.reader.tell();
      this.reader.seek(childOfs);
      this.readBone(bone);
      this.reader.seek(currentPos);
    }

    if (siblingOfs) {
      const currentPos = this.reader.tell();
      this.reader.seek(siblingOfs);
      this.readBone(parentBone);
      this.reader.seek(currentPos);
    }

    return bone;
  }

  readChunk() {
    const NJD_NULLOFF = 0x00;
    const NJD_BITSOFF = 0x01;
    const NJD_TINYOFF = 0x08;
    const NJD_MATOFF = 0x10;
    const NJD_VERTOFF = 0x20;
    const NJD_VOLOFF = 0x38;
    const NJD_STRIPOFF = 0x40;
    const NJD_ENDOFF = 0xff;

    this.currentMaterial = {
      texId: -1,
      blending: false,
      doubleSide: false,
    };

    this.currentColor = {
      r: 1,
      g: 1,
      b: 1,
      a: 1,
    };

    let chunk;

    do {
      const head = this.reader.readUInt8();
      const flag = this.reader.readUInt8();
      chunk = { head, flag };

      // Invalid Chunk
      if (chunk.head > NJD_STRIPOFF + 11) {
        continue;
      }

      // Strip Chunk
      if (chunk.head >= NJD_STRIPOFF) {
        this.readStripChunk(chunk);
        continue;
      }

      // Volume Chunk
      if (chunk.head >= NJD_VOLOFF) {
        throw new Error("Volume chunk not implemented");
      }

      // Vertex Chunk
      if (chunk.head >= NJD_VERTOFF) {
        console.log("Reading Vertex Chunk!!!");
        this.readVertexChunk(chunk);
        continue;
      }

      // Material Chunk
      if (chunk.head >= NJD_MATOFF) {
        this.readMaterialChunk(chunk);
        continue;
      }

      // Tiny Chunk
      if (chunk.head >= NJD_TINYOFF) {
        this.readTinyChunk(chunk);
        continue;
      }

      // Bits Chunk
      if (chunk.head >= NJD_BITSOFF) {
        this.readBitsChunk(chunk);
        continue;
      }
    } while (chunk.head !== NJD_ENDOFF);

    // Process memory stack if needed
    if (this.memStack && this.memStack.length) {
      const offset = this.memStack.pop();
      if (offset !== undefined) {
        this.reader.seek(offset);
        this.readChunk();
      }
    }
  }

  readBitsChunk(chunk: { head: number; flag: number }) {
    switch (chunk.head) {
      case 1:
        const dstAlpha = this.getBitMask(chunk.flag, [0, 1, 2]);
        const srcAlpha = this.getBitMask(chunk.flag, [3, 4, 5]);

        if (srcAlpha === 4 && dstAlpha === 1) {
          this.currentMaterial.blending = true;
        } else {
          this.currentMaterial.blending = false;
        }
        break;

      case 2:
        const mipmapDepth = chunk.flag & 0x0f;
        break;

      case 3:
        const specularCoef = chunk.flag & 0x1f;
        break;

      case 4:
        // Store offset for later
        const storeOffset = this.reader.tell() + chunk.flag;
        break;

      case 5:
        // Push current position to memory stack and restore a previously stored offset
        this.memStack = this.memStack || [];
        this.memStack.push(this.reader.tell());
        this.reader.seekRel(chunk.flag);
        break;
    }
  }

  readTinyChunk(chunk: { head: number; flag: number }) {
    const tinyChunk = this.reader.readUInt16();
    const textureId = tinyChunk & 0x1fff;

    this.currentMaterial.texId = textureId;

    const superSample = this.isBitFlagSet(tinyChunk, 13);
    const filterMode = this.getBitMask(tinyChunk, [14, 15]);

    const clampU = this.isBitFlagSet(chunk.head, 4);
    const clampV = this.isBitFlagSet(chunk.head, 5);
    const flipU = this.isBitFlagSet(chunk.head, 6);
    const flipV = this.isBitFlagSet(chunk.head, 7);

    this.flipV = flipV;
  }

  readMaterialChunk(chunk: { head: number; flag: number }) {
    const length = this.reader.readUInt16();

    // Alpha Blending Instructions
    const dstAlpha = this.getBitMask(chunk.flag, [0, 1, 2]);
    const srcAlpha = this.getBitMask(chunk.flag, [3, 4, 5]);

    if (srcAlpha === 4 && dstAlpha === 1) {
      this.currentMaterial.blending = true;
    } else {
      this.currentMaterial.blending = false;
    }

    // Diffuse color
    if (this.isBitFlagSet(chunk.head, 0)) {
      this.currentColor = this.readColor();
    }

    // Specular
    if (this.isBitFlagSet(chunk.head, 1)) {
      const specular = this.readColor();
      // Could store this for material later
    }

    // Ambient
    if (this.isBitFlagSet(chunk.head, 2)) {
      const ambient = this.readColor();
      // Could store this for material later
    }
  }

  readVertexChunk(chunk: { head: number; flag: number }) {
    const length = this.reader.readUInt16();

    // Read index offset and count
    const indexOffset = this.reader.readUInt16();
    const vertexCount = this.reader.readUInt16();
    console.log("Index: %d", indexOffset);
    console.log("Vertex Cound: %s", vertexCount);

    // Read vertices
    for (let i = 0; i < vertexCount; i++) {
      const stackIndex = indexOffset + i;

      // Read position
      const position = this.readVector3();
      const vertex: Vertex = { position };

      // Transform by bone matrix
      if (this.currentBone) {
        const worldPos = position
          .clone()
          .applyMatrix4(this.currentBone.matrixWorld);
        vertex.position = worldPos;
      }

      // Read normal if present
      if (chunk.head > 0x28 && chunk.head < 0x30) {
        const normal = this.readVector3();
        // Transform normal by bone matrix
        if (this.currentBone) {
          // For normals, we need to use the normal matrix (inverse transpose of the world matrix)
          const normalMatrix = new Matrix3().getNormalMatrix(
            this.currentBone.matrixWorld,
          );
          const worldNormal = normal.clone().applyMatrix3(normalMatrix);
          // Normalize to ensure unit length after transformation
          worldNormal.normalize();
          vertex.normal = worldNormal;
        } else {
          vertex.normal = normal;
        }
      }

      // Read vertex color if present
      if (chunk.head === 0x23 || chunk.head === 0x2a) {
        vertex.color = this.readColor();
      }

      // Setup skinning weights
      const skinIndices = [0, 0, 0, 0];
      const skinWeights = [0, 0, 0, 0];

      if (chunk.head !== 0x2c) {
        // Simple bone weighting
        skinIndices[0] = this.bones.length - 1;
        skinWeights[0] = 1.0;
      } else {
        console.log("OMG WE HAVE SUB WEIGHTS!!!!!");
        // Read weight values
        const offset = this.reader.readUInt16();
        const weight = this.reader.readUInt16();

        // Update stack index
        const stackPos = indexOffset + offset;

        // Get existing weights if available
        if (this.vertexStack[stackPos]) {
          const prev = this.vertexStack[stackPos];
          if (prev.skinIndices && prev.skinWeights) {
            skinIndices[0] = prev.skinIndices[0] || 0;
            skinIndices[1] = prev.skinIndices[1] || 0;
            skinIndices[2] = prev.skinIndices[2] || 0;

            skinWeights[0] = prev.skinWeights[0] || 0;
            skinWeights[1] = prev.skinWeights[1] || 0;
            skinWeights[2] = prev.skinWeights[2] || 0;
          }
        }

        // Set weights based on flag
        switch (chunk.flag) {
          case 0x80:
            skinIndices[0] = this.bones.length - 1;
            skinWeights[0] = weight / 255;
            break;
          case 0x81:
            skinIndices[1] = this.bones.length - 1;
            skinWeights[1] = weight / 255;
            break;
          case 0x82:
            skinIndices[2] = this.bones.length - 1;
            skinWeights[2] = weight / 255;
            break;
        }
      }

      vertex.skinIndices = skinIndices;
      vertex.skinWeights = skinWeights;
      vertex.globalIndex = this.vertexStack.length;

      this.vertexStack[stackIndex] = vertex;
    }
  }

  getMaterialIndex(): number {
    // Check if material already exists
    for (let i = 0; i < this.materials.length; i++) {
      const mat = this.materials[i];
      if (
        mat.texId === this.currentMaterial.texId &&
        mat.blending === this.currentMaterial.blending &&
        mat.doubleSide === this.currentMaterial.doubleSide
      ) {
        return i;
      }
    }

    // If not, create a new material
    const materialIndex = this.materials.length;
    this.materials.push({
      texId: this.currentMaterial.texId,
      blending: this.currentMaterial.blending,
      doubleSide: this.currentMaterial.doubleSide,
    });

    return materialIndex;
  }

  readStripChunk(chunk: { head: number; flag: number }) {
    const length = this.reader.readUInt16();

    // Read strip info
    const stripInfo = this.reader.readUInt16();
    const stripCount = stripInfo & 0x3fff;
    const userOffset = this.getBitMask(stripInfo, [14, 15]);

    this.currentMaterial.doubleSide = this.isBitFlagSet(chunk.flag, 4);
    const materialIndex = this.getMaterialIndex();

    // Process strips
    for (let stripIdx = 0; stripIdx < stripCount; stripIdx++) {
      // Read strip length
      const rawLength = this.reader.readInt16();
      const clockwise = rawLength < 0;
      const stripLength = Math.abs(rawLength);

      const strip = new Array(stripLength);

      // Read each vertex in the strip
      for (let vertIdx = 0; vertIdx < stripLength; vertIdx++) {
        const stackIndex = this.reader.readUInt16();

        if (!this.vertexStack[stackIndex]) {
          throw new Error(`Vertex ${stackIndex} not found in vertex stack`);
        }

        strip[vertIdx] = {
          vertex: this.vertexStack[stackIndex],
          uv: { x: 0, y: 0 },
        };

        // Read UVs if present
        if (chunk.head === 0x41) {
          const u = this.reader.readInt16() / 255;
          const v = this.flipV
            ? this.reader.readInt16() / 255
            : 1 - this.reader.readInt16() / 255;
          strip[vertIdx].uv = { x: u, y: v };
        } else if (chunk.head === 0x42) {
          const u = this.reader.readInt16() / 1023;
          const v = this.flipV
            ? this.reader.readInt16() / 1023
            : 1 - this.reader.readInt16() / 1023;
          strip[vertIdx].uv = { x: u, y: v };
        }

        // Skip user offset data
        if (userOffset && vertIdx > 1) {
          this.reader.seekRel(userOffset * 2);
        }
      }

      // Convert strip to triangles
      for (let i = 0; i < stripLength - 2; i++) {
        let a, b, c;

        if ((clockwise && !(i % 2)) || (!clockwise && i % 2)) {
          a = strip[i + 0];
          b = strip[i + 2];
          c = strip[i + 1];
        } else {
          a = strip[i + 0];
          b = strip[i + 1];
          c = strip[i + 2];
        }

        // Skip degenerate triangles
        if (!a.vertex || !b.vertex || !c.vertex) continue;

        // Store material index
        this.materialIndices.push(materialIndex);

        // Add vertices
        this.vertices.push(
          a.vertex.position.x,
          a.vertex.position.y,
          a.vertex.position.z,
          b.vertex.position.x,
          b.vertex.position.y,
          b.vertex.position.z,
          c.vertex.position.x,
          c.vertex.position.y,
          c.vertex.position.z,
        );

        // Add normals if present
        if (a.vertex.normal && b.vertex.normal && c.vertex.normal) {
          this.normals.push(
            a.vertex.normal.x,
            a.vertex.normal.y,
            a.vertex.normal.z,
            b.vertex.normal.x,
            b.vertex.normal.y,
            b.vertex.normal.z,
            c.vertex.normal.x,
            c.vertex.normal.y,
            c.vertex.normal.z,
          );
        }

        // Add colors
        const aColor = a.vertex.color || this.currentColor;
        const bColor = b.vertex.color || this.currentColor;
        const cColor = c.vertex.color || this.currentColor;

        // Make sure alpha is at least 0.3
        const aAlpha = aColor.a < 0.3 ? 0.3 : aColor.a;
        const bAlpha = bColor.a < 0.3 ? 0.3 : bColor.a;
        const cAlpha = cColor.a < 0.3 ? 0.3 : cColor.a;

        this.colors.push(
          aColor.r,
          aColor.g,
          aColor.b,
          aAlpha,
          bColor.r,
          bColor.g,
          bColor.b,
          bAlpha,
          cColor.r,
          cColor.g,
          cColor.b,
          cAlpha,
        );

        // Add UVs
        this.uvs.push(a.uv.x, a.uv.y, b.uv.x, b.uv.y, c.uv.x, c.uv.y);

        // Add skin indices and weights
        if (
          a.vertex.skinIndices &&
          b.vertex.skinIndices &&
          c.vertex.skinIndices &&
          a.vertex.skinWeights &&
          b.vertex.skinWeights &&
          c.vertex.skinWeights
        ) {
          this.skinIndices.push(
            ...a.vertex.skinIndices,
            ...b.vertex.skinIndices,
            ...c.vertex.skinIndices,
          );

          this.skinWeights.push(
            ...a.vertex.skinWeights,
            ...b.vertex.skinWeights,
            ...c.vertex.skinWeights,
          );
        }
      }
    }
  }

  createMesh(): SkinnedMesh {
    // Create geometry
    const geometry = new BufferGeometry();

    // Add vertex positions
    if (this.vertices.length > 0) {
      geometry.setAttribute(
        "position",
        new BufferAttribute(new Float32Array(this.vertices), 3),
      );
    }

    // Add normals if present
    if (this.normals.length > 0) {
      geometry.setAttribute(
        "normal",
        new BufferAttribute(new Float32Array(this.normals), 3),
      );
    }

    // Add colors
    if (this.colors.length > 0) {
      geometry.setAttribute(
        "color",
        new BufferAttribute(new Float32Array(this.colors), 4),
      );
    }

    // Add UVs
    if (this.uvs.length > 0) {
      geometry.setAttribute(
        "uv",
        new BufferAttribute(new Float32Array(this.uvs), 2),
      );
    }

    // Add skinning data
    if (this.skinIndices.length > 0 && this.skinWeights.length > 0) {
      geometry.setAttribute(
        "skinIndex",
        new BufferAttribute(new Float32Array(this.skinIndices), 4),
      );
      geometry.setAttribute(
        "skinWeight",
        new BufferAttribute(new Float32Array(this.skinWeights), 4),
      );
    }

    // Create materials
    const materials: Material[] = this.materials.map((matOptions) => {
      const material = new MeshBasicMaterial({
        map: null, // Would need to load texture based on matOptions.texId
        transparent: matOptions.blending,
        side: matOptions.doubleSide ? DoubleSide : undefined,
        vertexColors: this.colors.length > 0,
      });

      return material;
    });

    // If no materials were created, add a default one
    if (materials.length === 0) {
      materials.push(
        new MeshBasicMaterial({
          vertexColors: this.colors.length > 0,
          wireframe: true,
        }),
      );
    }

    // Create the skinned mesh
    const mesh = new SkinnedMesh(
      geometry,
      materials.length === 1 ? materials[0] : materials,
    );

    // Add the skeleton
    if (this.bones.length > 0) {
      const rootBone = this.bones[0];
      mesh.add(rootBone);

      // Set the bind matrix for each bone
      this.bones.forEach((bone) => {
        const invMatrix = new Matrix4().copy(bone.matrixWorld).invert();
        bone.userData.invBindMatrix = invMatrix;
      });
    }

    return mesh;
  }
}

const readNjcm = (reader: ByteReader) => {
  const model = new NinjaModel(reader);
  model.readBone();
  return model;
};

const readNjtl = (reader: ByteReader): string[] => {
  const ref = reader.tell();
  const ptr = reader.readUInt32();
  const count = reader.readUInt32();
  reader.seek(ptr + ref);

  const textureNamePointers: number[] = [];
  for (let i = 0; i < count; i++) {
    textureNamePointers.push(reader.readUInt32());
    reader.seekRel(8);
  }

  const textureNames: string[] = [];
  textureNamePointers.forEach((ptr) => {
    reader.seek(ref + ptr);
    const name = reader.readString();
    textureNames.push(name);
  });

  return textureNames;
};

interface ParsedNinjaModel {
  model?: NinjaModel;
  textureNames?: string[];
}

const parseNinjaModel = (buffer: ArrayBuffer): ParsedNinjaModel => {
  console.log("Parsing Ninja model");
  const reader = new ByteReader(buffer);
  reader.seekEnd(0);
  const end = reader.tell();
  reader.seek(0);

  const result: ParsedNinjaModel = {};

  do {
    const magic = reader.readString(4);
    const len = reader.readUInt32();
    const chunk = reader.getSlice(len);

    if (magic === "NJTL") {
      result.textureNames = readNjtl(chunk);
    } else if (magic === "NJCM") {
      result.model = readNjcm(chunk);
    } else if (magic === "POF0") {
      continue;
    } else {
      console.warn(`Unknown chunk type: ${magic}`);
      break;
    }
  } while (reader.tell() < end);

  return result;
};

export { parseNinjaModel, NinjaModel };
