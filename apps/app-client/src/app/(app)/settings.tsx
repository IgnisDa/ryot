import { PageHeader } from "@/components/shell/page-header";
import { Box } from "@/components/ui/box";
import { Text } from "@/components/ui/text";

export default function SettingsScreen() {
	return (
		<PageHeader title="Settings" eyebrow="Account">
			<Box className="mt-4 gap-3">
				<Text className="text-[15px] leading-6 text-muted-foreground font-sans">
					Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt
					ut labore et dolore magna aliqua.
				</Text>
				<Text className="text-[15px] leading-6 text-muted-foreground font-sans">
					Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea
					commodo consequat.
				</Text>
			</Box>
		</PageHeader>
	);
}
