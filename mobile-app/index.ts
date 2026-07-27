import { registerRootComponent } from 'expo';

import App from './App';
import { initCrashlytics } from './src/lib/crashlyticsService';

// Enable Crashlytics collection (release builds only — see crashlyticsService)
// before anything else mounts, so it's ready to catch startup-time crashes.
initCrashlytics();

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
