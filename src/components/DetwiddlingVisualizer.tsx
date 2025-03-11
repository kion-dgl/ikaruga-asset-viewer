// DetwiddlingVisualizer.tsx
import React, { useState } from "react";

// Define prop types
interface DetwiddlingVisualizerProps {
  initialWidth?: number;
  initialHeight?: number;
}

// Utility function to interleave bits (for Z-order/Morton code)
const interleave = (x: number, y: number): number => {
  let result = 0;
  for (let i = 0; i < 8; i++) {
    result |= ((x & (1 << i)) << i) | ((y & (1 << i)) << (i + 1));
  }
  return result;
};

// Calculate Morton/Z-order number for coordinates
const getMortonNumber = (x: number, y: number): number => {
  return interleave(x >> 1, y >> 1) * 4 + (y & 1) * 2 + (x & 1);
};

const DetwiddlingVisualizer: React.FC<DetwiddlingVisualizerProps> = ({
  initialWidth = 128,
  initialHeight = 128,
}) => {
  const validSizes = [1, 2, 4, 8, 16, 32, 64, 128, 256];
  const [width, setWidth] = useState<number>(initialWidth);
  const [height, setHeight] = useState<number>(initialHeight);
  const [cellSize, setCellSize] = useState<number>(20); // Size of each cell in pixels
  const [showNumbersOnly, setShowNumbersOnly] = useState<boolean>(false);

  // Handle width change
  const handleWidthChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setWidth(parseInt(e.target.value, 10));
  };

  // Handle height change
  const handleHeightChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setHeight(parseInt(e.target.value, 10));
  };

  // Handle cell size change
  const handleCellSizeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setCellSize(parseInt(e.target.value, 10));
  };

  // Toggle between showing all blocks or just numbers
  const toggleNumbersOnly = () => {
    setShowNumbersOnly(!showNumbersOnly);
  };

  // Calculate grid dimensions in 2x2 blocks
  const blocksWidth = width / 2;
  const blocksHeight = height / 2;

  // Generate grid data
  const generateGrid = () => {
    const grid = [];

    for (let blockY = 0; blockY < blocksHeight; blockY++) {
      for (let blockX = 0; blockX < blocksWidth; blockX++) {
        // Get the Morton number for this 2x2 block
        const blockIndex = getMortonNumber(blockX, blockY);

        // Add the four pixels in the 2x2 block
        grid.push({
          x: blockX * 2,
          y: blockY * 2,
          value: blockIndex * 4 + 0,
        });
        grid.push({
          x: blockX * 2,
          y: blockY * 2 + 1,
          value: blockIndex * 4 + 1,
        });
        grid.push({
          x: blockX * 2 + 1,
          y: blockY * 2,
          value: blockIndex * 4 + 2,
        });
        grid.push({
          x: blockX * 2 + 1,
          y: blockY * 2 + 1,
          value: blockIndex * 4 + 3,
        });
      }
    }

    return grid;
  };

  // Style for the grid container
  const gridStyle: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: `repeat(${width}, ${cellSize}px)`,
    gridTemplateRows: `repeat(${height}, ${cellSize}px)`,
    gap: "1px",
    border: "1px solid #000",
    width: "fit-content",
    margin: "20px 0",
  };

  return (
    <div className="detwiddling-visualizer">
      <h1>Dreamcast PVR Detwiddling Visualizer</h1>

      <div className="controls" style={{ marginBottom: "20px" }}>
        <div style={{ marginBottom: "10px" }}>
          <label htmlFor="width" style={{ marginRight: "10px" }}>
            Width:
          </label>
          <select
            id="width"
            value={width}
            onChange={handleWidthChange}
            style={{ marginRight: "20px" }}
          >
            {validSizes.map((size) => (
              <option key={`width-${size}`} value={size}>
                {size}
              </option>
            ))}
          </select>

          <label htmlFor="height" style={{ marginRight: "10px" }}>
            Height:
          </label>
          <select id="height" value={height} onChange={handleHeightChange}>
            {validSizes.map((size) => (
              <option key={`height-${size}`} value={size}>
                {size}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="cellSize" style={{ marginRight: "10px" }}>
            Cell Size (px):
          </label>
          <input
            type="range"
            id="cellSize"
            min="10"
            max="40"
            value={cellSize}
            onChange={handleCellSizeChange}
            style={{ marginRight: "10px", verticalAlign: "middle" }}
          />
          <span>{cellSize}px</span>

          <div style={{ marginTop: "10px" }}>
            <label>
              <input
                type="checkbox"
                checked={showNumbersOnly}
                onChange={toggleNumbersOnly}
                style={{ marginRight: "5px" }}
              />
              Show numbers only (hide grid)
            </label>
          </div>
        </div>
      </div>

      {width <= 128 && height <= 128 ? (
        <div
          className="grid-container"
          style={{ overflow: "auto", maxWidth: "100%", maxHeight: "70vh" }}
        >
          <div style={gridStyle}>
            {generateGrid().map((cell) => (
              <div
                key={`${cell.x}-${cell.y}`}
                style={{
                  width: `${cellSize}px`,
                  height: `${cellSize}px`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: "#f0f0f0",
                  border: showNumbersOnly ? "none" : "1px solid #ccc",
                  fontSize: `${Math.max(8, cellSize / 3)}px`,
                  gridColumn: cell.x + 1,
                  gridRow: cell.y + 1,
                  position: "relative",
                }}
              >
                {cell.value}

                {!showNumbersOnly && cell.x % 2 === 0 && cell.y % 2 === 0 && (
                  <div
                    style={{
                      position: "absolute",
                      width: `${cellSize * 2 + 1}px`,
                      height: `${cellSize * 2 + 1}px`,
                      border: "1px solid #666",
                      pointerEvents: "none",
                      zIndex: 1,
                    }}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="warning" style={{ color: "red", marginTop: "20px" }}>
          <p>
            Warning: Visualizing textures larger than 128x128 may cause
            performance issues.
          </p>
          <p>The full table would contain {width * height} cells.</p>
        </div>
      )}

      <div className="explanation" style={{ marginTop: "20px" }}>
        <h3>About Dreamcast PVR Detwiddling</h3>
        <p>
          The Dreamcast PowerVR graphics hardware stores textures in memory
          using a "twiddled" format, which follows a Z-order (Morton order)
          curve. This visualization shows the memory address order of each pixel
          in the twiddled format.
        </p>
        <p>
          To detwiddle a texture, you would read the texture data sequentially
          from memory and place each pixel at the position indicated by these
          numbers to reconstruct the original image.
        </p>
        <p>
          This approach optimizes texture cache coherence by keeping spatially
          local pixels close together in memory.
        </p>
      </div>
    </div>
  );
};

export default DetwiddlingVisualizer;
