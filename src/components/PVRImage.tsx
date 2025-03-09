import React, { useEffect, useRef, useState } from "react";

// PVR Format Constants
const PVR_FORMATS = {
  ARGB1555: 0x00,
  RGB565: 0x01,
  ARGB4444: 0x02,
  YUV422: 0x03,
  BUMP: 0x04,
  RGB555: 0x05,
  ARGB8888: 0x06,
};

const PVR_DATA_FORMATS = {
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

interface PVRImageProps {
  assetPath: string;
  alt?: string;
}

interface PVRHeader {
  colorFormat: number;
  dataFormat: number;
  width: number;
  height: number;
  hasMipmaps: boolean;
  globalIndex?: number;
}

// A cache for morton order lookups to avoid recalculating
const mortonLookupTable: Record<string, number> = {};

const PVRImage: React.FC<PVRImageProps> = ({
  assetPath,
  alt = "PVR Texture",
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [imageData, setImageData] = useState<ImageData | null>(null);
  const [pvrHeader, setPvrHeader] = useState<PVRHeader | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // State for tracking mouse position
  const [rotation, setRotation] = useState({ x: 0, y: 0 });
  const [isHovering, setIsHovering] = useState(false);

  // Load and parse the PVR file
  useEffect(() => {
    const loadPvrTexture = async () => {
      try {
        setLoading(true);
        setError(null);

        // Fetch the PVR file
        const response = await fetch(`/iso/${assetPath}`);
        if (!response.ok) {
          throw new Error(`Failed to load texture: ${response.statusText}`);
        }

        const buffer = await response.arrayBuffer();
        const result = await parsePvr(buffer);

        setPvrHeader(result.header);
        setImageData(result.imageData);
        setLoading(false);
      } catch (err) {
        console.error("Error loading PVR texture:", err);
        setError(err instanceof Error ? err.message : "Unknown error");
        setLoading(false);
      }
    };

    if (assetPath) {
      loadPvrTexture();
    }
  }, [assetPath]);

  // Draw the PVR texture to canvas when data is available
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !imageData) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Draw the image data to the canvas
    ctx.putImageData(imageData, 0, 0);
  }, [imageData]);

  /**
   * Parse a PVR file from an ArrayBuffer
   */
  const parsePvr = async (
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

    console.log(`PVR: ${assetPath}`, header);

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
    const pixels = new Uint32Array(imageData.data.buffer);

    // Decode based on data format
    if (
      dataFormat === PVR_DATA_FORMATS.TWIDDLED ||
      dataFormat === PVR_DATA_FORMATS.TWIDDLED_MM
    ) {
      decodeTwiddled(view, offset, pixels, header, colorFormat);
    } else if (
      (dataFormat === PVR_DATA_FORMATS.VQ ||
        dataFormat === PVR_DATA_FORMATS.VQ_MM) &&
      codebook
    ) {
      decodeVQ(view, offset, pixels, header, codebook);
    } else if (dataFormat === PVR_DATA_FORMATS.TWIDDLED_RECTANGLE) {
      decodeTwiddledRectangle(view, offset, pixels, header, colorFormat);
    } else if (dataFormat === PVR_DATA_FORMATS.RECTANGLE) {
      decodeRectangle(view, offset, pixels, header, colorFormat);
    } else {
      // Default - try to decode as raw data
      decodeRaw(view, offset, pixels, header, colorFormat);
    }

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
   */
  const convertPixelFormat = (pixel: number, format: number): number => {
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

    // Return as ABGR (memory layout for Uint32Array in Canvas ImageData)
    return (a << 24) | (b << 16) | (g << 8) | r;
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
   * Decode a twiddled texture
   */
  const decodeTwiddled = (
    view: DataView,
    offset: number,
    pixels: Uint32Array,
    header: PVRHeader,
    colorFormat: number,
  ): void => {
    for (let y = 0; y < header.height; y++) {
      for (let x = 0; x < header.width; x++) {
        const i = untwiddle(x, y);

        if (i * 2 + offset + 2 <= view.byteLength) {
          const pixel = view.getUint16(offset + i * 2, true);
          const rgba = convertPixelFormat(pixel, colorFormat);
          pixels[y * header.width + x] = rgba;
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
    pixels: Uint32Array,
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
              pixels[y * header.width + x] = codebook[index * 4];

            if (y < header.height && x + 1 < header.width)
              pixels[y * header.width + x + 1] = codebook[index * 4 + 1];

            if (y + 1 < header.height && x < header.width)
              pixels[(y + 1) * header.width + x] = codebook[index * 4 + 2];

            if (y + 1 < header.height && x + 1 < header.width)
              pixels[(y + 1) * header.width + x + 1] = codebook[index * 4 + 3];
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
    pixels: Uint32Array,
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
          const rgba = convertPixelFormat(pixel, colorFormat);

          if (header.width > header.height) {
            // Horizontal layout
            const pixelX = n * size + x;
            const pixelY = y;

            if (pixelX < header.width && pixelY < header.height) {
              pixels[pixelY * header.width + pixelX] = rgba;
            }
          } else {
            // Vertical layout
            const pixelX = x;
            const pixelY = n * size + y;

            if (pixelX < header.width && pixelY < header.height) {
              pixels[pixelY * header.width + pixelX] = rgba;
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
    pixels: Uint32Array,
    header: PVRHeader,
    colorFormat: number,
  ): void => {
    for (let y = 0; y < header.height; y++) {
      for (let x = 0; x < header.width; x++) {
        const i = y * header.width + x;

        if (offset + i * 2 + 2 <= view.byteLength) {
          const pixel = view.getUint16(offset + i * 2, true);
          const rgba = convertPixelFormat(pixel, colorFormat);
          pixels[i] = rgba;
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
    pixels: Uint32Array,
    header: PVRHeader,
    colorFormat: number,
  ): void => {
    for (let y = 0; y < header.height; y++) {
      for (let x = 0; x < header.width; x++) {
        const i = y * header.width + x;

        if (offset + i * 2 + 2 <= view.byteLength) {
          const pixel = view.getUint16(offset + i * 2, true);
          const rgba = convertPixelFormat(pixel, colorFormat);
          pixels[i] = rgba;
        }
      }
    }
  };

  // Function to draw on the canvas (fallback if load fails)
  const drawPlaceholder = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Default dimensions for placeholder
    const placeholderWidth = 256;
    const placeholderHeight = 256;

    // Set canvas size to placeholder dimensions
    canvas.width = placeholderWidth;
    canvas.height = placeholderHeight;

    // Clear canvas
    ctx.clearRect(0, 0, placeholderWidth, placeholderHeight);

    // Draw a simple gradient background
    const gradient = ctx.createLinearGradient(
      0,
      0,
      placeholderWidth,
      placeholderHeight,
    );
    gradient.addColorStop(0, "#3b82f6"); // Blue
    gradient.addColorStop(1, "#8b5cf6"); // Violet

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, placeholderWidth, placeholderHeight);

    // Add text showing loading/error state
    ctx.fillStyle = "white";
    ctx.font = "16px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    if (loading) {
      ctx.fillText("Loading...", placeholderWidth / 2, placeholderHeight / 2);
    } else if (error) {
      ctx.fillText(
        `Error: ${error}`,
        placeholderWidth / 2,
        placeholderHeight / 2,
      );
    } else if (!imageData) {
      ctx.fillText(assetPath, placeholderWidth / 2, placeholderHeight / 2);
    }
  };

  // Handle mouse movement for 3D effect
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!cardRef.current) return;

    const card = cardRef.current;
    const rect = card.getBoundingClientRect();

    // Calculate mouse position relative to the card
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Calculate rotation based on mouse position
    // We'll rotate more when mouse is near edges
    const rotateX = (y / rect.height - 0.5) * -40; // -20 to 20 degrees
    const rotateY = (x / rect.width - 0.5) * 40; // -20 to 20 degrees

    setRotation({ x: rotateX, y: rotateY });
  };

  const handleMouseEnter = () => {
    setIsHovering(true);
  };

  const handleMouseLeave = () => {
    setIsHovering(false);
    // Reset rotation when mouse leaves
    setRotation({ x: 0, y: 0 });
  };

  // Draw placeholder for loading/error states
  useEffect(() => {
    if (loading || error || !imageData) {
      drawPlaceholder();
    }
  }, [loading, error, imageData]);

  // Update canvas dimensions when pvrHeader is available
  useEffect(() => {
    if (pvrHeader && canvasRef.current) {
      canvasRef.current.width = pvrHeader.width;
      canvasRef.current.height = pvrHeader.height;
    }
  }, [pvrHeader]);

  return (
    <div
      ref={cardRef}
      className="pvr-image-container inline-block"
      style={{
        perspective: "1000px",
        transformStyle: "preserve-3d",
        borderRadius: "8px",
        padding: "6px", // Add padding for the glow effect
      }}
      onMouseMove={handleMouseMove}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div>
        <canvas
          ref={canvasRef}
          className="block"
          aria-label={alt}
          style={{
            transform: isHovering
              ? `rotateX(${rotation.x}deg) rotateY(${rotation.y}deg)`
              : "rotateX(0deg) rotateY(0deg)",
            transition: isHovering
              ? "transform 0.1s ease-out"
              : "transform 0.5s ease-out",
            transformStyle: "preserve-3d",
            borderRadius: "8px",
            overflow: "hidden",
            border: "2px solid white",
            boxShadow: isHovering
              ? `0 10px 20px rgba(0, 0, 0, 0.2),
                 0 0 15px rgba(59, 130, 246, 0.5)`
              : "0 4px 6px rgba(0, 0, 0, 0.1)",
            willChange: "transform, box-shadow", // Optimization for animations
          }}
        />
      </div>
    </div>
  );
};

export default PVRImage;
