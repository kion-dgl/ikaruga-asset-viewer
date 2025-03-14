import { readdirSync, writeFileSync } from "fs";
const dir = "/Users/kion/dev/ikaruga-asset-viewer/public/iso/OBJ";
const files = readdirSync(dir).filter((file) => file.endsWith(".PVM"));
console.log(files);

files.forEach((file) => {
  writeFileSync(
    file.replace("PVM", "mdx"),
    `---
title: ${file.replace(".PVM", "")}
description: A sprite or something
---

import PVMViewer from '@components/PVMViewer';

<PVMViewer
  client:load
  filePath="OBJ/${file}"
/>
`,
  );
});
