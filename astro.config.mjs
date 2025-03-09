// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

import react from "@astrojs/react";

// https://astro.build/config
export default defineConfig({
  integrations: [starlight({
    title: "Ikaruga Assets",
    social: {
      github: "https://github.com/withastro/starlight",
    },
    sidebar: [
      {
        label: "File Types",
        autogenerate: { directory: "guides" },
      },
      {
        label: "Reference",
        autogenerate: { directory: "reference" },
      },
    ],
  }), react()],
});