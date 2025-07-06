import { router, Stack } from "expo-router";
import { useEffect } from "react";

import { ShellNavigation } from "@/components/shell";
import { Box } from "@/components/ui/box";
import { Center } from "@/components/ui/center";
import { Text } from "@/components/ui/text";
import { useAuthClient } from "@/lib/atoms";

export default function AppLayout() {
	const authClient = useAuthClient();
	const { data: session, isPending } = authClient.useSession();

	useEffect(() => {
		if (!isPending && !session) {
			router.replace("/auth");
		}
	}, [session, isPending]);

	if (isPending) {
		return (
			<Box className="flex-1 bg-background">
				<Center className="flex-1">
					<Text className="text-muted-foreground text-sm">Loading...</Text>
				</Center>
			</Box>
		);
	}

	if (!session) {
		return null;
	}

	return (
		<ShellNavigation>
			<Stack screenOptions={{ headerShown: false }} />
		</ShellNavigation>
	);
}
