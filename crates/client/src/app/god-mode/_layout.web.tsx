import { Slot } from "expo-router";

import { GodModeGate, GodModeLockButton } from "@/modules/god-mode/god-mode-gate";
import { godModeSections } from "@/modules/god-mode/god-mode-sections";
import { SectionSidebarLayout } from "@/modules/ui/section-nav";

export default function GodModeLayout() {
	return (
		<GodModeGate>
			<SectionSidebarLayout
				title="God Mode"
				fallbackSlug="users"
				sections={godModeSections}
				footer={<GodModeLockButton />}
			>
				<Slot />
			</SectionSidebarLayout>
		</GodModeGate>
	);
}
