import { Box, Button, Center, FormControl, Input, Spinner } from "@/components";
import { ROUTES } from "@/constants";
import { useAuth } from "@/hooks";
import { useRouter } from "expo-router";
import { useState } from "react";
import { SafeAreaView } from "react-native";

export default function Page() {
	const [url, setUrl] = useState("");
	const [token, setToken] = useState("");
	const [error, setError] = useState("");
	const [isLoading, setIsLoading] = useState(false);
	const { signIn } = useAuth();
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
								onChange={({ nativeEvent: { text } }) => setToken(text)}
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
							if (url && token) {
								setIsLoading(true);
								try {
									await signIn(url, token);
									router.push(ROUTES.dashboard);
								} catch {
									setError("Invalid token entered");
								} finally {
									setIsLoading(false);
								}
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
