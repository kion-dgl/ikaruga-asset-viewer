import React, { useEffect, useRef, useState } from "react";
import { parsePvr, type PVRHeader } from "../lib/parsePvr";

interface PVRImageProps {
  assetPath?: string;
  palettePath?: string; // Prop for optional PVP palette file
  alt?: string;
}

// Mapping of data formats to readable names
const DATA_FORMAT_NAMES: Record<number, string> = {
  0x01: "TWIDDLED",
  0x02: "TWIDDLED_MM",
  0x03: "VQ",
  0x04: "VQ_MM",
  0x05: "PALETTIZE4",
  0x06: "PALETTIZE4_MM",
  0x07: "PALETTIZE8",
  0x08: "PALETTIZE8_MM",
  0x09: "RECTANGLE",
  0x0b: "STRIDE",
  0x0d: "TWIDDLED_RECTANGLE",
  0x10: "SMALL_VQ",
  0x11: "SMALL_VQ_MM",
  0x12: "TWIDDLED_MM_ALT",
};

// Mapping of color formats to readable names
const COLOR_FORMAT_NAMES: Record<number, string> = {
  0x00: "ARGB1555",
  0x01: "RGB565",
  0x02: "ARGB4444",
  0x03: "YUV422",
  0x04: "BUMP",
  0x05: "RGB555",
  0x06: "ARGB8888",
};

