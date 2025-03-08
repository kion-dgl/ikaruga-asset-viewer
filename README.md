# Ikaruga Asset Viewer

<img src="src/assets/ikaruga-flat.png" alt="Ikaruga Logo" width="600">

An interactive viewer and documentation tool for exploring the game assets of Treasure's legendary shoot-em-up, Ikaruga.

## Overview

This project provides a comprehensive browser-based tool for examining and understanding the various file formats used in the Dreamcast/GameCube game Ikaruga. It combines technical documentation with interactive viewers that allow you to explore textures, 3D models, and other game assets.

## Features

- **Interactive File Viewers**: Examine PVR textures, NJ models, and other asset types directly in your browser
- **Technical Documentation**: Detailed specifications for Dreamcast file formats used in Ikaruga
- **Game Structure Analysis**: Exploration of how game assets are organized and related
- **WebAssembly-Powered**: Fast, native-like performance for asset parsing and viewing

## File Formats Supported

- **PVR**: PowerVR texture format used for all game textures
- **PVM**: Texture collections containing multiple PVR files
- **NJ**: SEGA "Ninja" 3D model format
- **BIN**: Various binary formats for game data

## Getting Started

### Installation

```bash
# Clone this repository
git clone https://github.com/yourusername/ikaruga-asset-viewer.git
cd ikaruga-asset-viewer

# Install dependencies
npm install

# Start the development server
npm run dev
```

### Usage

The application is organized into three main sections:

1. **Documentation**: Technical information about file formats and game structure
2. **Asset Viewer**: Interactive tool for exploring individual game assets
3. **File Browser**: Directory-based navigation of the game's file system

## Project Structure

```
ikaruga-asset-viewer/
├── public/               # Static assets and game files
│   └── data/             # Original game assets organized by folder
├── src/
│   ├── components/       # React components for viewers
│   ├── content/          # Starlight documentation and asset metadata
│   ├── layouts/          # Page layouts
│   ├── lib/              # Libraries for parsing file formats
│   └── pages/            # Astro pages
├── wasm/                 # WebAssembly modules for file parsing
│   └── pvm_extractor.c   # C code for extracting PVR textures from PVM files
└── README.md
```

## Development

This project uses:

- [Astro](https://astro.build/) for the framework
- [Starlight](https://starlight.astro.build/) for documentation
- [React](https://reactjs.org/) for interactive components
- [Three.js](https://threejs.org/) for 3D model rendering
- [WebAssembly](https://webassembly.org/) for file parsing

### Building WASM Components

The repository includes C code that can be compiled to WebAssembly using Emscripten:

```bash
# Install Emscripten if you haven't already
git clone https://github.com/emscripten-core/emsdk.git
cd emsdk
./emsdk install latest
./emsdk activate latest
source ./emsdk_env.sh

# Compile the PVM extractor
cd ../wasm
emcc pvm_extractor.c -o ../public/pvm_extractor.js -s EXPORTED_FUNCTIONS="['_malloc', '_free']" -s EXPORTED_RUNTIME_METHODS="['ccall', 'cwrap']" -s ALLOW_MEMORY_GROWTH=1
```

## Contributing

Contributions are welcome! If you'd like to help improve the project, please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- The original game assets belong to Treasure Co. Ltd.
