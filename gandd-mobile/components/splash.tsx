import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { colors } from "@/lib/theme";
import { BrandText } from "./ui";

export function Splash({ subtitle }: { subtitle?: string }) {
  return (
    <View style={styles.root}>
      <BrandText size={48} />
      <ActivityIndicator style={{ marginTop: 24 }} color={colors.accent} />
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  subtitle: {
    marginTop: 14,
    color: colors.mutedDim,
    fontSize: 13,
  },
});
