import { router, Stack } from "expo-router";
import { useAtomValue } from "jotai";
import { useEffect } from "react";
import { SpineNavigation } from "@/components/spine";
import { Box } from "@/components/ui/box";
import { Center } from "@/components/ui/center";
import { Text } from "@/components/ui/text";
import { authClientAtom } from "@/lib/auth";

export default function AppLayout() {
	const authClient = useAtomValue(authClientAtom);
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
		<SpineNavigation>
			<Stack screenOptions={{ headerShown: false }} />
		</SpineNavigation>
	);
}
