/* eslint-disable @typescript-eslint/no-require-imports */
const corePath = 'C:/Users/reetu/AppData/Roaming/npm/node_modules/@bubblewrap/cli/node_modules/@bubblewrap/core';
const {TwaManifest, TwaGenerator, ConsoleLog, BufferedLog} = require(corePath);
const fs = require('fs');
const path = require('path');

async function main() {
  const manifestUrl = 'https://kathakitaab.com/manifest.json';
  const targetDirectory = path.join(__dirname, 'android-wrapper');

  console.log('Fetching web manifest from:', manifestUrl);

  // Create TWA manifest from web manifest
  const twaManifest = await TwaManifest.fromWebManifest(manifestUrl);

  // Override defaults with our preferences
  twaManifest.packageId = 'com.kathakitaab.app';
  twaManifest.appVersionCode = 1;
  twaManifest.appVersionName = '1.0.0';
  twaManifest.generatorApp = 'bubblewrap-cli';

  console.log('TWA Manifest created:');
  console.log('  Package:', twaManifest.packageId);
  console.log('  Name:', twaManifest.name);
  console.log('  Host:', twaManifest.host);

  // Ensure directory exists
  if (!fs.existsSync(targetDirectory)) {
    fs.mkdirSync(targetDirectory, {recursive: true});
  }

  // Save twa-manifest.json
  const manifestFile = path.join(targetDirectory, 'twa-manifest.json');
  await twaManifest.saveToFile(manifestFile);
  console.log('Saved manifest to:', manifestFile);

  // Generate project
  const twaGenerator = new TwaGenerator();
  const log = new BufferedLog(new ConsoleLog('Generating TWA'));

  console.log('Generating Android project...');
  await twaGenerator.createTwaProject(targetDirectory, twaManifest, log);
  log.flush();

  console.log('Project generated successfully at:', targetDirectory);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
