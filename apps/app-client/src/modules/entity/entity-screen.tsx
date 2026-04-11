import { Text, View } from "react-native";

import { ChildScreenFrame } from "@/modules/navigation/child-screen-frame";
import type { HeaderOverflowItem } from "@/modules/navigation/header/header-overflow-menu";
import { RemoteImage } from "@/modules/ui/image-with-fallback";

const HERO_HEIGHT = 384;
const TITLE = "The Left Hand of Darkness";

const overflowItems = [
	{ label: "Edit" },
	{ label: "Share" },
	{ label: "Duplicate" },
	{ label: "Move to collection" },
	{ label: "Delete", isDestructive: true },
] satisfies readonly HeaderOverflowItem[];

export function EntityScreen() {
	return (
		<ChildScreenFrame
			title={TITLE}
			heroHeight={HERO_HEIGHT}
			overflowItems={overflowItems}
			hero={<RemoteImage url="https://placedog.net/500" className="h-96 w-full" />}
			meta={<Text className="font-ui text-[13px] text-text-muted">Novel · 1969</Text>}
		>
			<View className="mx-auto w-full max-w-2xl gap-6 pt-4">
				<Text className="font-ui text-base leading-7 text-text">
					Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt
					ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation
					ullamco laboris nisi ut aliquip ex ea commodo consequat.
				</Text>
				<View className="gap-2">
					<Text className="font-display-semibold text-2xl text-text">About this book</Text>
					<Text className="font-ui text-base leading-7 text-text-muted">
						Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat
						nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui
						officia deserunt mollit anim id est laborum.
					</Text>
				</View>
				<View className="gap-2">
					<Text className="font-display-semibold text-2xl text-text">Notes</Text>
					<Text className="font-ui text-base leading-7 text-text-muted">
						Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque
						laudantium, totam rem aperiam, eaque ipsa quae ab illo inventore veritatis.
					</Text>
				</View>
				<View className="gap-2">
					<Text className="font-display-semibold text-2xl text-text">Characters</Text>
					<Text className="font-ui text-base leading-7 text-text-muted">
						Genly Ai, Estraven, and the wider political world of Gethen shape the emotional core of
						the story, balancing isolation, trust, and cultural misunderstanding across a fragile
						interstellar encounter.
					</Text>
				</View>
				<View className="gap-2">
					<Text className="font-display-semibold text-2xl text-text">Themes</Text>
					<Text className="font-ui text-base leading-7 text-text-muted">
						The novel explores gender, diplomacy, identity, and the ethics of political power,
						asking how societies define difference while struggling to build trust between deeply
						unlike worlds.
					</Text>
				</View>
				<View className="gap-2">
					<Text className="font-display-semibold text-2xl text-text">Awards & recognition</Text>
					<Text className="font-ui text-base leading-7 text-text-muted">
						Recognized as a landmark of science fiction, the book earned lasting acclaim for its
						ambitious worldbuilding and its thoughtful treatment of human relationships, language,
						and cultural perspective.
					</Text>
				</View>
				<View className="gap-2">
					<Text className="font-display-semibold text-2xl text-text">Reading progress</Text>
					<Text className="font-ui text-base leading-7 text-text-muted">
						Currently in your library with a personal reading status set to in progress. Add notes,
						track your pace, or mark milestones as you continue through the story.
					</Text>
				</View>
				<View className="gap-2">
					<Text className="font-display-semibold text-2xl text-text">Related editions</Text>
					<Text className="font-ui text-base leading-7 text-text-muted">
						This edition is part of a broader collection of classic speculative fiction, with later
						reprints and annotated editions preserving the novel's place in literary and cultural
						history.
					</Text>
				</View>
			</View>
		</ChildScreenFrame>
	);
}
