const { getDefaultConfig } = require('expo/metro-config');
const config = getDefaultConfig(__dirname);
// WOFF2 assets serve the same complete Inter fonts with a smaller web transfer.
config.resolver.assetExts.push('woff2');
const existing = config.resolver.blockList;
// Artefatos e sockets dos emuladores não são módulos do aplicativo.
config.resolver.blockList = [
  ...(Array.isArray(existing) ? existing : existing ? [existing] : []),
  /[/\\]\.local(?:[/\\].*)?$/,
];
module.exports = config;
