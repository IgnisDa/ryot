import { useGodModeSession } from "@/modules/god-mode/session";
import { GodModeUserTable } from "@/modules/god-mode/user-table";
import { SectionFrame } from "@/modules/ui/section-frame";

export function GodModeUsersScreen() {
	const { lock } = useGodModeSession();

	return (
		<SectionFrame
			title="Users"
			contentClassName="w-full max-w-6xl self-center"
			overflowItems={[{ label: "Lock god mode", onPress: () => lock(null) }]}
		>
			<GodModeUserTable />
		</SectionFrame>
	);
}
