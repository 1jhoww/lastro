const { getDefaultConfig } = require('expo/metro-config');
const config = getDefaultConfig(__dirname);
const existing = config.resolver.blockList;
// Artefatos e sockets dos emuladores não são módulos do aplicativo.
config.resolver.blockList = [
  ...(Array.isArray(existing) ? existing : existing ? [existing] : []),
  /[/\\]\.local(?:[/\\].*)?$/,
];
module.exports = config;
