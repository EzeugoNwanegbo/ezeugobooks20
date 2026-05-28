import { StatusBar } from "expo-status-bar";
import { useMemo, useRef, useState } from "react";
import { Pressable, SafeAreaView, StyleSheet, Text, View } from "react-native";
import { WebView } from "react-native-webview";

const FALLBACK_WEB_URL = "";
const WEB_APP_CACHE_REV = "mobile-split-menu-peek-v2";

const nativeAppBootstrap = `
  (function () {
    try {
      localStorage.setItem("gd_native_app", "1");
    } catch (error) {}
    document.documentElement.classList.add("gd-native-app");
  })();
  true;
`;

function normalizeUrl(value?: string) {
  const trimmed = (value || FALLBACK_WEB_URL).trim();
  if (!trimmed) return FALLBACK_WEB_URL;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function withCacheBust(url: string, rev: string) {
  const hashIndex = url.indexOf("#");
  const base = hashIndex === -1 ? url : url.slice(0, hashIndex);
  const hash = hashIndex === -1 ? "" : url.slice(hashIndex);
  const separator = base.includes("?") ? "&" : "?";

  return `${base}${separator}gd_mobile_rev=${encodeURIComponent(rev)}${hash}`;
}

export default function App() {
  const webUrl = useMemo(
    () => normalizeUrl(process.env.EXPO_PUBLIC_GD_WEB_URL || FALLBACK_WEB_URL),
    [],
  );
  const webViewRef = useRef<WebView>(null);
  const [webViewKey, setWebViewKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const webViewUrl = useMemo(
    () => withCacheBust(webUrl, `${WEB_APP_CACHE_REV}-${webViewKey}`),
    [webUrl, webViewKey],
  );
  const displayError = error || (!webUrl ? "The G&D website URL is not configured." : null);

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <View style={styles.shell}>
        {displayError ? (
          <View style={styles.errorState}>
            <View style={styles.mark}>
              <Text style={styles.markText}>G&D</Text>
            </View>
            <Text style={styles.errorTitle}>G&D could not open</Text>
            <Text style={styles.errorText}>{displayError}</Text>
            <Text style={styles.errorHint}>
              For local testing, set EXPO_PUBLIC_GD_WEB_URL in .env. For Play Store builds, use the
              deployed HTTPS website URL.
            </Text>
            <Pressable
              onPress={() => {
                setError(null);
                setWebViewKey((key) => key + 1);
              }}
              style={styles.retryButton}
            >
              <Text style={styles.retryButtonText}>Open again</Text>
            </Pressable>
          </View>
        ) : (
          <WebView
            key={webViewKey}
            ref={webViewRef}
            allowFileAccess
            allowsBackForwardNavigationGestures
            allowsLinkPreview={false}
            bounces={false}
            cacheEnabled={false}
            cacheMode="LOAD_NO_CACHE"
            domStorageEnabled
            incognito={false}
            injectedJavaScriptBeforeContentLoaded={nativeAppBootstrap}
            javaScriptEnabled
            mixedContentMode="always"
            onError={(event) => {
              setError(event.nativeEvent.description || "The page failed to load.");
            }}
            onRenderProcessGone={(event) => {
              // Android kills the WebView renderer when it runs low on memory —
              // commonly while the file picker is in the foreground or when a
              // large upload is loaded into memory. Without this handler the
              // WebView is left as a permanent blank white page. Remount it so
              // the app recovers instead of going blank.
              console.warn("WebView renderer gone", event.nativeEvent?.didCrash);
              setWebViewKey((key) => key + 1);
            }}
            onContentProcessDidTerminate={() => {
              // iOS equivalent of onRenderProcessGone.
              setWebViewKey((key) => key + 1);
            }}
            originWhitelist={["*"]}
            pullToRefreshEnabled={false}
            scrollEnabled
            setSupportMultipleWindows={false}
            sharedCookiesEnabled
            source={{ uri: webViewUrl }}
            style={styles.webView}
            thirdPartyCookiesEnabled
          />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: "#0e0d0b",
    flex: 1,
  },
  shell: {
    backgroundColor: "#0e0d0b",
    flex: 1,
  },
  webView: {
    backgroundColor: "#0e0d0b",
    flex: 1,
  },
  errorState: {
    alignItems: "center",
    backgroundColor: "#0e0d0b",
    flex: 1,
    justifyContent: "center",
    padding: 24,
  },
  mark: {
    alignItems: "center",
    borderColor: "rgba(245, 240, 232, 0.18)",
    borderRadius: 12,
    borderWidth: 1,
    height: 54,
    justifyContent: "center",
    marginBottom: 18,
    width: 74,
  },
  markText: {
    color: "#f5f0e8",
    fontSize: 18,
    fontWeight: "800",
  },
  errorTitle: {
    color: "#f5f0e8",
    fontSize: 22,
    fontWeight: "800",
    textAlign: "center",
  },
  errorText: {
    color: "#d9d0c2",
    fontSize: 14,
    lineHeight: 20,
    marginTop: 10,
    textAlign: "center",
  },
  errorHint: {
    color: "#8a8680",
    fontSize: 13,
    lineHeight: 19,
    marginTop: 12,
    textAlign: "center",
  },
  retryButton: {
    backgroundColor: "#f5f0e8",
    borderRadius: 10,
    marginTop: 20,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  retryButtonText: {
    color: "#0e0d0b",
    fontSize: 14,
    fontWeight: "800",
  },
});
