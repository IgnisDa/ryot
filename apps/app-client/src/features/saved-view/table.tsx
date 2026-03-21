import { getQueryEngineField } from "@ryot/ts-utils/query-engine";
import clsx from "clsx";
import { useRouter } from "expo-router";
import { FlatList, Image, ScrollView } from "react-native";

import { Box } from "@/components/ui/box";
import { Pressable } from "@/components/ui/pressable";
import { Text } from "@/components/ui/text";
import { entityHref } from "@/lib/navigation-data";

import type { QueryEngineEntityItem } from "../entity-detail/query-engine";
import { LoadMoreFooter, SavedViewHeader } from "./chrome";
import {
	formatSavedViewFieldValue,
	getEntityId,
	type EntitySavedView,
	type SavedViewLayout,
} from "./runtime";
import { createSavedViewTableColumns } from "./table-utils";

type SavedViewTableColumn = ReturnType<typeof createSavedViewTableColumns>[number];

function SavedViewTableHeaderCell(props: { label: string; width: number }) {
	return (
		<Box
			style={{ width: props.width }}
			className="justify-center border-r border-border px-3 py-2 last:border-r-0"
		>
			<Text
				numberOfLines={1}
				className="text-[11px] font-sans-medium uppercase tracking-[2px] text-muted-foreground"
			>
				{props.label}
			</Text>
		</Box>
	);
}

function SavedViewTableValueCell(props: {
	width: number;
	imageUrl?: string;
	field: QueryEngineEntityItem[string] | undefined;
}) {
	const value = formatSavedViewFieldValue(props.field);

	return (
		<Box
			style={{ width: props.width }}
			className="justify-center border-r border-border px-3 py-3 last:border-r-0"
		>
			{value.kind === "image" ? (
				props.imageUrl ? (
					<Box className="h-11 w-11 overflow-hidden rounded-[14px] bg-stone-200">
						<Image className="h-full w-full" resizeMode="cover" source={{ uri: props.imageUrl }} />
					</Box>
				) : (
					<Box className="h-11 w-11 rounded-[14px] bg-stone-200" />
				)
			) : (
				<Text
					numberOfLines={1}
					className={clsx(
						"text-[13px] leading-4.5",
						value.kind === "empty" ? "text-muted-foreground" : "text-foreground",
					)}
				>
					{value.kind === "empty" ? "—" : value.value}
				</Text>
			)}
		</Box>
	);
}

function SavedViewTableRow(props: {
	onPress: () => void;
	entityId: string | null;
	item: QueryEngineEntityItem;
	columns: SavedViewTableColumn[];
	imageUrlById: Map<string, string | undefined>;
}) {
	return (
		<Pressable
			onPress={props.onPress}
			disabled={!props.entityId}
			className={clsx("flex-row border-b border-border bg-card", !props.entityId && "opacity-60")}
		>
			{props.columns.map((column) => {
				const field = getQueryEngineField(props.item, column.fieldKey);
				const imageUrl = props.entityId
					? props.imageUrlById.get(`${props.entityId}:${column.fieldKey}`)
					: undefined;

				return (
					<SavedViewTableValueCell
						field={field}
						imageUrl={imageUrl}
						width={column.width}
						key={column.fieldKey}
					/>
				);
			})}
		</Pressable>
	);
}

export function SavedViewTableResults(props: {
	viewName: string;
	isFetching: boolean;
	hasNextPage: boolean;
	onLoadMore: () => void;
	layout: SavedViewLayout;
	isFetchingNextPage: boolean;
	rows: QueryEngineEntityItem[];
	loadMoreError?: string | null;
	imageUrlById: Map<string, string | undefined>;
	onLayoutChange: (layout: SavedViewLayout) => void;
	tableColumns: EntitySavedView["displayConfiguration"]["table"]["columns"];
}) {
	const router = useRouter();
	const columns = createSavedViewTableColumns(props.tableColumns);
	const tableWidth = columns.reduce((width, column) => width + column.width, 0);

	return (
		<Box className="flex-1 bg-background">
			<Box className="px-7 pt-4">
				<SavedViewHeader
					layout={props.layout}
					name={props.viewName}
					count={props.rows.length}
					onLayoutChange={props.onLayoutChange}
					isLoadingMore={props.isFetching && props.rows.length === 0}
				/>
			</Box>
			<ScrollView
				horizontal
				style={{ flex: 1 }}
				showsHorizontalScrollIndicator={false}
				contentContainerStyle={{ paddingBottom: 40, paddingHorizontal: 28, paddingTop: 16 }}
			>
				<Box
					className="overflow-hidden rounded-[22px] border border-border bg-card"
					style={{ width: tableWidth }}
				>
					<Box className="flex-row border-b border-border bg-stone-100/70">
						{columns.map((column) => (
							<SavedViewTableHeaderCell
								label={column.label}
								width={column.width}
								key={column.fieldKey}
							/>
						))}
					</Box>
					<FlatList
						data={props.rows}
						style={{ width: tableWidth }}
						showsVerticalScrollIndicator={false}
						keyExtractor={(item, index) => getEntityId(item) ?? `${props.layout}-${index}`}
						ListEmptyComponent={
							props.isFetching && props.rows.length === 0 ? (
								<Box className="px-4 py-5">
									<Text className="text-[14px] font-sans-medium text-foreground">
										Loading entries
									</Text>
									<Text className="mt-1 text-[13px] text-muted-foreground">
										Fetching the first page from the query engine.
									</Text>
								</Box>
							) : (
								<Box className="px-4 py-5">
									<Text className="text-[14px] font-sans-medium text-foreground">
										No entries found
									</Text>
									<Text className="mt-1 text-[13px] text-muted-foreground">
										This saved view did not return any results.
									</Text>
								</Box>
							)
						}
						ListFooterComponent={
							<Box className="px-4 py-4">
								<LoadMoreFooter
									onPress={props.onLoadMore}
									hasNextPage={props.hasNextPage}
									errorMessage={props.loadMoreError}
									isFetchingNextPage={props.isFetchingNextPage}
								/>
							</Box>
						}
						onEndReachedThreshold={0.6}
						onEndReached={() => {
							if (props.hasNextPage && !props.isFetchingNextPage) {
								props.onLoadMore();
							}
						}}
						renderItem={({ item }) => {
							const entityId = getEntityId(item);
							const onPress = () => {
								if (entityId) {
									router.push(entityHref(entityId));
								}
							};

							return (
								<SavedViewTableRow
									item={item}
									onPress={onPress}
									columns={columns}
									entityId={entityId}
									imageUrlById={props.imageUrlById}
								/>
							);
						}}
					/>
				</Box>
			</ScrollView>
		</Box>
	);
}
