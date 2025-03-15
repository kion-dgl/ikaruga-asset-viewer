import { readdirSync, writeFileSync, existsSync, readFileSync } from "fs";

// Path to directory containing files
const dir = "/Users/kion/dev/ikaruga-asset-viewer/public/iso/OBJ";
const outputDir = "/Users/kion/dev/ikaruga-asset-viewer/src/content/docs/reference/OBJ";

// Get all PVM files
const pvmFiles = readdirSync(dir).filter((file) => file.endsWith(".PVM"));
console.log(`Found ${pvmFiles.length} PVM files`);

// Get all NJ files
const njFiles = readdirSync(dir).filter((file) => file.endsWith(".NJ"));
console.log(`Found ${njFiles.length} NJ files`);

// Generate MDX files for PVM textures
pvmFiles.forEach((file) => {
  const baseName = file.replace(".PVM", "");
  const mdxPath = `${outputDir}/${baseName}.mdx`;
  
  // Check if corresponding NJ file exists
  const hasNJFile = njFiles.includes(`${baseName}.NJ`);
  
  // Only write the file if it doesn't already contain an NJViewer
  const mdxExists = existsSync(mdxPath);
  let shouldWrite = true;
  
  if (mdxExists) {
    const content = readFileSync(mdxPath, "utf8");
    if (content.includes("NJViewer")) {
      // File already contains an NJViewer component, don't overwrite
      shouldWrite = false;
    }
  }
  
  if (shouldWrite) {
    writeFileSync(
      mdxPath,
      `---
title: ${baseName}
description: Texture used in Ikaruga
---

import PVMViewer from '@components/PVMViewer';
${hasNJFile ? 'import NJViewer from "@components/NjViewer";' : ''}

# ${baseName}

${hasNJFile ? `
## 3D Model

<NJViewer 
  client:load
  modelPath="OBJ/${baseName}.NJ" 
  texturePaths={["OBJ/${file}"]}
  width={600}
  height={400}
/>

## Texture` : '## Texture'}

<PVMViewer
  client:load
  filePath="OBJ/${file}"
/>
`,
    );
    console.log(`Created/Updated ${mdxPath}`);
  }
});

// Generate MDX files for NJ models that don't have PVM files
njFiles.forEach((file) => {
  const baseName = file.replace(".NJ", "");
  const mdxPath = `${outputDir}/${baseName}.mdx`;
  
  // Check if corresponding PVM file exists
  const hasPVMFile = pvmFiles.includes(`${baseName}.PVM`);
  
  // Skip if PVM file exists (already handled above)
  if (!hasPVMFile) {
    writeFileSync(
      mdxPath,
      `---
title: ${baseName}
description: 3D model used in Ikaruga
---

import NJViewer from '@components/NjViewer';

# ${baseName}

## 3D Model

<NJViewer 
  client:load
  modelPath="OBJ/${file}"
  width={600}
  height={400}
/>

This model does not have an associated texture file.
`,
    );
    console.log(`Created ${mdxPath}`);
  }
});