const PVRImage: React.FC<PVRImageProps> = ({
  assetPath,
  palettePath,
  alt = "PVR Texture",
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [header, setHeader] = useState<PVRHeader | null>(null);
  const [paletteInfo, setPaletteInfo] = useState<{
    format: number;
    entryCount: number;
  } | null>(null);
  // State for tracking mouse position for 3D effect
  const [rotation, setRotation] = useState({ x: 0, y: 0 });
  const [isHovering, setIsHovering] = useState(false);

  // Draw a placeholder on the canvas
  const drawPlaceholder = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Set default dimensions for placeholder
    canvas.width = 256;
    canvas.height = 256;

    // Draw a gradient background
    const gradient = ctx.createLinearGradient(
      0,
      0,
      canvas.width,
      canvas.height,
    );
    gradient.addColorStop(0, "#3b82f6"); // Blue
    gradient.addColorStop(1, "#8b5cf6"); // Violet

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Add text showing state
    ctx.fillStyle = "white";
    ctx.font = "16px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    if (loading) {
      ctx.fillText("Loading...", canvas.width / 2, canvas.height / 2);
    } else if (error) {
      ctx.fillText(`Error: ${error}`, canvas.width / 2, canvas.height / 2);
    } else if (!assetPath) {
      ctx.fillText("No texture", canvas.width / 2, canvas.height / 2);
    } else {
      ctx.fillText(assetPath, canvas.width / 2, canvas.height / 2);
    }
  };

  // Parse a PVP (palette) file
  const parsePVPFile = async (
    arrayBuffer: ArrayBuffer,
  ): Promise<{
    format: number;
    palette: number[];
    entryCount: number;
  }> => {
    const dataView = new DataView(arrayBuffer);

    // Read the PVP header
    const magic = String.fromCharCode(
      dataView.getUint8(0),
      dataView.getUint8(1),
      dataView.getUint8(2),
      dataView.getUint8(3),
    );

    // Verify file signature (should be "PVPL")
    if (magic !== "PVPL") {
      throw new Error("Invalid PVP file signature. Expected 'PVPL'");
    }

    const dataSize = dataView.getUint32(4, true);
    const format = dataView.getUint32(8, true);
    const entryCount = dataView.getUint16(14, true);

    // Calculate header size
    const headerSize = 16; // Size of the header structure

    // Parse palette data
    const palette: number[] = [];
    let offset = headerSize;

    // Determine bytes per color entry based on format
    let bytesPerEntry = 2; // Default to 16-bit (2 bytes)
    if (format === 0x06) {
      // ARGB8888
      bytesPerEntry = 4; // 32-bit (4 bytes)
    }

    for (let i = 0; i < entryCount; i++) {
      if (bytesPerEntry === 2) {
        // Read 16-bit color
        palette.push(dataView.getUint16(offset, true));
      } else {
        // Read 32-bit color
        palette.push(dataView.getUint32(offset, true));
      }
      offset += bytesPerEntry;
    }

    return {
      format,
      palette,
      entryCount,
    };
  };

  // Load and draw the PVR texture
  useEffect(() => {
    // If no asset path, just draw the placeholder
    if (!assetPath) {
      drawPlaceholder();
      return;
    }

    // Otherwise load and parse the texture
    const loadAndDrawTexture = async () => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      try {
        setLoading(true);
        setError(null);

        // Fetch the PVR file
        const response = await fetch(`/iso/${assetPath}`);
        if (!response.ok) {
          throw new Error(`Failed to load texture: ${response.statusText}`);
        }

        const buffer = await response.arrayBuffer();

        // Fetch and parse palette file if provided
        let palette = null;
        if (palettePath) {
          try {
            const paletteResponse = await fetch(`/iso/${palettePath}`);
            if (!paletteResponse.ok) {
              console.warn(
                `Failed to load palette: ${paletteResponse.statusText}`,
              );
            } else {
              const paletteBuffer = await paletteResponse.arrayBuffer();
              palette = await parsePVPFile(paletteBuffer);
              setPaletteInfo({
                format: palette.format,
                entryCount: palette.entryCount,
              });
              console.log(
                `Palette loaded: ${palette.entryCount} colors, format: 0x${palette.format.toString(16)}`,
              );
            }
          } catch (err) {
            console.warn("Error loading palette:", err);
            // Continue without palette
          }
        }

        // Parse the PVR with the optional palette
        const { header, imageData } = await parsePvr(buffer, palette?.palette);
        setHeader(header);

        // Set canvas dimensions first
        canvas.width = header.width;
        canvas.height = header.height;

        // Get context with alpha support
        const ctx = canvas.getContext("2d", { alpha: true });
        if (!ctx) {
          throw new Error("Could not get canvas context");
        }

        // Set rendering properties
        ctx.globalCompositeOperation = "source-over";
        ctx.globalAlpha = 1.0;

        // Draw the image data
        ctx.putImageData(imageData, 0, 0);

        // Log some debug info
        console.log(`PVR texture loaded: ${header.width}x${header.height}`);
        let nonZeroAlpha = 0;
        for (let i = 3; i < imageData.data.length; i += 4) {
          if (imageData.data[i] > 0) nonZeroAlpha++;
        }
        console.log(`Image has ${nonZeroAlpha} non-transparent pixels`);

        setLoading(false);
      } catch (err) {
        console.error("Error loading PVR texture:", err);
        setError(err instanceof Error ? err.message : "Unknown error");
        setLoading(false);
        drawPlaceholder(); // Show error state
      }
    };

    loadAndDrawTexture();
  }, [assetPath, palettePath]); // Re-run when assetPath or palettePath changes

  // Handle mouse movement for 3D effect
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!cardRef.current) return;

    const card = cardRef.current;
    const rect = card.getBoundingClientRect();

    // Calculate position and rotation
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const rotateX = (y / rect.height - 0.5) * -40;
    const rotateY = (x / rect.width - 0.5) * 40;

    setRotation({ x: rotateX, y: rotateY });
  };

  const handleMouseEnter = () => setIsHovering(true);

  const handleMouseLeave = () => {
    setIsHovering(false);
    setRotation({ x: 0, y: 0 });
  };

  // Get format name for display
  const getFormatName = (format: number): string => {
    return COLOR_FORMAT_NAMES[format] || `Unknown (0x${format.toString(16)})`;
  };

  // Get data format name for display
  const getDataFormatName = (format: number): string => {
    return DATA_FORMAT_NAMES[format] || `Unknown (0x${format.toString(16)})`;
  };

  // Extract filename from path
  const getFilename = (path: string): string => {
    return path.split("/").pop() || path;
  };

  return (
    <div
      ref={cardRef}
      className="pvr-image-container inline-block"
      style={{
        perspective: "1000px",
        transformStyle: "preserve-3d",
        borderRadius: "8px",
        padding: "6px",
      }}
      onMouseMove={handleMouseMove}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div>
        {header && (
          <div className="pvr-metadata pb-4">
            <h3 className="text-lg font-semibold mb-2">
              PVR Texture Information
            </h3>
            <table className="w-full border-collapse mb-4 text-sm">
              <tbody>
                <tr className="border-b border-gray-200">
                  <td className="py-2 pr-4 font-medium">File:</td>
                  <td className="py-2">
                    {assetPath ? getFilename(assetPath) : "N/A"}
                  </td>
                </tr>
                <tr className="border-b border-gray-200">
                  <td className="py-2 pr-4 font-medium">Data Format:</td>
                  <td className="py-2">
                    {getDataFormatName(header.dataFormat)}
                    <span className="text-gray-500 ml-2">
                      (0x{header.dataFormat.toString(16).padStart(2, "0")})
                    </span>
                  </td>
                </tr>
                <tr className="border-b border-gray-200">
                  <td className="py-2 pr-4 font-medium">Color Format:</td>
                  <td className="py-2">
                    {getFormatName(header.colorFormat)}
                    <span className="text-gray-500 ml-2">
                      (0x{header.colorFormat.toString(16).padStart(2, "0")})
                    </span>
                  </td>
                </tr>
                <tr className="border-b border-gray-200">
                  <td className="py-2 pr-4 font-medium">Dimensions:</td>
                  <td className="py-2">
                    {header.width} × {header.height} pixels
                  </td>
                </tr>
                <tr className="border-b border-gray-200">
                  <td className="py-2 pr-4 font-medium">Mipmaps:</td>
                  <td className="py-2">{header.hasMipmaps ? "Yes" : "No"}</td>
                </tr>
                {header.globalIndex !== undefined && (
                  <tr className="border-b border-gray-200">
                    <td className="py-2 pr-4 font-medium">GBIX:</td>
                    <td className="py-2">
                      0x{header.globalIndex.toString(16).padStart(8, "0")}
                    </td>
                  </tr>
                )}
                {header.usedExternalPalette && (
                  <tr className="border-b border-gray-200">
                    <td className="py-2 pr-4 font-medium">
                      Using External Palette:
                    </td>
                    <td className="py-2">Yes</td>
                  </tr>
                )}
              </tbody>
            </table>

            {paletteInfo && (
              <>
                <h3 className="text-lg font-semibold mb-2">
                  Palette Information
                </h3>
                <table className="w-full border-collapse mb-4 text-sm">
                  <tbody>
                    <tr className="border-b border-gray-200">
                      <td className="py-2 pr-4 font-medium">File:</td>
                      <td className="py-2">
                        {palettePath ? getFilename(palettePath) : "N/A"}
                      </td>
                    </tr>
                    <tr className="border-b border-gray-200">
                      <td className="py-2 pr-4 font-medium">Format:</td>
                      <td className="py-2">
                        {getFormatName(paletteInfo.format)}
                        <span className="text-gray-500 ml-2">
                          (0x{paletteInfo.format.toString(16).padStart(2, "0")})
                        </span>
                      </td>
                    </tr>
                    <tr className="border-b border-gray-200">
                      <td className="py-2 pr-4 font-medium">Colors:</td>
                      <td className="py-2">{paletteInfo.entryCount}</td>
                    </tr>
                  </tbody>
                </table>
              </>
            )}
          </div>
        )}

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
            willChange: "transform, box-shadow",
          }}
        />
      </div>
    </div>
  );
};

export default PVRImage;
