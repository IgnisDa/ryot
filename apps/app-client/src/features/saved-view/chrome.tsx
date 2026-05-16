import clsx from "clsx";

import { Box } from "@/components/ui/box";
import { Pressable } from "@/components/ui/pressable";
import { Text } from "@/components/ui/text";

import type { SavedViewLayout } from "./runtime";

export function ScreenState(props: {
	title: string;
	action?: () => void;
	description: string;
	actionLabel?: string;
}) {
	return (
		<Box className="flex-1 items-center justify-center bg-background px-8">
			<Text className="text-center text-[18px] font-heading-semibold text-foreground">
				{props.title}
			</Text>
			<Text className="mt-2 text-center text-[14px] text-muted-foreground">
				{props.description}
			</Text>
			{props.action ? (
				<Pressable className="mt-5 rounded-full bg-[#C9943A] px-4 py-2" onPress={props.action}>
					<Text className="text-[13px] font-sans-semibold text-[#1c1917]">
						{props.actionLabel ?? "Retry"}
					</Text>
				</Pressable>
			) : null}
		</Box>
	);
}

export function SavedViewLayoutSwitcher(props: {
	layout: SavedViewLayout;
	onLayoutChange: (layout: SavedViewLayout) => void;
}) {
	return (
		<Box className="mt-4 flex-row gap-2">
			{(["grid", "list", "table"] as const).map((layout) => (
				<Pressable
					key={layout}
					onPress={() => props.onLayoutChange(layout)}
					className={clsx(
						"rounded-full border px-3 py-2",
						props.layout === layout ? "border-[#C9943A] bg-[#C9943A]/15" : "border-border bg-card",
					)}
				>
					<Text
						className={clsx(
							"text-[13px] font-sans-medium capitalize",
							props.layout === layout ? "text-[#C9943A]" : "text-muted-foreground",
						)}
					>
						{layout}
					</Text>
				</Pressable>
			))}
		</Box>
	);
}

export function SavedViewHeader(props: {
	name: string;
	count: number;
	isLoadingMore: boolean;
	layout: SavedViewLayout;
	onLayoutChange: (layout: SavedViewLayout) => void;
}) {
	const summary =
		props.count === 0 && props.isLoadingMore ? "Loading entries" : `${props.count} entries`;

	return (
		<Box>
			<Text className="text-[10px] font-sans uppercase tracking-[2px] text-muted-foreground">
				Saved view
			</Text>
			<Text className="mt-1 text-[32px] leading-[36px] font-heading-semibold tracking-[-0.4px] text-foreground">
				{props.name}
			</Text>
			<Text className="mt-2 text-[14px] text-muted-foreground">{summary}</Text>
			<SavedViewLayoutSwitcher layout={props.layout} onLayoutChange={props.onLayoutChange} />
		</Box>
	);
}

export function LoadMoreFooter(props: {
	onPress: () => void;
	hasNextPage: boolean;
	isFetchingNextPage: boolean;
	errorMessage?: string | null;
}) {
	if (props.errorMessage) {
		return (
			<Box className="mt-4 rounded-[22px] border border-border bg-card px-4 py-4">
				<Text className="text-[13px] font-sans-medium text-foreground">Load more failed</Text>
				<Text className="mt-1 text-[12px] text-muted-foreground">{props.errorMessage}</Text>
				<Pressable
					onPress={props.onPress}
					className="mt-3 self-start rounded-full bg-[#C9943A] px-3 py-2"
				>
					<Text className="text-[12px] font-sans-semibold text-[#1c1917]">Retry</Text>
				</Pressable>
			</Box>
		);
	}

	if (props.isFetchingNextPage) {
		return (
			<Text className="mt-4 text-center text-[13px] text-muted-foreground">Loading more…</Text>
		);
	}

	if (!props.hasNextPage) {
		return <Box className="h-4" />;
	}

	return (
		<Pressable
			onPress={props.onPress}
			className="mt-4 items-center rounded-full border border-border bg-card px-4 py-3"
		>
			<Text className="text-[13px] font-sans-medium text-foreground">Load more</Text>
		</Pressable>
	);
}
