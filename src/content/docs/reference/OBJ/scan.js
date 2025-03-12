import { readdirSync, writeFileSync } from "fs";
const dir = "/Users/kion/dev/ikaruga-asset-viewer/public/iso/OBJ";
const files = readdirSync(dir).filter((file) => file.endsWith(".PVR"));
console.log(files);

files.forEach((file) => {
  writeFileSync(
    file.replace("PVR", "mdx"),
    `---
title: ${file.replace(".PVR", "")}
description: A sprite or something
---

import PVRImage from '@components/PVRImage';


<PVRImage
  client:load
  assetPath="OBJ/${file}"
/>
`,
  );
});
