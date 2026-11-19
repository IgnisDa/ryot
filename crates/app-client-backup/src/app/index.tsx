import { Redirect } from "expo-router";

import { useServerUrl } from "@/lib/atoms";

export default function Index() {
	const serverUrl = useServerUrl();
	if (!serverUrl) {
		return <Redirect href="/onboarding" />;
	}
	return <Redirect href="/(app)" />;
}
