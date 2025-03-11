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
    case PVR_DATA_FORMATS.TWIDDLED:
    case PVR_DATA_FORMATS.TWIDDLED_MM:
    case PVR_DATA_FORMATS.TWIDDLED_MM_ALT:
      decodeTwiddle(view, offset, header, imageData);
      break;
    case PVR_DATA_FORMATS.VQ:
    case PVR_DATA_FORMATS.VQ_MM:
    case PVR_DATA_FORMATS.SMALL_VQ:
    case PVR_DATA_FORMATS.SMALL_VQ_MM:
      decodeVector(view, offset, header, imageData);
      break;
    case PVR_DATA_FORMATS.PALETTIZE4:
      decodePalette(view, offset, header, imageData);
      break;
    default:
      throw new Error("Data format not supported: " + dataFormat.toString(16));
  }

  return { header, imageData };
};

const decodePalette = (
  view: DataView,
  offset: number,
  header: PVRHeader,
  imageData: ImageData,
) => {
  const { width, height } = header;
  const pal: number[][] = [];
  let n = 0;
  for (let i = 0; i < 16; i++) {
    pal.push([n, n, n, 255]);
    n += 16;
    n > 255 ? (n = 255) : n;
  }

  n = 0;
  const dataBody = readTwiddled(view, offset, width / 2, true);
  dataBody.forEach((byte) => {
    const a = byte & 0x0f;
    const b = byte >> 4;
    imageData.data[n++] = pal[a][0];
    imageData.data[n++] = pal[a][1];
    imageData.data[n++] = pal[a][2];
    imageData.data[n++] = pal[a][3];
    imageData.data[n++] = pal[b][0];
    imageData.data[n++] = pal[b][1];
    imageData.data[n++] = pal[b][2];
    imageData.data[n++] = pal[b][3];
  });
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

const decodeTwiddle = (
  view: DataView,
  offset: number,
  header: PVRHeader,
  imageData: ImageData,
) => {
  const { hasMipmaps, width } = header;

  if (hasMipmaps) {
    let seekOfs = 0x02;
    for (let i = 0; i <= 10; i++) {
      let mipWidth = 0x01 << i;
      if (width === mipWidth) {
        break;
      }
      seekOfs += mipWidth * mipWidth * 2;
    }
    offset += seekOfs;
  }

  const image = readTwiddled(view, offset, width, false);
  drawImage(header, image, imageData);
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

      seekOfs += (mipWidth * mipWidth) / 4;
    }

    offset += seekOfs;
  }

  const image = new Array(width * height);
  const dataBody = readTwiddled(view, offset, width / 2, true);

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
