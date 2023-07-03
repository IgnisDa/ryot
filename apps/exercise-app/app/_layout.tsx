import { queryClient } from "@/api";
import { AuthProvider } from "@/hooks";
import { ThemeProvider, createTheme } from "@rneui/themed";
import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";

const theme = createTheme({
	lightColors: {},
	darkColors: {},
});

export default function Layout() {
	return (
		<ThemeProvider theme={theme}>
			<QueryClientProvider client={queryClient}>
				<AuthProvider>
					<Stack screenOptions={{}} />
				</AuthProvider>
			</QueryClientProvider>
		</ThemeProvider>
	);
}
