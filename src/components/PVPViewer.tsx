import React, { useState, useEffect } from "react";

// Define the structure of a PVP file based on your documentation
interface PVPHeader {
  magic: string; // "PVPL" - Magic identifier
  dataSize: number; // Size of palette data
  format: number; // Color format (e.g., RGB565)
  entryCount: number; // Number of palette entries
}

interface PVPFile {
  header: PVPHeader;
  palette: number[]; // Array of color values
  isValid: boolean;
}

interface PVPViewerProps {
  filePath: string;
  width?: number; // Optional display width
  height?: number; // Optional display height
}

const DreamcastPVPViewer: React.FC<PVPViewerProps> = ({
  filePath,
  width = 512,
  height = 256,
}) => {
  const [pvpData, setPvpData] = useState<PVPFile | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedColor, setSelectedColor] = useState<number | null>(null);
  const [colorDetails, setColorDetails] = useState<{
    r: number;
    g: number;
    b: number;
    a: number;
  } | null>(null);

  // Function to parse PVP file
  const parsePVPFile = async (arrayBuffer: ArrayBuffer): Promise<PVPFile> => {
    try {
      const dataView = new DataView(arrayBuffer);

      // Read the PVP header
      const magic = String.fromCharCode(
        dataView.getUint8(0),
        dataView.getUint8(1),
        dataView.getUint8(2),
        dataView.getUint8(3),
      );

      // Verify file signature (should be "PVPL")
      const isValid = magic === "PVPL";

      if (!isValid) {
        throw new Error("Invalid PVP file signature. Expected 'PVPL'");
      }

      const header: PVPHeader = {
        magic,
        dataSize: dataView.getUint32(4, true),
        format: dataView.getUint32(8, true),
        entryCount: dataView.getUint16(14, true),
      };
      console.log(header);
      // Calculate header size
      const headerSize = 16; // Size of the header structure

      // Parse palette data
      const palette: number[] = [];
      let offset = headerSize;

      // Determine bytes per color entry based on format
      let bytesPerEntry = 2; // Default to 16-bit (2 bytes)
      if (header.format === 0x06) {
        // ARGB8888
        bytesPerEntry = 4; // 32-bit (4 bytes)
      }

      for (let i = 0; i < header.entryCount; i++) {
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
        header,
        palette,
        isValid,
      };
    } catch (err) {
      console.error("Error parsing PVP file:", err);
      return {
        header: {
          magic: "INVALID",
          dataSize: 0,
          format: 0,
          entryCount: 0,
        },
        palette: [],
        isValid: false,
      };
    }
  };

  // Convert color value to RGB components based on format
  const colorToRGBA = (colorValue: number, format: number) => {
    let r = 0,
      g = 0,
      b = 0,
      a = 255;

    switch (format) {
      case 0x00: // ARGB1555
        a = colorValue & 0x8000 ? 255 : 0;
        r = (((colorValue >> 10) & 0x1f) * 255) / 31;
        g = (((colorValue >> 5) & 0x1f) * 255) / 31;
        b = ((colorValue & 0x1f) * 255) / 31;
        break;

      case 0x01: // RGB565
        r = (((colorValue >> 11) & 0x1f) * 255) / 31;
        g = (((colorValue >> 5) & 0x3f) * 255) / 63;
        b = ((colorValue & 0x1f) * 255) / 31;
        break;

      case 0x02: // ARGB4444
        a = (((colorValue >> 12) & 0xf) * 255) / 15;
        r = (((colorValue >> 8) & 0xf) * 255) / 15;
        g = (((colorValue >> 4) & 0xf) * 255) / 15;
        b = ((colorValue & 0xf) * 255) / 15;
        break;

      case 0x05: // RGB555
        r = (((colorValue >> 10) & 0x1f) * 255) / 31;
        g = (((colorValue >> 5) & 0x1f) * 255) / 31;
        b = ((colorValue & 0x1f) * 255) / 31;
        break;

      case 0x06: // ARGB8888
        a = (colorValue >> 24) & 0xff;
        r = (colorValue >> 16) & 0xff;
        g = (colorValue >> 8) & 0xff;
        b = colorValue & 0xff;
        break;

      default:
        console.warn("Unknown color format:", format);
    }

    return {
      r: Math.round(r),
      g: Math.round(g),
      b: Math.round(b),
      a: Math.round(a),
    };
  };

  // Function to render the palette to canvas
  const renderPalette = (canvas: HTMLCanvasElement | null) => {
    if (!canvas || !pvpData) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { format, entryCount } = pvpData.header;
    const { palette } = pvpData;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Calculate swatch size based on entry count
    // For 16 colors: 4x4 grid, for 256 colors: 16x16 grid
    const cols = entryCount <= 16 ? 4 : 16;
    const rows = Math.ceil(entryCount / cols);

    const swatchWidth = canvas.width / cols;
    const swatchHeight = canvas.height / rows;

    // Draw each color swatch
    for (let i = 0; i < entryCount; i++) {
      const x = (i % cols) * swatchWidth;
      const y = Math.floor(i / cols) * swatchHeight;

      const { r, g, b, a } = colorToRGBA(palette[i], format);

      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${a / 255})`;
      ctx.fillRect(x, y, swatchWidth, swatchHeight);

      // Add border
      ctx.strokeStyle = "rgba(0, 0, 0, 0.3)";
      ctx.strokeRect(x, y, swatchWidth, swatchHeight);

      // Highlight selected color
      if (selectedColor === i) {
        ctx.strokeStyle = "white";
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 2, y + 2, swatchWidth - 4, swatchHeight - 4);
        ctx.lineWidth = 1;
      }
    }
  };

  // Load and parse the PVP file
  useEffect(() => {
    const loadPVPFile = async () => {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(`/iso/${filePath}`);

        if (!response.ok) {
          throw new Error(
            `Failed to load PVP file: ${response.status} ${response.statusText}`,
          );
        }

        const arrayBuffer = await response.arrayBuffer();
        const parsedData = await parsePVPFile(arrayBuffer);

        if (!parsedData.isValid) {
          throw new Error("Invalid PVP file format");
        }

        setPvpData(parsedData);
      } catch (err) {
        console.error("Error loading PVP file:", err);
        setError(
          err instanceof Error ? err.message : "Failed to load PVP file",
        );
      } finally {
        setLoading(false);
      }
    };

    loadPVPFile();
  }, [filePath]);

  // Render the palette to canvas when data changes
  useEffect(() => {
    const canvas = document.getElementById("pvp-canvas") as HTMLCanvasElement;
    renderPalette(canvas);
  }, [pvpData, selectedColor]);

  // Handle canvas click to select a color
  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!pvpData || !e.currentTarget) return;

    const canvas = e.currentTarget;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const { entryCount } = pvpData.header;
    const cols = entryCount <= 16 ? 4 : 16;

    const swatchWidth = canvas.width / cols;
    const swatchHeight = canvas.height / Math.ceil(entryCount / cols);

    const col = Math.floor(x / swatchWidth);
    const row = Math.floor(y / swatchHeight);

    const index = row * cols + col;

    if (index >= 0 && index < entryCount) {
      setSelectedColor(index);
      setColorDetails(
        colorToRGBA(pvpData.palette[index], pvpData.header.format),
      );
    }
  };

  // Get color format name
  const getFormatName = (format: number): string => {
    switch (format) {
      case 0x00:
        return "ARGB1555";
      case 0x01:
        return "RGB565";
      case 0x02:
        return "ARGB4444";
      case 0x05:
        return "RGB555";
      case 0x06:
        return "ARGB8888";
      default:
        return `Unknown (${format})`;
    }
  };

  if (loading) {
    return <div className="pvp-viewer-loading">Loading PVP file...</div>;
  }

  if (error) {
    return <div className="pvp-viewer-error">Error: {error}</div>;
  }

  if (!pvpData) {
    return <div className="pvp-viewer-error">No PVP data available</div>;
  }

  const { header } = pvpData;

  return (
    <div className="dreamcast-pvp-viewer">
      <div className="pvp-preview">
        <canvas
          id="pvp-canvas"
          width={width}
          height={height}
          onClick={handleCanvasClick}
          style={{
            border: "1px solid #ccc",
            cursor: "pointer",
          }}
        />
      </div>

      <div className="pvp-metadata">
        <h3>PVP Palette Information</h3>
        <table>
          <tbody>
            <tr>
              <td>Format:</td>
              <td>{getFormatName(header.format)}</td>
            </tr>
            <tr>
              <td>Colors:</td>
              <td>{header.entryCount}</td>
            </tr>
            <tr>
              <td>Data Size:</td>
              <td>{header.dataSize} bytes</td>
            </tr>
          </tbody>
        </table>

        {selectedColor !== null && colorDetails && (
          <div className="color-details">
            <h4>Selected Color (Index: {selectedColor})</h4>
            <div
              className="color-preview"
              style={{
                backgroundColor: `rgba(${colorDetails.r}, ${colorDetails.g}, ${colorDetails.b}, ${colorDetails.a / 255})`,
                width: "50px",
                height: "50px",
                border: "1px solid #ccc",
                marginBottom: "10px",
              }}
            />
            <div>
              RGB: {colorDetails.r}, {colorDetails.g}, {colorDetails.b}
            </div>
            <div>Alpha: {colorDetails.a}</div>
            <div>
              Hex: #{colorDetails.r.toString(16).padStart(2, "0")}
              {colorDetails.g.toString(16).padStart(2, "0")}
              {colorDetails.b.toString(16).padStart(2, "0")}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default DreamcastPVPViewer;
