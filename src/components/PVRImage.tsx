import React, { useEffect, useRef, useState } from "react";
import { parsePvr } from "../lib/parsePvr";

interface PVRImageProps {
  assetPath?: string;
  alt?: string;
}

const PVRImage: React.FC<PVRImageProps> = ({
  assetPath,
  alt = "PVR Texture",
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

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
        drawPlaceholder(); // Show loading state

        // Fetch the PVR file
        const response = await fetch(`/iso/${assetPath}`);
        if (!response.ok) {
          throw new Error(`Failed to load texture: ${response.statusText}`);
        }

        const buffer = await response.arrayBuffer();
        const { header, imageData } = await parsePvr(buffer);

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
  }, [assetPath]); // Only re-run when assetPath changes

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
