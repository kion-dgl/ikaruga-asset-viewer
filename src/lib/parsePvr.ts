// PVR Format Constants
export const PVR_FORMATS = {
  ARGB1555: 0x00,
  RGB565: 0x01,
  ARGB4444: 0x02,
  YUV422: 0x03,
  BUMP: 0x04,
  RGB555: 0x05,
  ARGB8888: 0x06,
};

export const PVR_DATA_FORMATS = {
  TWIDDLED: 0x01,
  TWIDDLED_MM: 0x02,
  VQ: 0x03,
  VQ_MM: 0x04,
  PALETTIZE4: 0x05,
  PALETTIZE4_MM: 0x06,
  PALETTIZE8: 0x07,
  PALETTIZE8_MM: 0x08,
  RECTANGLE: 0x09,
  STRIDE: 0x0b,
  TWIDDLED_RECTANGLE: 0x0d,
};

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
  globalIndex?: number;
}

// A cache for morton order lookups to avoid recalculating
const mortonLookupTable: Record<string, number> = {};

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
    ].includes(dataFormat),
    globalIndex,
  };

  console.log(`PVR Header:`, header);

  // Skip mipmaps if present
  if (header.hasMipmaps) {
    const skipSize = calculateMipmapSize(
      header.width,
      header.height,
      dataFormat,
    );
    offset += skipSize;
  }

  // Handle VQ format (needs codebook)
  let codebook: Uint32Array | null = null;
  let codebookSize = 256;

  if (
    dataFormat === PVR_DATA_FORMATS.VQ ||
    dataFormat === PVR_DATA_FORMATS.VQ_MM
  ) {
    // Adjust codebook size for SMALL_VQ textures
    if (header.width <= 16 && header.height <= 16) {
      codebookSize = 16;
    } else if (header.width <= 32 && header.height <= 32) {
      codebookSize = 32;
    } else if (header.width <= 64 && header.height <= 64) {
      codebookSize = 128;
    }

    codebook = new Uint32Array(codebookSize * 4); // 4 pixels per codebook entry

    // Read codebook
    for (let i = 0; i < codebookSize; i++) {
      for (let p = 0; p < 4; p++) {
        const pixel = view.getUint16(offset, true);
        offset += 2;

        const rgba = convertPixelFormat(pixel, colorFormat);
        codebook[i * 4 + p] = rgba;
      }
    }
  }

  // Create image data
  const imageData = new ImageData(header.width, header.height);

  // Decode based on data format
  if (
    dataFormat === PVR_DATA_FORMATS.TWIDDLED ||
    dataFormat === PVR_DATA_FORMATS.TWIDDLED_MM
  ) {
    decodeTwiddled(view, offset, imageData, header, colorFormat);
  } else if (
    (dataFormat === PVR_DATA_FORMATS.VQ ||
      dataFormat === PVR_DATA_FORMATS.VQ_MM) &&
    codebook
  ) {
    decodeVQ(view, offset, imageData, header, codebook);
  } else if (
    dataFormat === PVR_DATA_FORMATS.PALETTIZE4 ||
    dataFormat === PVR_DATA_FORMATS.PALETTIZE4_MM
  ) {
    decodePalettized(
      view,
      offset,
      imageData,
      header,
      16,
      DEFAULT_GRAYSCALE_PALETTE_16,
    );
  } else if (
    dataFormat === PVR_DATA_FORMATS.PALETTIZE8 ||
    dataFormat === PVR_DATA_FORMATS.PALETTIZE8_MM
  ) {
    decodePalettized(
      view,
      offset,
      imageData,
      header,
      256,
      DEFAULT_GRAYSCALE_PALETTE_256,
    );
  } else if (dataFormat === PVR_DATA_FORMATS.TWIDDLED_RECTANGLE) {
    decodeTwiddledRectangle(view, offset, imageData, header, colorFormat);
  } else if (dataFormat === PVR_DATA_FORMATS.RECTANGLE) {
    decodeRectangle(view, offset, imageData, header, colorFormat);
  } else {
    // Default - try to decode as raw data
    decodeRaw(view, offset, imageData, header, colorFormat);
  }

  // Force full opacity for testing if needed
  // Uncomment this section if you still have transparency issues
  /*
  for (let i = 3; i < imageData.data.length; i += 4) {
    imageData.data[i] = 255; // Set all alpha values to fully opaque
  }
  */

  // Debug info
  let nonTransparentPixels = 0;
  for (let i = 3; i < imageData.data.length; i += 4) {
    if (imageData.data[i] > 0) nonTransparentPixels++;
  }
  console.log(
    `Image has ${nonTransparentPixels} non-transparent pixels out of ${header.width * header.height}`,
  );

  return { header, imageData };
};

