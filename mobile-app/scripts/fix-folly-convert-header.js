#!/usr/bin/env node
/**
 * fix-folly-convert-header.js
 * 
 * Patches RCTFollyConvert.h in react-native to use a relative include path
 * instead of <react/utils/FollyConvert.h> which fails in EAS cloud builds.
 * 
 * Run as part of the EAS build process via package.json postinstall.
 */
const fs = require('fs');
const path = require('path');

const headerPath = path.join(
  __dirname,
  '../node_modules/react-native/React/CxxUtils/RCTFollyConvert.h'
);

if (!fs.existsSync(headerPath)) {
  console.log('ℹ️  RCTFollyConvert.h not found, skipping patch');
  process.exit(0);
}

let content = fs.readFileSync(headerPath, 'utf8');

// Check if already patched
if (content.includes('platform/ios/react/utils/FollyConvert.h')) {
  console.log('✅ RCTFollyConvert.h already patched');
  process.exit(0);
}

// Replace the include with the correct relative path
const original = '#include <react/utils/FollyConvert.h>';
const patched  = '#include <react/utils/platform/ios/react/utils/FollyConvert.h>';

if (!content.includes(original)) {
  console.log('⚠️  Expected include not found in RCTFollyConvert.h — may already be patched differently');
  console.log('Content:', content.substring(0, 300));
  process.exit(0);
}

content = content.replace(original, patched);
fs.writeFileSync(headerPath, content);
console.log('✅ Patched RCTFollyConvert.h include path for EAS cloud builds');
