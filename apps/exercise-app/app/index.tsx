import { Link } from "expo-router";
import { Text, View } from "react-native";

export default function Page() {
	return (
		<View>
			<Link href="/home">Home Link Wow</Link>
			<Text>Index page</Text>
		</View>
	);
}
