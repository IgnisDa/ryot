import { Box, Button, Center, FormControl, Input, Spinner } from "@/components";
import { ROUTES } from "@/constants";
import { SignInResponse, useAuth } from "@/hooks";
import { useRouter } from "expo-router";
import { useState } from "react";
import { SafeAreaView } from "react-native";

export default function Page() {
	const [url, setUrl] = useState("");
	const [token, setToken] = useState("");
	const [error, setError] = useState<SignInResponse | null>();
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
							{error && error === SignInResponse.ServerUrlError ? (
								<FormControl.Error.Text>
									Invalid URL entered
								</FormControl.Error.Text>
							) : null}
						</FormControl.Label>
						<Input
							isRequired
							isInvalid={error === SignInResponse.ServerUrlError}
						>
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
							{error && error === SignInResponse.CredentialsError ? (
								<FormControl.Error.Text>
									Invalid API token entered
								</FormControl.Error.Text>
							) : null}
						</FormControl.Label>
						<Input
							isRequired
							isInvalid={error === SignInResponse.CredentialsError}
						>
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
							setIsLoading(true);
							const response = await signIn(url, token);
							setIsLoading(false);
							setError(response);
							if (response === SignInResponse.Success)
								router.push(ROUTES.dashboard);
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
