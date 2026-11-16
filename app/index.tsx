import { StyleSheet, Text, View } from 'react-native';

import { texts } from '@/texts/ro';

export default function HomeScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{texts.common.appName}</Text>
      <Text style={styles.subtitle}>{texts.home.comingSoon}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { fontSize: 28, fontWeight: '700', marginBottom: 8 },
  subtitle: { fontSize: 16, textAlign: 'center', color: '#555' },
});
