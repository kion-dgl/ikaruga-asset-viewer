import React, { useState, useEffect, useRef } from "react";
import { parsePvr, type PVRHeader } from "../lib/parsePvr";

interface PVMTexture {
  id?: number;
  index?: number;
  name?: string;
  format?: number;
  dimensions?: number;
  gbix?: number;
  data: ArrayBuffer;
  header?: PVRHeader;
  imageData?: ImageData;
  offset?: number; // Offset in the file where PVRT header starts
}

interface PVMHeader {
  magic: string;
  dataSize: number;
  textureFlags: number;
  textureCount: number;
}

interface PVMViewerProps {
  filePath: string;
  width?: number;
  height?: number;
}

const DreamcastPVMViewer: React.FC<PVMViewerProps> = ({
  filePath,
  width = 256,
  height = 256,
}) => {
  const [textures, setTextures] = useState<PVMTexture[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);

  // Function to parse PVM file
  const parsePVMFile = async (
    arrayBuffer: ArrayBuffer,
  ): Promise<PVMTexture[]> => {
    try {
      const dataView = new DataView(arrayBuffer);
      let offset = 0;

      // Read the PVM header magic
      const magic = String.fromCharCode(
        dataView.getUint8(offset),
        dataView.getUint8(offset + 1),
        dataView.getUint8(offset + 2),
        dataView.getUint8(offset + 3),
      );

      // Verify file signature (should be "PVMH")
      if (magic !== "PVMH") {
        throw new Error(
          `Invalid PVM file signature. Expected 'PVMH', got '${magic}'`,
        );
      }
      offset += 4;

      // Read header data size
      const dataSize = dataView.getUint32(offset, true);
      offset += 4;

      // Skip to end of header based on data size
      const textureFlags = dataView.getUint16(offset, true);
      offset += 2;

      const textureCount = dataView.getUint16(offset, true);
      offset += 2;

      // Parse texture entries
      const textureEntries: PVMTexture[] = [];

      for (let i = 0; i < textureCount; i++) {
        const texture: PVMTexture = {
          data: new ArrayBuffer(0),
        };

        // Read texture ID
        texture.id = dataView.getUint16(offset, true);
        texture.index = i;
        offset += 2;

        // Read name if flag is set (bit 3)
        if (textureFlags & 0x8) {
          let name = "";
          for (let j = 0; j < 0x1c; j++) {
            const charCode = dataView.getUint8(offset);
            offset += 1;
            if (charCode !== 0) {
              name += String.fromCharCode(charCode);
            }
          }
          texture.name = name;
        }

        // Read format if flag is set (bit 2)
        if (textureFlags & 0x4) {
          texture.format = dataView.getUint16(offset, true);
          offset += 2;
        }

        // Read dimensions if flag is set (bit 1)
        if (textureFlags & 0x2) {
          texture.dimensions = dataView.getUint16(offset, true);
          offset += 2;
        }

        // Read GBIX if flag is set (bit 0)
        if (textureFlags & 0x1) {
          texture.gbix = dataView.getUint32(offset, true);
          offset += 4;
        }

        textureEntries.push(texture);
      }

      // Now parse the actual texture data
      // Reset offset flags to read from the beginning
      offset = 8 + dataSize; // Skip PVMH header + size

      for (let i = 0; i < textureCount; i++) {
        // Find PVRT magic marker
        let foundPVRT = false;
        let searchStartOffset = offset;
        let attempts = 0;
        const maxAttempts = 5000; // Prevent infinite loops

        while (
          !foundPVRT &&
          offset < dataView.byteLength - 4 &&
          attempts < maxAttempts
        ) {
          const magic = String.fromCharCode(
            dataView.getUint8(offset),
            dataView.getUint8(offset + 1),
            dataView.getUint8(offset + 2),
            dataView.getUint8(offset + 3),
          );

          if (magic === "PVRT") {
            foundPVRT = true;
            // Found PVRT
          } else {
            offset += 1;
            attempts++;
          }
        }

        // Guard against not finding PVRT
        if (attempts >= maxAttempts) {
          // Max attempts reached
        }

        if (!foundPVRT) {
          throw new Error(`Could not find PVRT signature for texture ${i}`);
        }

        // Record start of this texture for extracting its buffer
        const textureStart = offset;

        // Store the offset in the file (in hex) for debugging
        textureEntries[i].offset = textureStart;

        // Read PVRT data size
        offset += 4; // Skip PVRT
        const pvrDataSize = dataView.getUint32(offset, true);
        offset += 4;

        // Calculate the total size of this PVR chunk
        const totalSize = 8 + pvrDataSize; // PVRT (4) + size (4) + data

        // Extract this texture's data
        // Make sure we don't go past the end of the buffer
        const endOffset = Math.min(
          textureStart + totalSize,
          arrayBuffer.byteLength,
        );
        const textureData = arrayBuffer.slice(textureStart, endOffset);

        // Validate that we have at least a minimum valid size for a PVR texture (header + some data)
        const minValidSize = 16; // Header size
        if (textureData.byteLength < minValidSize) {
          // Small texture data warning
        }

        textureEntries[i].data = textureData;

        // Move to next texture
        offset = textureStart + totalSize;
      }

      // Process each texture to get its PVR data
      const processedTextures = await Promise.all(
        textureEntries.map(async (texture) => {
          try {
            // Check that data isn't empty
            if (texture.data.byteLength === 0) {
              // Empty data buffer
              return texture;
            }

            // Parse texture data
            const { header, imageData } = await parsePvr(texture.data);
            return {
              ...texture,
              header,
              imageData,
            };
          } catch (err) {
            // Error parsing texture
            return texture;
          }
        }),
      );

      return processedTextures;
    } catch (err) {
      throw err;
    }
  };

  // Get format name for display
  const getColorFormatName = (format?: number): string => {
    if (format === undefined) return "Unknown";

    const COLOR_FORMAT_NAMES: Record<number, string> = {
      0x00: "ARGB1555",
      0x01: "RGB565",
      0x02: "ARGB4444",
      0x03: "YUV422",
      0x04: "BUMP",
      0x05: "RGB555",
      0x06: "ARGB8888",
    };

    return COLOR_FORMAT_NAMES[format] || `Unknown (0x${format.toString(16)})`;
  };

  // Get data format name for display
  const getDataFormatName = (format?: number): string => {
    if (format === undefined) return "Unknown";

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

    return DATA_FORMAT_NAMES[format] || `Unknown (0x${format.toString(16)})`;
  };

  // Load and parse the PVM file
  useEffect(() => {
    const loadPVMFile = async () => {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(`/iso/${filePath}`);

        if (!response.ok) {
          throw new Error(
            `Failed to load PVM file: ${response.status} ${response.statusText}`,
          );
        }

        const arrayBuffer = await response.arrayBuffer();
        const parsedTextures = await parsePVMFile(arrayBuffer);

        setTextures(parsedTextures);
        // Initialize canvas refs array with the correct length
        canvasRefs.current = Array(parsedTextures.length).fill(null);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to load PVM file",
        );
      } finally {
        setLoading(false);
      }
    };

    loadPVMFile();
  }, [filePath]);

  // Render a texture to a canvas
  const renderTexture = (
    canvas: HTMLCanvasElement | null,
    imageData: ImageData,
  ) => {
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Set canvas dimensions
    canvas.width = imageData.width;
    canvas.height = imageData.height;

    // Draw the image data
    ctx.putImageData(imageData, 0, 0);
  };

  // Render textures to canvases when data is loaded
  useEffect(() => {
    textures.forEach((texture, index) => {
      if (texture.imageData && canvasRefs.current[index]) {
        renderTexture(canvasRefs.current[index], texture.imageData);
      } else if (canvasRefs.current[index]) {
        // Draw a placeholder for textures that couldn't be parsed
        const canvas = canvasRefs.current[index];
        const ctx = canvas.getContext("2d");
        if (ctx) {
          // Set default dimensions
          canvas.width = 64;
          canvas.height = 64;

          // Draw error pattern
          ctx.fillStyle = "#f0f0f0";
          ctx.fillRect(0, 0, canvas.width, canvas.height);

          ctx.strokeStyle = "#ff0000";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo(canvas.width, canvas.height);
          ctx.moveTo(canvas.width, 0);
          ctx.lineTo(0, canvas.height);
          ctx.stroke();

          // Add text
          ctx.fillStyle = "#000000";
          ctx.font = "10px sans-serif";
          ctx.textAlign = "center";
          ctx.fillText("Parse Error", canvas.width / 2, canvas.height / 2);

          if (texture.offset !== undefined) {
            ctx.fillText(
              `0x${texture.offset.toString(16)}`,
              canvas.width / 2,
              canvas.height / 2 + 12,
            );
          }
        }
      }
    });
  }, [textures]);

  if (loading) {
    return <div className="pvm-viewer-loading">Loading PVM file...</div>;
  }

  if (error) {
    return <div className="pvm-viewer-error">Error: {error}</div>;
  }

  if (textures.length === 0) {
    return (
      <div className="pvm-viewer-error">No textures found in PVM file</div>
    );
  }

  return (
    <div className="dreamcast-pvm-viewer">
      <h2 className="text-xl font-bold mb-4">
        PVM Texture Pack: {filePath.split("/").pop()}
      </h2>
      <div className="text-sm mb-4">Contains {textures.length} textures</div>

      <div className="overflow-x-auto">
        <table className="min-w-full border-collapse">
          <thead>
            <tr className="bg-gray-100 text-left">
              <th className="p-2 border">Preview</th>
              <th className="p-2 border">ID</th>
              <th className="p-2 border">Name</th>
              <th className="p-2 border">Offset</th>
              <th className="p-2 border">Dimensions</th>
              <th className="p-2 border">GBIX</th>
              <th className="p-2 border">Data Format</th>
              <th className="p-2 border">Color Format</th>
              <th className="p-2 border">Mipmaps</th>
            </tr>
          </thead>
          <tbody>
            {textures.map((texture, index) => (
              <tr key={index} className="border-b">
                <td className="p-2 border">
                  <div className="flex justify-center">
                    <canvas
                      ref={(el: HTMLCanvasElement | null) => {
                        canvasRefs.current[index] = el;
                      }}
                      className="border border-gray-200"
                      style={{
                        maxWidth: "128px",
                        maxHeight: "128px",
                        objectFit: "contain",
                      }}
                    />
                  </div>
                </td>
                <td className="p-2 border">
                  {texture.id !== undefined ? texture.id : index}
                </td>
                <td className="p-2 border">
                  {texture.name || "Not specified"}
                </td>
                <td className="p-2 border">
                  {texture.offset !== undefined
                    ? `0x${texture.offset.toString(16).padStart(8, "0")}`
                    : "Unknown"}
                </td>
                <td className="p-2 border">
                  {texture.header
                    ? `${texture.header.width} × ${texture.header.height}`
                    : "Unknown"}
                </td>
                <td className="p-2 border">
                  {texture.gbix !== undefined
                    ? `0x${texture.gbix.toString(16).padStart(8, "0")}`
                    : "None"}
                </td>
                <td className="p-2 border">
                  {texture.header
                    ? getDataFormatName(texture.header.dataFormat)
                    : "Unknown"}
                </td>
                <td className="p-2 border">
                  {texture.header
                    ? getColorFormatName(texture.header.colorFormat)
                    : "Unknown"}
                </td>
                <td className="p-2 border">
                  {texture.header
                    ? texture.header.hasMipmaps
                      ? "Yes"
                      : "No"
                    : "Unknown"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default DreamcastPVMViewer;