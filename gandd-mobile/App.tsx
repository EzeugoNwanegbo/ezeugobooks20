import { StatusBar } from "expo-status-bar";
import { useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { WebView, type WebViewNavigation } from "react-native-webview";

const FALLBACK_WEB_URL = "http://192.168.100.16:3001/";

function normalizeUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return FALLBACK_WEB_URL;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

export default function App() {
  const configuredUrl = useMemo(
    () => normalizeUrl(process.env.EXPO_PUBLIC_GD_WEB_URL || FALLBACK_WEB_URL),
    [],
  );
  const webViewRef = useRef<WebView>(null);
  const [targetUrl, setTargetUrl] = useState(configuredUrl);
  const [draftUrl, setDraftUrl] = useState(configuredUrl);
  const [title, setTitle] = useState("G&D");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const openDraftUrl = () => {
    const nextUrl = normalizeUrl(draftUrl);
    setError(null);
    setTargetUrl(nextUrl);
    setDraftUrl(nextUrl);
  };

  const handleNavigation = (event: WebViewNavigation) => {
    if (event.title) setTitle(event.title);
    if (event.url) setDraftUrl(event.url);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.shell}
      >
        <View style={styles.header}>
          <View style={styles.brandRow}>
            <View style={styles.mark}>
              <Text style={styles.markText}>G</Text>
            </View>
            <View style={styles.titleBlock}>
              <Text style={styles.appName}>G&D Mobile</Text>
              <Text numberOfLines={1} style={styles.pageTitle}>
                {loading ? "Loading your study space..." : title}
              </Text>
            </View>
          </View>
          <View style={styles.urlRow}>
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              onChangeText={setDraftUrl}
              onSubmitEditing={openDraftUrl}
              placeholder="https://your-gandd-site.com"
              placeholderTextColor="#8a93a3"
              returnKeyType="go"
              style={styles.urlInput}
              value={draftUrl}
            />
            <Pressable onPress={openDraftUrl} style={styles.goButton}>
              <Text style={styles.goButtonText}>Open</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.webCard}>
          {error ? (
            <View style={styles.errorState}>
              <Text style={styles.errorTitle}>Could not open G&D</Text>
              <Text style={styles.errorText}>{error}</Text>
              <Text style={styles.errorHint}>
                If you are using the local server, keep your iPhone and laptop on the same Wi-Fi and
                use the laptop network address.
              </Text>
              <Pressable onPress={() => webViewRef.current?.reload()} style={styles.retryButton}>
                <Text style={styles.retryButtonText}>Try again</Text>
              </Pressable>
            </View>
          ) : (
            <WebView
              ref={webViewRef}
              allowsBackForwardNavigationGestures
              domStorageEnabled
              javaScriptEnabled
              mixedContentMode="always"
              onError={(event) => {
                setLoading(false);
                setError(event.nativeEvent.description || "The page failed to load.");
              }}
              onLoadEnd={() => setLoading(false)}
              onLoadStart={() => {
                setError(null);
                setLoading(true);
              }}
              onNavigationStateChange={handleNavigation}
              originWhitelist={["*"]}
              pullToRefreshEnabled
              sharedCookiesEnabled
              source={{ uri: targetUrl }}
              startInLoadingState
              style={styles.webView}
              thirdPartyCookiesEnabled
            />
          )}
          {loading && !error ? (
            <View pointerEvents="none" style={styles.loadingOverlay}>
              <ActivityIndicator color="#67e8f9" size="large" />
              <Text style={styles.loadingText}>Opening G&D...</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.footer}>
          <Pressable
            onPress={() => {
              setError(null);
              setTargetUrl(configuredUrl);
              setDraftUrl(configuredUrl);
            }}
            style={styles.footerButton}
          >
            <Text style={styles.footerButtonText}>Home</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              setError(null);
              webViewRef.current?.reload();
            }}
            style={styles.footerButton}
          >
            <Text style={styles.footerButtonText}>Reload</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#07111f",
  },
  shell: {
    flex: 1,
    backgroundColor: "#07111f",
  },
  header: {
    gap: 12,
    paddingBottom: 12,
    paddingHorizontal: 14,
    paddingTop: 10,
  },
  brandRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
  },
  mark: {
    alignItems: "center",
    backgroundColor: "#67e8f9",
    borderRadius: 10,
    height: 38,
    justifyContent: "center",
    width: 38,
  },
  markText: {
    color: "#07111f",
    fontSize: 18,
    fontWeight: "800",
  },
  titleBlock: {
    flex: 1,
    minWidth: 0,
  },
  appName: {
    color: "#f8fafc",
    fontSize: 18,
    fontWeight: "800",
  },
  pageTitle: {
    color: "#94a3b8",
    fontSize: 12,
    marginTop: 2,
  },
  urlRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  urlInput: {
    backgroundColor: "#101c2d",
    borderColor: "#243247",
    borderRadius: 10,
    borderWidth: 1,
    color: "#e2e8f0",
    flex: 1,
    fontSize: 13,
    minHeight: 42,
    paddingHorizontal: 12,
  },
  goButton: {
    alignItems: "center",
    backgroundColor: "#67e8f9",
    borderRadius: 10,
    justifyContent: "center",
    minHeight: 42,
    paddingHorizontal: 14,
  },
  goButtonText: {
    color: "#07111f",
    fontSize: 13,
    fontWeight: "800",
  },
  webCard: {
    backgroundColor: "#0f172a",
    flex: 1,
    overflow: "hidden",
  },
  webView: {
    backgroundColor: "#ffffff",
    flex: 1,
  },
  loadingOverlay: {
    alignItems: "center",
    backgroundColor: "rgba(7, 17, 31, 0.72)",
    bottom: 0,
    justifyContent: "center",
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  loadingText: {
    color: "#e2e8f0",
    fontSize: 13,
    fontWeight: "700",
    marginTop: 10,
  },
  errorState: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    padding: 24,
  },
  errorTitle: {
    color: "#f8fafc",
    fontSize: 20,
    fontWeight: "800",
    textAlign: "center",
  },
  errorText: {
    color: "#fecaca",
    fontSize: 14,
    marginTop: 10,
    textAlign: "center",
  },
  errorHint: {
    color: "#94a3b8",
    fontSize: 13,
    lineHeight: 19,
    marginTop: 12,
    textAlign: "center",
  },
  retryButton: {
    backgroundColor: "#67e8f9",
    borderRadius: 10,
    marginTop: 18,
    paddingHorizontal: 18,
    paddingVertical: 11,
  },
  retryButtonText: {
    color: "#07111f",
    fontWeight: "800",
  },
  footer: {
    borderTopColor: "#17243a",
    borderTopWidth: 1,
    flexDirection: "row",
    gap: 10,
    padding: 12,
  },
  footerButton: {
    alignItems: "center",
    backgroundColor: "#101c2d",
    borderColor: "#243247",
    borderRadius: 10,
    borderWidth: 1,
    flex: 1,
    paddingVertical: 11,
  },
  footerButtonText: {
    color: "#e2e8f0",
    fontSize: 13,
    fontWeight: "800",
  },
});
