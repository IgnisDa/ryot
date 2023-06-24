import { AUTH_KEY, URL_KEY } from "../lib/api";
import {
	Box,
	Button,
	Center,
	FormControl,
	Input,
	Spinner,
} from "../lib/components";
import { ROUTES } from "../lib/constants";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { UserDetailsDocument } from "@ryot/generated/src/graphql/backend/graphql";
import { getAuthHeader } from "@ryot/graphql/src/client";
import { useRouter } from "expo-router";
import request from "graphql-request";
import { useState } from "react";
import { SafeAreaView } from "react-native";

const isAuthenticated = async (url: string, token: string) => {
	try {
		const { userDetails } = await request(
			`${url}/graphql`,
			UserDetailsDocument,
			{},
			getAuthHeader(token),
		);
		if (userDetails.__typename === "UserDetailsError") return false;
		return true;
	} catch (e) {
		console.error(e);
		return false;
	}
};

export default function Page() {
	const [url, setUrl] = useState("");
	const [apiToken, setApiToken] = useState("");
	const [error, setError] = useState("");
	const [isLoading, setIsLoading] = useState(false);
	const router = useRouter();

	return (
		<SafeAreaView style={{ flex: 1 }}>
			<Center>
				<FormControl minWidth="$96" marginHorizontal="$20" marginVertical="$40">
					<Box>
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
					</Box>
					<Box marginTop="$4">
						<FormControl.Label>
							<FormControl.Label.Text>API Token</FormControl.Label.Text>
							{error ? (
								<FormControl.Error.Text>{error}</FormControl.Error.Text>
							) : null}
						</FormControl.Label>
						<Input isRequired isInvalid={!!error}>
							<Input.Input
								type="password"
								autoCapitalize="none"
								onChange={({ nativeEvent: { text } }) => setApiToken(text)}
							/>
						</Input>
						<FormControl.Helper>
							<FormControl.Helper.Text>
								Enter the application token obtained from settings
							</FormControl.Helper.Text>
						</FormControl.Helper>
					</Box>
					<Button
						isDisabled={isLoading}
						marginTop="$4"
						onPress={async () => {
							if (url && apiToken) {
								setIsLoading(true);
								const authCheck = await isAuthenticated(url, apiToken);
								if (authCheck) {
									await AsyncStorage.setItem(URL_KEY, url);
									await AsyncStorage.setItem(AUTH_KEY, url);
									router.push(ROUTES.dashboard);
								} else {
									setError("Invalid token entered");
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
