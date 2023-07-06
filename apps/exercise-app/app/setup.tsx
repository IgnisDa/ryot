import { BasePage } from "@/components";
import { ROUTES } from "@/constants";
import { SignInResponse, useAuth } from "@/hooks";
import { Button, Card, Input } from "@rneui/themed";
import { useRouter } from "expo-router";
import { useState } from "react";

export default function Page() {
	const [url, setUrl] = useState("");
	const [token, setToken] = useState("");
	const [error, setError] = useState<SignInResponse | null>();
	const [isLoading, setIsLoading] = useState(false);
	const { signIn } = useAuth();
	const router = useRouter();

	return (
		<BasePage>
			<Card>
				<Input
					label="Where is your Ryot instance hosted?"
					errorMessage={
						error &&
						error === SignInResponse.ServerUrlError &&
						"Invalid URL entered"
					}
					autoCapitalize="none"
					onChange={({ nativeEvent: { text } }) => setUrl(text)}
				/>
				<Input
					label="API Token"
					errorMessage={
						error &&
						error === SignInResponse.CredentialsError &&
						"Invalid API Token"
					}
					autoCapitalize="none"
					onChange={({ nativeEvent: { text } }) => setToken(text)}
				/>
				<Button
					loading={isLoading}
					disabled={isLoading}
					onPress={async () => {
						setIsLoading(true);
						const response = await signIn(url, token);
						setIsLoading(false);
						setError(response);
						if (response === SignInResponse.Success)
							router.push(ROUTES.dashboard);
					}}
				>
					{isLoading ? "Checking..." : "Save"}
				</Button>
			</Card>
		</BasePage>
	);
}
