// import * as THREE from "three";
import ByteReader from "ByteReader";

const parseNinjaModel = (buffer: ArrayBuffer) => {
  const reader = new ByteReader(buffer);
  const firstMagic = reader.readString(4);

  if (firstMagic === "NJTL") {
    // Get the length of the NJTL chunk
    const len = reader.readInt32();
    const ref = reader.tell();
    const ptr = reader.readUInt32();
    const count = reader.readUInt32();
    reader.seek(ptr + ref);

    const textureNamePointers: number[] = [];
    for (let i = 0; i < count; i++) {
      textureNamePointers.push(reader.readUInt32());
      reader.seekRel(8);
    }

    textureNamePointers.forEach((ptr) => {
      reader.seek(ref + ptr);
      const string = reader.readString();
      console.log(string);
    });
  }
  console.log(firstMagic);
};

export { parseNinjaModel };
