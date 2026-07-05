import { Result, useAtomValue } from "@effect-atom/atom-react";
import { Cause } from "effect";
import { Text, View } from "react-native";

import { systemHealthAtom } from "@/lib/api";
import { CLOUD_URL } from "@/lib/server";
import { useServerUrl } from "@/lib/store/server";

function ServerHealth(props: { serverUrl: string }) {
	const health = useAtomValue(systemHealthAtom(props.serverUrl));

	return Result.builder(health)
		.onInitial(() => <Text className="font-ui text-text-muted">Connecting...</Text>)
		.onFailure((cause) => <Text className="font-ui text-danger">{Cause.pretty(cause)}</Text>)
		.onSuccess(({ status }) => (
			<Text className="font-ui-medium text-success">Server is {status}</Text>
		))
		.render();
}

export default function Index() {
	const serverUrl = useServerUrl() ?? CLOUD_URL;
	return (
		<View className="flex-1 items-center justify-center gap-3 bg-bg px-6">
			<Text className="font-display-semibold text-4xl text-text">Ryot</Text>
			<Text className="font-ui text-text-muted">{serverUrl}</Text>
			<ServerHealth serverUrl={serverUrl} />
		</View>
	);
}
