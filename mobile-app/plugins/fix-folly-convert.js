/**
 * fix-folly-convert.js
 * Custom Expo config plugin — patches Podfile post_install to fix
 * FollyConvert.h header path for stripe-react-native on RN 0.81 / SDK 54.
 * Runs during expo prebuild on local and EAS cloud builds.
 */
const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const withFollyConvertFix = (config) => {
  return withDangerousMod(config, [
    'ios',
    async (config) => {
      const podfilePath = path.join(config.modRequest.platformProjectRoot, 'Podfile');
      let podfile = fs.readFileSync(podfilePath, 'utf8');

      const patchMarker = '# [FollyConvert patch applied]';
      if (podfile.includes(patchMarker)) return config;

      const patch = `
    ${patchMarker}
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |cfg|
        cfg.build_settings['CLANG_ALLOW_NON_MODULAR_INCLUDES_IN_FRAMEWORK_MODULES'] = 'YES'
        if target.name == 'stripe-react-native'
          rn_path = File.join(File.dirname(__FILE__), '..', 'node_modules', 'react-native')
          rc_path = File.join(rn_path, 'ReactCommon')
          folly_path = File.join(rn_path, 'ReactCommon', 'react', 'utils', 'platform', 'ios')
          existing = cfg.build_settings['HEADER_SEARCH_PATHS'] || ['$(inherited)']
          existing = [existing] if existing.is_a?(String)
          cfg.build_settings['HEADER_SEARCH_PATHS'] = existing + [rc_path, folly_path, "\#{rn_path}/React"]
        end
      end
    end`;

      // Insert patch just before the closing end of post_install block
      podfile = podfile.replace(
        /([ \t]*react_native_post_install\([^)]+\)\n)/,
        `$1${patch}\n`
      );

      fs.writeFileSync(podfilePath, podfile);
      return config;
    },
  ]);
};

module.exports = withFollyConvertFix;
