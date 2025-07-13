import Animated, { SlideInDown, SlideOutUp } from "react-native-reanimated";
import { Box } from "@/components/ui/box";
import { Input, InputField } from "@/components/ui/input";
import { Pressable } from "@/components/ui/pressable";
import { Text } from "@/components/ui/text";
import { useSetSearchOpen } from "@/lib/navigation";

// TODO: wire query string to the search API
const MOCK_RESULTS = [
	{ title: "Lagavulin 16", kind: "Whiskey" },
	{ title: "Lagavulin Distillery", kind: "Places" },
	{ title: "Lagavulin tasting · Mar 4", kind: "Event" },
];

export function SearchOverlay() {
	const setSearchOpen = useSetSearchOpen();

	return (
		<Animated.View
			exiting={SlideOutUp.duration(180)}
			entering={SlideInDown.duration(220)}
			className="absolute top-14 left-0 right-0 z-40 pt-6 pb-5 px-7 border-b-[0.5px] bg-background border-b-border"
		>
			<Text className="text-[10px] tracking-[2px] mb-2.5 text-muted-foreground font-sans uppercase">
				Search · all entities
			</Text>
			<Box className="flex-row items-center">
				<Input className="border-transparent bg-transparent min-h-0 px-0">
					<InputField
						autoFocus
						placeholder="Search…"
						returnKeyType="search"
						placeholderTextColor="#78716c"
						className="text-[28px] text-foreground font-heading"
					/>
				</Input>
			</Box>
			<Box className="gap-3.5 mt-7">
				{MOCK_RESULTS.map((r) => (
					<Pressable key={r.title} className="gap-0.5">
						<Text className="text-[18px] text-foreground font-heading">
							{r.title}
						</Text>
						<Text className="text-[11px] text-muted-foreground font-sans tracking-[1.5px] uppercase">
							{r.kind}
						</Text>
					</Pressable>
				))}
			</Box>
			<Pressable
				accessibilityLabel="Dismiss search"
				onPress={() => setSearchOpen(false)}
				className="absolute left-0 right-0 top-full h-2499.75"
			/>
		</Animated.View>
	);
}
