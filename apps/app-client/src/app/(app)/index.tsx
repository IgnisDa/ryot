import { dayjs } from "@ryot/ts-utils";
import { Plus } from "lucide-react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { PageHeader } from "@/components/spine/page-header";
import { Box } from "@/components/ui/box";
import { Button, ButtonIcon, ButtonText } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useTrackers } from "@/lib/navigation";

export default function HomeScreen() {
	const trackers = useTrackers();

	if (!trackers.length) {
		return (
			<Box className="flex-1 bg-background">
				<SafeAreaView className="flex-1">
					<Box className="flex-1 items-center justify-center px-[40]">
						<Text className="text-[10px] tracking-[2px] text-muted-foreground font-sans uppercase">
							Welcome
						</Text>
						<Text className="text-[32px] text-foreground mt-2 leading-[36px] text-center tracking-[-0.5px] font-heading-semibold">
							{"Your journal\nis empty."}
						</Text>
						<Text className="text-[15px] mt-[18] leading-5.5 text-muted-foreground font-sans text-center">
							Add your first tracker to start.{"\n"}Built-in: Media, Fitness. Or
							build your own.
						</Text>
						<Button className="mt-9 rounded" size="lg">
							<ButtonIcon as={Plus} />
							<ButtonText>Add a tracker</ButtonText>
						</Button>
					</Box>
				</SafeAreaView>
			</Box>
		);
	}

	const today = dayjs();

	return (
		<PageHeader
			title={today.format("dddd")}
			eyebrow={`Today · ${today.format("DD MMM")}`}
		>
			<Box className="gap-[14] mt-[16]">
				<Box className="h-[100] bg-stone-200 opacity-100" />
				<Box className="h-[100] bg-stone-200 opacity-70" />
				<Box className="h-[100] bg-stone-200 opacity-50" />
			</Box>
		</PageHeader>
	);
}