/**
 * Calculate the size to skip for mipmaps
 */
const calculateMipmapSize = (
  width: number,
  height: number,
  dataFormat: number,
): number => {
  let size = 0;
  let mipWidth = width;
  let mipHeight = height;

  while (mipWidth > 1 || mipHeight > 1) {
    mipWidth = Math.max(1, mipWidth >> 1);
    mipHeight = Math.max(1, mipHeight >> 1);

    if (
      dataFormat === PVR_DATA_FORMATS.VQ ||
      dataFormat === PVR_DATA_FORMATS.VQ_MM
    ) {
      size += Math.ceil((mipWidth * mipHeight) / 4); // 1 byte per 2x2 block
    } else {
      size += mipWidth * mipHeight * 2; // 2 bytes per pixel
    }
  }

  return size;
};

/**
 * Convert a pixel from PVR format to RGBA
 * Returns pixel color components as separate values for direct array manipulation
 */
const extractPixelComponents = (
  pixel: number,
  format: number,
): { r: number; g: number; b: number; a: number } => {
  let r = 0,
    g = 0,
    b = 0,
    a = 255;

  switch (format) {
    case PVR_FORMATS.ARGB1555:
      a = pixel & 0x8000 ? 255 : 0;
      r = ((pixel >> 10) & 0x1f) << 3;
      g = ((pixel >> 5) & 0x1f) << 3;
      b = (pixel & 0x1f) << 3;
      break;

    case PVR_FORMATS.RGB565:
      r = ((pixel >> 11) & 0x1f) << 3;
      g = ((pixel >> 5) & 0x3f) << 2;
      b = (pixel & 0x1f) << 3;
      break;

    case PVR_FORMATS.ARGB4444:
      a = ((pixel >> 12) & 0xf) << 4;
      r = ((pixel >> 8) & 0xf) << 4;
      g = ((pixel >> 4) & 0xf) << 4;
      b = (pixel & 0xf) << 4;
      break;

    case PVR_FORMATS.RGB555:
      r = ((pixel >> 10) & 0x1f) << 3;
      g = ((pixel >> 5) & 0x1f) << 3;
      b = (pixel & 0x1f) << 3;
      break;

    // Add other format conversions as needed
  }

  // Fill in the low bits (copy from high bits)
  r |= r >> 5;
  g |= format === PVR_FORMATS.RGB565 ? g >> 6 : g >> 5;
  b |= b >> 5;

  return { r, g, b, a };
};

/**
 * Convert a pixel from PVR format to RGBA packed into a single number
 * Used for codebook and palette entries
 */
const convertPixelFormat = (pixel: number, format: number): number => {
  const { r, g, b, a } = extractPixelComponents(pixel, format);

  // Return as RGBA packed into a 32-bit number
  // The actual endian handling will be done when unpacking this value
  return (r << 0) | (g << 8) | (b << 16) | (a << 24);
};

/**
 * Untwiddle function to convert from Morton order
 */
const untwiddle = (x: number, y: number): number => {
  const key = `${x}_${y}`;

  if (mortonLookupTable[key] !== undefined) {
    return mortonLookupTable[key];
  }

  let morton = 0;

  for (let i = 0; i < 16; i++) {
    const mask = 1 << i;
    if (x & mask) morton |= 1 << (i * 2);
    if (y & mask) morton |= 1 << (i * 2 + 1);
  }

  mortonLookupTable[key] = morton;
  return morton;
};

/**
 * Unpack a 32-bit RGBA value into the imageData array directly
 */
