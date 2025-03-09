import React, { useEffect, useRef, useState } from "react";

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
  const cardRef = useRef<HTMLDivElement>(null);

  // State for tracking mouse position
  const [rotation, setRotation] = useState({ x: 0, y: 0 });
  const [isHovering, setIsHovering] = useState(false);

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
    const rotateX = (y / rect.height - 0.5) * -40; // -10 to 10 degrees
    const rotateY = (x / rect.width - 0.5) * 40; // -10 to 10 degrees

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
          width={width}
          height={height}
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
