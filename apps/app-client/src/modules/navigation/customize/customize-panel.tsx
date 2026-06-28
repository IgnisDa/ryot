import { useEffect, useRef, useState } from "react";
import { Text, View, type LayoutChangeEvent, type ScrollView } from "react-native";
import Animated, { useAnimatedRef } from "react-native-reanimated";

import { AppIcon } from "@/modules/icons";
import { ReorderableList } from "@/modules/ui/reorderable-list";

import { CustomizeHomeRow, CustomizeRow } from "./customize-row";
import type { CustomizeDraft, CustomizeSection } from "./customize-state";
import { getCustomizeSectionCounts } from "./customize-state";

const ITEM_HEIGHT = 44;

type SectionOffsets = Partial<Record<CustomizeSection, number>>;

export function CustomizePanel(props: {
	draft: CustomizeDraft;
	onDrop?: (() => void) | undefined;
	onPickUp?: (() => void) | undefined;
	initialSection?: CustomizeSection | undefined;
	onToggle: (section: CustomizeSection, slug: string) => void;
	onMove: (section: CustomizeSection, fromIndex: number, toIndex: number) => void;
}) {
	const hasScrolled = useRef(false);
	const scrollRef = useAnimatedRef<ScrollView>();
	const [sectionOffsets, setSectionOffsets] = useState<SectionOffsets>({});
	const viewsCount = getCustomizeSectionCounts({ draft: props.draft, section: "views" });
	const savedViewsCount = getCustomizeSectionCounts({
		draft: props.draft,
		section: "savedViews",
	});

	useEffect(() => {
		if (hasScrolled.current || props.initialSection === undefined) {
			return;
		}
		const offset = sectionOffsets[props.initialSection];
		if (offset === undefined) {
			return;
		}
		hasScrolled.current = true;
		scrollRef.current?.scrollTo({ animated: false, y: offset });
	}, [props.initialSection, sectionOffsets, scrollRef]);

	function captureSectionOffset(section: CustomizeSection, event: LayoutChangeEvent) {
		const offset = event.nativeEvent.layout.y;
		setSectionOffsets((current) =>
			current[section] === offset ? current : { ...current, [section]: offset },
		);
	}

	return (
		<Animated.ScrollView
			ref={scrollRef}
			className="flex-1"
			showsVerticalScrollIndicator={false}
			contentContainerClassName="gap-2.5 px-3 pb-5 pt-[18px]"
		>
			<View className="mt-2 gap-1.5">
				<View
					className="flex-row items-center px-1"
					onLayout={(event) => captureSectionOffset("views", event)}
				>
					<Text className="font-ui-semibold text-xs uppercase tracking-[1.6px] text-text-subtle">
						Views · {viewsCount.shown} of {viewsCount.total} shown
					</Text>
				</View>
				<View className="overflow-hidden rounded-lg border border-border bg-surface">
					<CustomizeHomeRow />
					<ReorderableList
						onDrop={props.onDrop}
						scrollRef={scrollRef}
						itemHeight={ITEM_HEIGHT}
						onPickUp={props.onPickUp}
						items={props.draft.views}
						keyExtractor={(item) => item.slug}
						onReorder={(fromIndex, toIndex) => props.onMove("views", fromIndex, toIndex)}
						renderItem={({ handle, item }) => (
							<CustomizeRow
								handle={handle}
								item={item}
								onToggle={(slug) => props.onToggle("views", slug)}
							/>
						)}
					/>
				</View>
			</View>

			<View className="gap-1.5">
				<View
					className="flex-row items-center px-1"
					onLayout={(event) => captureSectionOffset("savedViews", event)}
				>
					<Text className="font-ui-semibold text-xs uppercase tracking-[1.6px] text-text-subtle">
						Saved Views · {savedViewsCount.shown} of {savedViewsCount.total} shown
					</Text>
				</View>
				<View className="overflow-hidden rounded-lg border border-border bg-surface">
					{props.draft.savedViews.length === 0 ? (
						<Text className="px-2 py-1 font-ui text-xs text-text-subtle">No saved views yet.</Text>
					) : (
						<ReorderableList
							onDrop={props.onDrop}
							scrollRef={scrollRef}
							itemHeight={ITEM_HEIGHT}
							onPickUp={props.onPickUp}
							items={props.draft.savedViews}
							keyExtractor={(item) => item.slug}
							onReorder={(fromIndex, toIndex) => props.onMove("savedViews", fromIndex, toIndex)}
							renderItem={({ handle, item }) => (
								<CustomizeRow
									handle={handle}
									item={item}
									onToggle={(slug) => props.onToggle("savedViews", slug)}
								/>
							)}
						/>
					)}
				</View>
			</View>

			<View className="flex-row items-start gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2.5">
				<AppIcon className="mt-0.5 text-text-muted" name="info" size={15} />
				<Text className="min-w-0 flex-1 font-ui text-xs leading-5 text-text-muted">
					Collections are always shown and are not included in sidebar customization.
				</Text>
			</View>
		</Animated.ScrollView>
	);
}
