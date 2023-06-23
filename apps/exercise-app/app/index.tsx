import { URL_KEY } from "../lib/api";
import { Button, Center, FormControl, Input, Spinner } from "../lib/components";
import { ROUTES } from "../lib/constants";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { CoreEnabledFeaturesDocument } from "@ryot/generated/src/graphql/backend/graphql";
import { useRouter } from "expo-router";
import request from "graphql-request";
import { useEffect, useState } from "react";
import { SafeAreaView } from "react-native";

const getChecker = async (url: string) => {
	const { coreEnabledFeatures } = await request(
		`${url}/graphql`,
		CoreEnabledFeaturesDocument,
	);
	return coreEnabledFeatures;
};

export default function Page() {
	const [url, setUrl] = useState("");
	const [isLoading, setIsLoading] = useState(false);
	const router = useRouter();

	useEffect(() => {
		(async () => {
			const url = await AsyncStorage.getItem(URL_KEY);
			if (url) {
				const check = await getChecker(url);
				if (check) router.push(ROUTES.auth.login);
			}
		})();
	}, []);

	return (
		<SafeAreaView style={{ flex: 1 }}>
			<Center>
				<FormControl minWidth="$96" marginHorizontal="$20" marginVertical="$20">
					<FormControl.Label>
						<FormControl.Label.Text>Instance URL</FormControl.Label.Text>
					</FormControl.Label>
					<Input isRequired>
						<Input.Input
							autoCapitalize="none"
							onChange={({ nativeEvent: { text } }) => setUrl(text)}
						/>
					</Input>
					<FormControl.Helper>
						<FormControl.Helper.Text>
							Where is your Ryot instance hosted?
						</FormControl.Helper.Text>
					</FormControl.Helper>
					<Button
						isDisabled={isLoading}
						marginTop="$4"
						onPress={async () => {
							if (url) {
								setIsLoading(true);
								const check = await getChecker(url);
								if (check) {
									await AsyncStorage.setItem(URL_KEY, url);
									router.push(ROUTES.auth.login);
								}
								setIsLoading(false);
							}
						}}
					>
						{isLoading ? <Spinner color="$white" marginRight="$4" /> : null}
						<Button.Text color="$white">
							{isLoading ? "Checking..." : "Save"}
						</Button.Text>
					</Button>
				</FormControl>
			</Center>
		</SafeAreaView>
	);
}
