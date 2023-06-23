import { Button } from "../lib/components";
import { Link } from "expo-router";
import { Text, View } from "react-native";

export default function Page() {
	return (
		<View>
			<Link href="/">Index Link</Link>
			<Text>Home page</Text>
			<Button onPress={() => alert("Clicked!")}>
				<Button.Text>Click me!</Button.Text>
			</Button>
		</View>
	);
}