const setPixel = (
  imageData: ImageData,
  x: number,
  y: number,
  color: number,
): void => {
  const idx = (y * imageData.width + x) * 4;

  // Extract individual components from packed color
  const r = (color >> 0) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = (color >> 16) & 0xff;
  const a = (color >> 24) & 0xff;

  // Set RGBA values directly in the Uint8ClampedArray
  imageData.data[idx + 0] = r;
  imageData.data[idx + 1] = g;
  imageData.data[idx + 2] = b;
  imageData.data[idx + 3] = a;
};

/**
 * Set pixel directly with individual color components
 */
const setPixelComponents = (
  imageData: ImageData,
  x: number,
  y: number,
  r: number,
  g: number,
  b: number,
  a: number,
): void => {
  const idx = (y * imageData.width + x) * 4;
  imageData.data[idx + 0] = r;
  imageData.data[idx + 1] = g;
  imageData.data[idx + 2] = b;
  imageData.data[idx + 3] = a;
};

/**
 * Decode a twiddled texture
 */
const decodeTwiddled = (
  view: DataView,
  offset: number,
  imageData: ImageData,
  header: PVRHeader,
  colorFormat: number,
): void => {
  for (let y = 0; y < header.height; y++) {
    for (let x = 0; x < header.width; x++) {
      const i = untwiddle(x, y);

      if (i * 2 + offset + 2 <= view.byteLength) {
        const pixel = view.getUint16(offset + i * 2, true);
        const { r, g, b, a } = extractPixelComponents(pixel, colorFormat);
        setPixelComponents(imageData, x, y, r, g, b, a);
      }
    }
  }
};

/**
 * Decode a VQ compressed texture
 */
const decodeVQ = (
  view: DataView,
  offset: number,
  imageData: ImageData,
  header: PVRHeader,
  codebook: Uint32Array,
): void => {
  for (let y = 0; y < header.height; y += 2) {
    for (let x = 0; x < header.width; x += 2) {
      const blockX = x >> 1;
      const blockY = y >> 1;
      const i = untwiddle(blockX, blockY);

      if (offset + i < view.byteLength) {
        const index = view.getUint8(offset + i);

        if (index < codebook.length / 4) {
          // Copy the 2x2 block from codebook
          if (y < header.height && x < header.width)
            setPixel(imageData, x, y, codebook[index * 4]);

          if (y < header.height && x + 1 < header.width)
            setPixel(imageData, x + 1, y, codebook[index * 4 + 1]);

          if (y + 1 < header.height && x < header.width)
            setPixel(imageData, x, y + 1, codebook[index * 4 + 2]);

          if (y + 1 < header.height && x + 1 < header.width)
            setPixel(imageData, x + 1, y + 1, codebook[index * 4 + 3]);
        }
      }
    }
  }
};

/**
 * Decode a twiddled rectangle texture
 */
const decodeTwiddledRectangle = (
  view: DataView,
  offset: number,
  imageData: ImageData,
  header: PVRHeader,
  colorFormat: number,
): void => {
  // For twiddled rectangle, we handle it as a series of square textures
  const size = Math.min(header.width, header.height);
  const count = Math.max(
    Math.floor(header.width / size),
    Math.floor(header.height / size),
  );

  let texOffset = offset;

  for (let n = 0; n < count; n++) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = untwiddle(x, y);
        const pixel = view.getUint16(texOffset + i * 2, true);
        const { r, g, b, a } = extractPixelComponents(pixel, colorFormat);

        if (header.width > header.height) {
          // Horizontal layout
          const pixelX = n * size + x;
          const pixelY = y;

          if (pixelX < header.width && pixelY < header.height) {
            setPixelComponents(imageData, pixelX, pixelY, r, g, b, a);
          }
        } else {
          // Vertical layout
          const pixelX = x;
          const pixelY = n * size + y;

          if (pixelX < header.width && pixelY < header.height) {
            setPixelComponents(imageData, pixelX, pixelY, r, g, b, a);
          }
        }
      }
    }

    texOffset += size * size * 2; // Move to next square texture
  }
};

/**
 * Decode a rectangle (untwiddled) texture
 */
