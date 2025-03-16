import { Bone, Vector3, Euler } from "three";
import ByteReader from "ByteReader";

class NinjaModel {
  private reader: ByteReader;
  private bones: Bone[];

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

  readRotation() {
    const ratio = (2 * Math.PI) / 0xffff;
    const x = this.reader.readInt32() * ratio;
    const y = this.reader.readInt32() * ratio;
    const z = this.reader.readInt32() * ratio;
    return new Euler(x, y, z);
  }

  readBone(parentBone?: Bone) {
    const bone = new Bone();
    bone.name = `bone_${this.bones.length.toString().padStart(3, "0")}`;
    console.log(bone.name);
    this.bones.push(bone);

    const flags = this.reader.readUInt32();
    const chunkOfs = this.reader.readUInt32();
    const pos = this.readVector3(); // Vector3
    const rot = this.readRotation(); // Euler
    const scl = this.readVector3(); // Vector3
    const childOfs = this.reader.readUInt32();
    const siblingOfs = this.reader.readUInt32();

    // Set the bone's position, rotation, and scale
    bone.position.copy(pos);
    bone.rotation.copy(rot); // Assuming rot is already an Euler
    bone.scale.copy(scl);

    // If there's a parent, add this bone as a child
    if (parentBone) {
      parentBone.add(bone);
    }

    // Process child and sibling bones if needed
    if (childOfs > 0) {
      this.reader.seek(childOfs);
      this.readBone(bone); // Read child with current bone as parent
    }

    if (siblingOfs > 0) {
      this.reader.seek(siblingOfs);
      this.readBone(parentBone); // Read sibling with same parent
    }
  }
}

const readNjcm = (reader: ByteReader) => {
  const model = new NinjaModel(reader);
  model.readBone();
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

const parseNinjaModel = (buffer: ArrayBuffer) => {
  console.log("NOW WE PARSE");
  const reader = new ByteReader(buffer);
  reader.seekEnd(0);
  const end = reader.tell();
  reader.seek(0);

  do {
    const magic = reader.readString(4);
    const len = reader.readUInt32();
    const chunk = reader.getSlice(len);
    console.log(magic);
    if (magic === "NJTL") {
      readNjtl(chunk);
    } else if (magic === "NJCM") {
      readNjcm(chunk);
    } else if (magic === "POF0") {
      continue;
    } else {
      break;
    }
  } while (reader.tell() < end);
};

export { parseNinjaModel };
