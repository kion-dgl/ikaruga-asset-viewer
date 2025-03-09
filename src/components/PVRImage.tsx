import React, { useEffect, useRef } from "react";

interface PVRImageProps {
  width?: number;
  height?: number;
  assetPath?: string;
  alt?: string;
}

const PVRImage: React.FC<PVRImageProps> = ({
  width = 256,
  height = 256,
  assetPath = "",
  alt = "PVR Texture",
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Ensure the canvas is drawn after component mount and on any prop changes
  useEffect(() => {
    drawCanvas();
  }, [width, height, assetPath]);

  // Function to draw on the canvas
  const drawCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Draw a simple gradient background
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, "#3b82f6"); // Blue
    gradient.addColorStop(1, "#8b5cf6"); // Violet

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    // Add text showing the asset path
    ctx.fillStyle = "white";
    ctx.font = "16px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(assetPath || "PVR Texture", width / 2, height / 2);
  };

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className="block"
      aria-label={alt}
      style={{
        borderRadius: "8px",
        overflow: "hidden",
        border: "2px solid white",
        boxShadow: "0 4px 6px rgba(0, 0, 0, 0.1)",
      }}
    />
  );
};

export default PVRImage;
