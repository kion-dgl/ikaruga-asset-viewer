// PVR Format Constants
enum PVR_FORMATS {
  ARGB1555 = 0x00,
  RGB565 = 0x01,
  ARGB4444 = 0x02,
  YUV422 = 0x03,
  BUMP = 0x04,
  RGB555 = 0x05,
  ARGB8888 = 0x06,
}

enum PVR_DATA_FORMATS {
  TWIDDLED = 0x01,
  TWIDDLED_MM = 0x02,
  VQ = 0x03,
  VQ_MM = 0x04,
  PALETTIZE4 = 0x05,
  PALETTIZE4_MM = 0x06,
  PALETTIZE8 = 0x07,
  PALETTIZE8_MM = 0x08,
  RECTANGLE = 0x09,
  STRIDE = 0x0b,
  TWIDDLED_RECTANGLE = 0x0d,
  SMALL_VQ = 0x10,
  SMALL_VQ_MM = 0x11,
  TWIDDLED_MM_ALT = 0x12,
}

// Default grayscale palettes
const createGrayscalePalette16 = (): Uint32Array => {
  const palette = new Uint32Array(16);
  for (let i = 0; i < 16; i++) {
    const value = Math.floor((i / 15) * 255);
    palette[i] = (255 << 24) | (value << 16) | (value << 8) | value; // ARGB format
  }
  return palette;
};

const createGrayscalePalette256 = (): Uint32Array => {
  const palette = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    palette[i] = (255 << 24) | (i << 16) | (i << 8) | i; // ARGB format
  }
  return palette;
};

const DEFAULT_GRAYSCALE_PALETTE_16 = createGrayscalePalette16();
const DEFAULT_GRAYSCALE_PALETTE_256 = createGrayscalePalette256();

export interface PVRHeader {
  colorFormat: number;
  dataFormat: number;
  width: number;
  height: number;
  hasMipmaps: boolean;
  isSmall: boolean;
  globalIndex?: number;
}

/**
 * Parse a PVR file from an ArrayBuffer
 */
export const parsePvr = async (
  buffer: ArrayBuffer,
): Promise<{ header: PVRHeader; imageData: ImageData }> => {
  const view = new DataView(buffer);
  let offset = 0;

  // Check for GBIX header (some Dreamcast PVRs have this)
  const firstMagic = String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );

  let globalIndex: number | undefined = undefined;

  if (firstMagic === "GBIX") {
    // This is a GBIX header, read the section size
    const gbixSize = view.getUint32(offset + 4, true);

    // Read the global index if present
    if (gbixSize >= 4) {
      globalIndex = view.getUint32(offset + 8, true);
    }

    // Skip past the GBIX section (header + size + data)
    offset += 8 + gbixSize;
  }

  // Now check for PVRT header
  const magic = String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );

  if (magic !== "PVRT") {
    throw new Error("Invalid PVR file format (missing PVRT header)");
  }
  offset += 4;

  // Skip data size
  offset += 4;

  // Read texture header
  const colorFormat = view.getUint8(offset);
  offset += 1;

  const dataFormat = view.getUint8(offset);
  offset += 1;

  // Skip padding
  offset += 2;

  const textureWidth = view.getUint16(offset, true);
  offset += 2;

  const textureHeight = view.getUint16(offset, true);
  offset += 2;

  const header: PVRHeader = {
    colorFormat,
    dataFormat,
    width: textureWidth,
    height: textureHeight,
    hasMipmaps: [
      PVR_DATA_FORMATS.TWIDDLED_MM,
      PVR_DATA_FORMATS.VQ_MM,
      PVR_DATA_FORMATS.PALETTIZE4_MM,
      PVR_DATA_FORMATS.PALETTIZE8_MM,
      PVR_DATA_FORMATS.SMALL_VQ_MM,
    ].includes(dataFormat),
    isSmall: [PVR_DATA_FORMATS.SMALL_VQ, PVR_DATA_FORMATS.SMALL_VQ_MM].includes(
      dataFormat,
    ),
    globalIndex,
  };

  console.log(`PVR Header:`, header);
  const imageData = new ImageData(header.width, header.height);

  switch (dataFormat) {
    case PVR_DATA_FORMATS.VQ:
    case PVR_DATA_FORMATS.VQ_MM:
    case PVR_DATA_FORMATS.SMALL_VQ:
    case PVR_DATA_FORMATS.SMALL_VQ_MM:
      const image = decodeVector(view, offset, header, imageData);
      break;
    default:
      throw new Error("Data format not supported: " + dataFormat.toString(16));
  }

  return { header, imageData };
};

