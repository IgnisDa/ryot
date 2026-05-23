import { type ReactNode, useState } from "react";
import { Pressable } from "react-native";
import type { ScrollView } from "react-native";
import { GestureDetector, usePanGesture } from "react-native-gesture-handler";
import Animated, {
	ReduceMotion,
	measure,
	scrollTo,
	type AnimatedRef,
	type SharedValue,
	useAnimatedReaction,
	useAnimatedStyle,
	useFrameCallback,
	useScrollOffset,
	useSharedValue,
	withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { AppIcon } from "@/modules/icons";

import {
	createReorderPositions,
	moveReorderPosition,
	type ReorderPositions,
} from "./reorderable-list-state";

const AUTO_SCROLL_EDGE = 48;
const AUTO_SCROLL_SPEED = 0.5;
const ROW_TIMING = { duration: 120, reduceMotion: ReduceMotion.System };

function clamp(value: number, minimum: number, maximum: number) {
	"worklet";
	return Math.min(Math.max(value, minimum), maximum);
}

function updateDragPosition(props: {
	itemKey: string;
	itemCount: number;
	startIndex: number;
	itemHeight: number;
	scrollOffset: number;
	rawTranslationY: number;
	startScrollOffset: number;
	activePosition: SharedValue<number>;
	projectedIndex: SharedValue<number>;
	positions: SharedValue<ReorderPositions>;
}) {
	"worklet";
	const translationY = props.rawTranslationY + props.scrollOffset - props.startScrollOffset;
	const position = clamp(
		props.startIndex * props.itemHeight + translationY,
		0,
		(props.itemCount - 1) * props.itemHeight,
	);
	const nextIndex = clamp(Math.round(position / props.itemHeight), 0, props.itemCount - 1);
	const currentIndex = props.positions.value[props.itemKey] ?? props.startIndex;
	props.activePosition.value = position;
	props.projectedIndex.value = nextIndex;
	if (currentIndex !== nextIndex) {
		props.positions.value = moveReorderPosition({
			toIndex: nextIndex,
			fromIndex: currentIndex,
			positions: props.positions.value,
		});
	}
}

type ReorderableListProps<T> = {
	itemHeight: number;
	items: readonly T[];
	onDrop?: () => void;
	onPickUp?: () => void;
	keyExtractor: (item: T) => string;
	scrollRef?: AnimatedRef<ScrollView> | undefined;
	onReorder: (fromIndex: number, toIndex: number) => void;
	renderItem: (state: {
		item: T;
		index: number;
		handle: ReactNode;
		isDragging: boolean;
	}) => ReactNode;
};

function ReorderableRow<T>(props: {
	item: T;
	index: number;
	itemKey: string;
	itemCount: number;
	itemHeight: number;
	onStart: () => void;
	isDragging: boolean;
	pointerY: SharedValue<number>;
	startIndex: SharedValue<number>;
	scrollOffset: SharedValue<number>;
	isFinalizing: SharedValue<boolean>;
	activePosition: SharedValue<number>;
	projectedIndex: SharedValue<number>;
	rawTranslationY: SharedValue<number>;
	activeKey: SharedValue<string | null>;
	startScrollOffset: SharedValue<number>;
	positions: SharedValue<ReorderPositions>;
	renderItem: ReorderableListProps<T>["renderItem"];
	onFinish: (fromIndex: number, toIndex: number) => void;
}) {
	const itemKey = props.itemKey;
	const onStart = props.onStart;
	const onFinish = props.onFinish;
	const activeKey = props.activeKey;
	const gesture = usePanGesture({
		failOffsetX: [-20, 20],
		activeOffsetY: [-5, 5],
		onUpdate: (event) => {
			if (activeKey.value !== itemKey || props.isFinalizing.value) {
				return;
			}
			props.rawTranslationY.value = event.translationY;
			props.pointerY.value = event.absoluteY;
			updateDragPosition({
				itemKey,
				itemCount: props.itemCount,
				positions: props.positions,
				itemHeight: props.itemHeight,
				startIndex: props.startIndex.value,
				rawTranslationY: event.translationY,
				projectedIndex: props.projectedIndex,
				activePosition: props.activePosition,
				scrollOffset: props.scrollOffset.value,
				startScrollOffset: props.startScrollOffset.value,
			});
		},
		onActivate: (event) => {
			if (activeKey.value !== null) {
				return;
			}
			const index = props.positions.value[itemKey] ?? props.index;
			activeKey.value = itemKey;
			props.startIndex.value = index;
			props.isFinalizing.value = false;
			props.rawTranslationY.value = 0;
			props.activePosition.value = index * props.itemHeight;
			props.startScrollOffset.value = props.scrollOffset.value;
			props.pointerY.value = event.absoluteY;
			props.projectedIndex.value = index;
			scheduleOnRN(onStart);
		},
		onFinalize: () => {
			if (activeKey.value !== itemKey) {
				return;
			}
			const fromIndex = props.startIndex.value;
			const toIndex = props.positions.value[itemKey] ?? fromIndex;
			props.isFinalizing.value = true;
			props.activePosition.value = withTiming(toIndex * props.itemHeight, ROW_TIMING, () => {
				activeKey.value = null;
				props.startIndex.value = -1;
				props.isFinalizing.value = false;
				props.projectedIndex.value = -1;
				scheduleOnRN(onFinish, fromIndex, toIndex);
			});
		},
	});
	const position = useSharedValue(props.index * props.itemHeight);
	useAnimatedReaction(
		() => props.positions.value[itemKey] ?? props.index,
		(nextIndex, previousIndex) => {
			const nextPosition = nextIndex * props.itemHeight;
			position.value = previousIndex === null ? nextPosition : withTiming(nextPosition, ROW_TIMING);
		},
	);
	const rowStyle = useAnimatedStyle(() => {
		const isActive = activeKey.value === itemKey;
		return {
			zIndex: isActive ? 10 : 0,
			transform: [{ translateY: isActive ? props.activePosition.value : position.value }],
		};
	});
	const handle = (
		<GestureDetector gesture={gesture}>
			<Pressable
				focusable
				accessible
				accessibilityRole="button"
				accessibilityLabel="Reorder item"
				className="h-10 w-10 items-center justify-center"
			>
				<AppIcon name="grip-vertical" size={18} className="text-text-muted" />
			</Pressable>
		</GestureDetector>
	);

	return (
		<Animated.View
			className="absolute inset-x-0 top-0"
			style={[{ height: props.itemHeight }, rowStyle]}
		>
			{props.renderItem({
				handle,
				item: props.item,
				index: props.index,
				isDragging: props.isDragging,
			})}
		</Animated.View>
	);
}

export function ReorderableList<T>(props: ReorderableListProps<T>) {
	const activeKey = useSharedValue<string | null>(null);
	const itemCount = props.items.length;
	const itemHeight = props.itemHeight;
	const itemKeys = props.items.map(props.keyExtractor);
	const pointerY = useSharedValue(0);
	const positions = useSharedValue(createReorderPositions(itemKeys));
	const startIndex = useSharedValue(-1);
	const isFinalizing = useSharedValue(false);
	const activePosition = useSharedValue(0);
	const projectedIndexValue = useSharedValue(-1);
	const rawTranslationY = useSharedValue(0);
	const scrollRef = props.scrollRef;
	const startScrollOffset = useSharedValue(0);
	const scrollOffset = useScrollOffset(scrollRef);
	const [draggingKey, setDraggingKey] = useState<string | null>(null);
	const onDrop = props.onDrop;
	const onPickUp = props.onPickUp;
	const onReorder = props.onReorder;
	useFrameCallback((frame) => {
		const itemKey = activeKey.value;
		if (itemKey === null || isFinalizing.value || scrollRef === undefined) {
			return;
		}
		const dimensions = measure(scrollRef);
		if (dimensions === null) {
			return;
		}
		const topEdge = dimensions.pageY + AUTO_SCROLL_EDGE;
		const bottomEdge = dimensions.pageY + dimensions.height - AUTO_SCROLL_EDGE;
		let direction = 0;
		if (pointerY.value < topEdge) {
			direction = -1;
		}
		if (pointerY.value > bottomEdge) {
			direction = 1;
		}
		if (direction === 0) {
			return;
		}
		const elapsed = frame.timeSincePreviousFrame ?? 16;
		const nextOffset = Math.max(0, scrollOffset.value + direction * elapsed * AUTO_SCROLL_SPEED);
		scrollTo(scrollRef, 0, nextOffset, false);
		updateDragPosition({
			itemKey,
			itemCount,
			positions,
			itemHeight,
			activePosition,
			startIndex: startIndex.value,
			scrollOffset: scrollOffset.value,
			projectedIndex: projectedIndexValue,
			rawTranslationY: rawTranslationY.value,
			startScrollOffset: startScrollOffset.value,
		});
	}, true);
	function beginDrag(key: string) {
		setDraggingKey(key);
		onPickUp?.();
	}

	function finishDrag(fromIndex: number, toIndex: number) {
		setDraggingKey(null);
		onDrop?.();
		if (fromIndex !== toIndex) {
			onReorder(fromIndex, toIndex);
		}
	}
	const insertionLineStyle = useAnimatedStyle(() => ({
		opacity: activeKey.value === null ? 0 : 1,
		transform: [{ translateY: projectedIndexValue.value * itemHeight }],
	}));

	return (
		<Animated.View className="relative" style={{ height: itemCount * itemHeight }}>
			{props.items.map((item, index) => {
				const key = props.keyExtractor(item);
				return (
					<ReorderableRow
						key={key}
						item={item}
						itemKey={key}
						index={index}
						pointerY={pointerY}
						activeKey={activeKey}
						onFinish={finishDrag}
						itemCount={itemCount}
						positions={positions}
						itemHeight={itemHeight}
						startIndex={startIndex}
						isFinalizing={isFinalizing}
						scrollOffset={scrollOffset}
						renderItem={props.renderItem}
						onStart={() => beginDrag(key)}
						activePosition={activePosition}
						isDragging={draggingKey === key}
						rawTranslationY={rawTranslationY}
						projectedIndex={projectedIndexValue}
						startScrollOffset={startScrollOffset}
					/>
				);
			})}
			<Animated.View
				pointerEvents="none"
				style={insertionLineStyle}
				className="absolute inset-x-0 z-20 h-0.5 bg-accent"
			/>
		</Animated.View>
	);
}
