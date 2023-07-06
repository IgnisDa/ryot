import { SafeAreaView } from "react-native-safe-area-context";

export const BasePage = ({ children }) => {
	return (
		<SafeAreaView style={{ paddingHorizontal: 10 }}>{children}</SafeAreaView>
	);
};
