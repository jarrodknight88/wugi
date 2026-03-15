import { View, Text, StyleSheet } from 'react-native';

export default function ForYouScreen() {
  return (
    <View style={styles.container}>
      <Text>For You</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