const decodeRectangle = (
  view: DataView,
  offset: number,
  imageData: ImageData,
  header: PVRHeader,
  colorFormat: number,
): void => {
  for (let y = 0; y < header.height; y++) {
    for (let x = 0; x < header.width; x++) {
      const i = y * header.width + x;

      if (offset + i * 2 + 2 <= view.byteLength) {
        const pixel = view.getUint16(offset + i * 2, true);
        const { r, g, b, a } = extractPixelComponents(pixel, colorFormat);
        setPixelComponents(imageData, x, y, r, g, b, a);
      }
    }
  }
};

/**
 * Decode raw (uncompressed, untwiddled) texture data
 */
const decodeRaw = (
  view: DataView,
  offset: number,
  imageData: ImageData,
  header: PVRHeader,
  colorFormat: number,
): void => {
  for (let y = 0; y < header.height; y++) {
    for (let x = 0; x < header.width; x++) {
      const i = y * header.width + x;

      if (offset + i * 2 + 2 <= view.byteLength) {
        const pixel = view.getUint16(offset + i * 2, true);
        const { r, g, b, a } = extractPixelComponents(pixel, colorFormat);
        setPixelComponents(imageData, x, y, r, g, b, a);
      }
    }
  }
};

/**
 * Decode palettized texture using a provided palette
 */
const decodePalettized = (
  view: DataView,
  offset: number,
  imageData: ImageData,
  header: PVRHeader,
  paletteSize: number,
  defaultPalette: Uint32Array,
): void => {
  // Determine if we're using 4-bit (16 colors) or 8-bit (256 colors) palette
  const is4Bit = paletteSize === 16;

  // Calculate pixel data offset - palette data comes before pixel indices
  let pixelOffset = offset;

  // Try to read palette from file if available
  const palette = new Uint32Array(paletteSize);
  let usePaletteFromFile = false;

  // Check if there's enough data for a palette
  if (offset + paletteSize * 2 <= view.byteLength) {
    try {
      // Read palette entries (usually 16-bit color values)
      for (let i = 0; i < paletteSize; i++) {
        if (offset + i * 2 + 2 <= view.byteLength) {
          const colorValue = view.getUint16(offset + i * 2, true);
          // We would need the color format from the header, but for simplicity
          // we'll assume ARGB1555 or RGB565 based on paletteSize
          const colorFormat = is4Bit
            ? PVR_FORMATS.ARGB1555
            : PVR_FORMATS.RGB565;
          palette[i] = convertPixelFormat(colorValue, colorFormat);
          usePaletteFromFile = true;
        }
      }

      // Skip past palette data to get to the pixel indices
      pixelOffset += paletteSize * 2;
    } catch (e) {
      console.warn(
        "Error reading palette, falling back to default grayscale",
        e,
      );
      usePaletteFromFile = false;
    }
  }

  // Use default grayscale palette if we couldn't read one from the file
  const activePalette = usePaletteFromFile ? palette : defaultPalette;

  // Now decode the pixel data using the palette
  if (is4Bit) {
    // 4-bit indices (2 pixels per byte)
    for (let y = 0; y < header.height; y++) {
      for (let x = 0; x < header.width; x += 2) {
        const byteIndex = Math.floor(x / 2) + y * Math.ceil(header.width / 2);

        if (pixelOffset + byteIndex < view.byteLength) {
          const byte = view.getUint8(pixelOffset + byteIndex);
          const index1 = (byte >> 4) & 0x0f; // High 4 bits
          const index2 = byte & 0x0f; // Low 4 bits

          setPixel(imageData, x, y, activePalette[index1]);

          // Make sure we don't go out of bounds for odd widths
          if (x + 1 < header.width) {
            setPixel(imageData, x + 1, y, activePalette[index2]);
          }
        }
      }
    }
  } else {
    // 8-bit indices (1 pixel per byte)
    for (let y = 0; y < header.height; y++) {
      for (let x = 0; x < header.width; x++) {
        const byteIndex = x + y * header.width;

        if (pixelOffset + byteIndex < view.byteLength) {
          const index = view.getUint8(pixelOffset + byteIndex);
          setPixel(imageData, x, y, activePalette[index]);
        }
      }
    }
  }
};
