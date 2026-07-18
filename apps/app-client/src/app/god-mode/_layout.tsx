import { Stack } from "expo-router";

import { GodModeGate } from "@/modules/god-mode/god-mode-gate";

export default function GodModeLayout() {
	return (
		<GodModeGate>
			<Stack screenOptions={{ headerShown: false }} />
		</GodModeGate>
	);
}
