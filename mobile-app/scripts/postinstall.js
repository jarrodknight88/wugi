#!/usr/bin/env node
/**
 * postinstall.js
 * Creates a symlink so <react/utils/FollyConvert.h> resolves correctly
 * for @stripe/stripe-react-native with Expo SDK 54 / RN 0.81
 */
const fs   = require('fs');
const path = require('path');

const reactCommon = path.join(__dirname, 'node_modules/react-native/ReactCommon');
const target      = path.join(reactCommon, 'react/utils/platform/ios/react/utils/FollyConvert.h');
const linkDir     = path.join(reactCommon, 'react/utils');
const linkPath    = path.join(linkDir, 'FollyConvert.h');

// Only create if target exists and link doesn't
if (fs.existsSync(target) && !fs.existsSync(linkPath)) {
  try {
    fs.symlinkSync(target, linkPath);
    console.log('✅ Created FollyConvert.h symlink for stripe-react-native');
  } catch(e) {
    console.log('⚠️  Could not create FollyConvert.h symlink:', e.message);
  }
} else {
  console.log('ℹ️  FollyConvert.h symlink already exists or target not found');
}