const readTwiddled = (
  view: DataView,
  offset: number,
  width: number,
  isVq: boolean,
) => {
  let list = new Array(width * width);
  subdivideAndMove(0, 0, width);
  return list;

  function subdivideAndMove(x: number, y: number, mipSize: number) {
    if (mipSize === 1) {
      if (isVq) {
        list[y * width + x] = view.getUint8(offset);
        offset++;
      } else {
        list[y * width + x] = view.getUint16(offset, true);
        offset += 2;
      }
    } else {
      let ns = Math.floor(mipSize / 2);
      subdivideAndMove(x, y, ns);
      subdivideAndMove(x, y + ns, ns);
      subdivideAndMove(x + ns, y, ns);
      subdivideAndMove(x + ns, y + ns, ns);
    }
  }
};

const drawImage = (
  header: PVRHeader,
  image: number[],
  imageData: ImageData,
) => {
  let n = 0;
  const { width, height, colorFormat } = header;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;

      switch (colorFormat) {
        case PVR_FORMATS.ARGB1555:
          imageData.data[n + 3] = image[i] & 0x8000 ? 255 : 0;
          imageData.data[n + 0] = (image[i] & 0x7c00) >> 7;
          imageData.data[n + 1] = (image[i] & 0x03e0) >> 2;
          imageData.data[n + 2] = (image[i] & 0x001f) << 3;
          break;
        case PVR_FORMATS.RGB565:
          imageData.data[n + 0] = (image[i] >> 8) & (0x1f << 3);
          imageData.data[n + 1] = (image[i] >> 3) & (0x3f << 2);
          imageData.data[n + 2] = (image[i] << 3) & (0x1f << 3);
          imageData.data[n + 3] = 255;
          break;
        case PVR_FORMATS.ARGB4444:
          imageData.data[n + 3] = ((image[i] >> 8) & 0xf0) / 255;
          imageData.data[n + 0] = (image[i] >> 4) & 0xf0;
          imageData.data[n + 1] = (image[i] >> 0) & 0xf0;
          imageData.data[n + 2] = (image[i] << 4) & 0xf0;
          break;
      }

      n += 4;
    }
  }
};

const decodeVector = (
  view: DataView,
  offset: number,
  header: PVRHeader,
  imageData: ImageData,
) => {
  const { isSmall, hasMipmaps, width, height } = header;

  /*
    First, read color look up table
  */
  let clutSize = 256;
  if (isSmall) {
    if (hasMipmaps) {
      switch (width) {
        case 8:
        case 16:
          clutSize = 16;
          break;
        case 32:
          clutSize = 64;
          break;
      }
    } else {
      switch (width) {
        case 8:
        case 16:
          clutSize = 16;
          break;
        case 32:
          clutSize = 32;
          break;
        case 64:
          clutSize = 128;
          break;
      }
    }
  }

  let clut = new Array(clutSize * 4);
  for (let i = 0; i < clut.length; i++) {
    clut[i] = view.getUint16(offset, true);
    offset += 2;
  }

  if (hasMipmaps) {
    let seekOfs = 0x01;

    for (let i = 0; i <= 10; i++) {
      let mipWidth = 0x01 << i;

      if (width === mipWidth) {
        break;
      }

      offset += Math.floor((mipWidth * mipWidth) / 4);
    }
  }

  let image = new Array(width * height);
  let dataBody = readTwiddled(view, offset, width / 2, true);

  let x = 0;
  let y = 0;
  for (let i = 0; i < dataBody.length; i++) {
    let clutOfs = dataBody[i] * 4;

    for (let xOfs = 0; xOfs < 2; xOfs++) {
      for (let yOfs = 0; yOfs < 2; yOfs++) {
        let pix = (y * 2 + yOfs) * width + (x * 2 + xOfs);
        image[pix] = clut[clutOfs++];
      }
    }

    x++;
    if (x === Math.floor(width / 2)) {
      x = 0;
      y++;
    }
  }

  drawImage(header, image, imageData);
};
