import { queryClient } from "@/api";
import { AuthProvider } from "@/hooks";
import { ThemeProvider, createTheme } from "@rneui/themed";
import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { SafeAreaProvider } from "react-native-safe-area-context";

const theme = createTheme({
	lightColors: {},
	darkColors: {},
});

export default function Layout() {
	return (
		<SafeAreaProvider>
			<ThemeProvider theme={theme}>
				<QueryClientProvider client={queryClient}>
					<AuthProvider>
						<Stack screenOptions={{ headerShown: false }} />
					</AuthProvider>
				</QueryClientProvider>
			</ThemeProvider>
		</SafeAreaProvider>
	);
}
