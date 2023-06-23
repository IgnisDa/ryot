import { URL_KEY } from "../lib/api";
import { Button, Center, FormControl, Input, Spinner } from "../lib/components";
import { ROUTES } from "../lib/constants";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { CoreEnabledFeaturesDocument } from "@ryot/generated/src/graphql/backend/graphql";
import { useRouter } from "expo-router";
import request from "graphql-request";
import { useState } from "react";
import { SafeAreaView } from "react-native";

export default function Page() {
	const [url, setUrl] = useState("");
	const [isLoading, setIsLoading] = useState(false);
	const router = useRouter();

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
								const { coreEnabledFeatures } = await request(
									`${url}/graphql`,
									CoreEnabledFeaturesDocument,
								);
								if (coreEnabledFeatures) {
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
