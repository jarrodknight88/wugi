#!/usr/bin/env python3
"""Fix DiscoverScreen.tsx - map button on same row as search, blur timing fix"""

path = '/Users/jarrod/Documents/GitHub/wugi/mobile-app/src/screens/DiscoverScreen.tsx'

with open(path, 'r') as f:
    content = f.read()

# Fix 1: blur timing - prevents dropdown disappearing before tap
content = content.replace(
    'onBlur={() => setSearchFocused(false)}',
    'onBlur={() => setTimeout(() => setSearchFocused(false), 150)}'
)

# Fix 2: Close search input View, add map button inside search row, close row
old_search_close = '          </View>\n        </View>\n\n        {/* Recent searches dropdown */}'

map_button = (
    '          </View>\n'
    '          <TouchableOpacity\n'
    "            onPress={() => setShowMap(!showMap)}\n"
    "            style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: showMap ? theme.accent : theme.card, borderWidth: 1, borderColor: showMap ? theme.accent : theme.border, alignItems: 'center', justifyContent: 'center' }}\n"
    '          >\n'
    '            <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">\n'
    '              <Path d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-1.447-.894L15 9m0 8V9m0 0L9 7" stroke={showMap ? \'#fff\' : theme.subtext} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"/>\n'
    '            </Svg>\n'
    '          </TouchableOpacity>\n'
    '        </View>\n\n'
    '        {/* Recent searches dropdown */}'
)

content = content.replace(old_search_close, map_button, 1)

# Fix 3: Remove the orphaned separate map button View block
old_separate = (
    "        <View style={{ flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginTop: 8 }}>\n"
    '          <TouchableOpacity\n'
    "            onPress={() => setShowMap(!showMap)}\n"
    "            style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: showMap ? theme.accent : theme.card, borderWidth: 1, borderColor: showMap ? theme.accent : theme.border, alignItems: 'center', justifyContent: 'center' }}\n"
    '          >\n'
    '            <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">\n'
    '              <Path d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-1.447-.894L15 9m0 8V9m0 0L9 7" stroke={showMap ? \'#fff\' : theme.subtext} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"/>\n'
    '            </Svg>\n'
    '          </TouchableOpacity>\n'
    '        </View>'
)

if old_separate in content:
    content = content.replace(old_separate, '', 1)
    print('Removed orphaned map button')
else:
    print('Orphaned map button not found (may already be fixed)')

with open(path, 'w') as f:
    f.write(content)

print('blur fix applied:', 'setTimeout' in content)
print('map button in row:', 'height: 44' in content)
print('Done!')
