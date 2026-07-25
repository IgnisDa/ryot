import { type ReactNode, useCallback, useEffect, useState } from "react";
import { Pressable } from "react-native";
import type { ScrollView } from "react-native";
import { GestureDetector, usePanGesture } from "react-native-gesture-handler";
import Animated, {
	ReduceMotion,
	measure,
	scrollTo,
	type AnimatedRef,
	type SharedValue,
	useAnimatedStyle,
	useFrameCallback,
	useScrollOffset,
	useSharedValue,
	withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { AppIcon } from "@/modules/icons";

const AUTO_SCROLL_EDGE = 48;
const AUTO_SCROLL_SPEED = 0.5;
const ROW_TIMING = { duration: 120, reduceMotion: ReduceMotion.System };

function clamp(value: number, minimum: number, maximum: number) {
	"worklet";
	return Math.min(Math.max(value, minimum), maximum);
}

function projectedIndex(
	startIndex: number,
	translationY: number,
	itemHeight: number,
	itemCount: number,
) {
	"worklet";
	return clamp(Math.round((startIndex * itemHeight + translationY) / itemHeight), 0, itemCount - 1);
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
	activeIndex: SharedValue<number>;
	translationY: SharedValue<number>;
	scrollOffset: SharedValue<number>;
	positions: Record<string, number>;
	isFinalizing: SharedValue<boolean>;
	projectedIndex: SharedValue<number>;
	rawTranslationY: SharedValue<number>;
	activeKey: SharedValue<string | null>;
	startScrollOffset: SharedValue<number>;
	renderItem: ReorderableListProps<T>["renderItem"];
	dragPositions: SharedValue<Record<string, number>>;
	onFinish: (fromIndex: number, toIndex: number) => void;
}) {
	const index = props.index;
	const itemKey = props.itemKey;
	const onStart = props.onStart;
	const onFinish = props.onFinish;
	const activeKey = props.activeKey;
	const isFinalizing = props.isFinalizing;
	const pointerY = props.pointerY;
	const itemCount = props.itemCount;
	const itemHeight = props.itemHeight;
	const activeIndex = props.activeIndex;
	const dragPositions = props.dragPositions;
	const translationY = props.translationY;
	const scrollOffset = props.scrollOffset;
	const positions = props.positions;
	const rawTranslationY = props.rawTranslationY;
	const projectedIndexValue = props.projectedIndex;
	const startScrollOffset = props.startScrollOffset;
	const updateTranslation = useCallback(
		(nextRawTranslationY: number) => {
			"worklet";
			const nextTranslationY = nextRawTranslationY + scrollOffset.value - startScrollOffset.value;
			const boundedTranslationY = clamp(
				nextTranslationY,
				-index * itemHeight,
				(itemCount - 1 - index) * itemHeight,
			);
			translationY.value = boundedTranslationY;
			projectedIndexValue.value = projectedIndex(index, boundedTranslationY, itemHeight, itemCount);
		},
		[
			index,
			itemCount,
			itemHeight,
			projectedIndexValue,
			scrollOffset,
			startScrollOffset,
			translationY,
		],
	);
	const gesture = usePanGesture({
		failOffsetX: [-20, 20],
		activeOffsetY: [-5, 5],
		onUpdate: (event) => {
			if (activeKey.value !== itemKey || isFinalizing.value) {
				return;
			}
			rawTranslationY.value = event.translationY;
			pointerY.value = event.absoluteY;
			updateTranslation(event.translationY);
		},
		onActivate: (event) => {
			if (activeKey.value !== null) {
				return;
			}
			activeKey.value = itemKey;
			activeIndex.value = index;
			dragPositions.value = positions;
			isFinalizing.value = false;
			rawTranslationY.value = 0;
			startScrollOffset.value = scrollOffset.value;
			pointerY.value = event.absoluteY;
			translationY.value = 0;
			projectedIndexValue.value = index;
			scheduleOnRN(onStart);
		},
		onFinalize: () => {
			if (activeKey.value !== itemKey) {
				return;
			}
			const fromIndex = activeIndex.value;
			const toIndex = projectedIndexValue.value;
			isFinalizing.value = true;
			translationY.value = withTiming((toIndex - fromIndex) * itemHeight, ROW_TIMING, () => {
				scheduleOnRN(onFinish, fromIndex, toIndex);
			});
		},
	});
	const rowStyle = useAnimatedStyle(() => {
		const active = activeIndex.value;
		const activeItemKey = activeKey.value;
		if (activeItemKey === null) {
			return { transform: [{ translateY: 0 }], zIndex: 0 };
		}
		const dragIndex = dragPositions.value[itemKey] ?? index;
		const projected = projectedIndexValue.value;
		if (activeItemKey === itemKey) {
			const absoluteY = active * itemHeight + translationY.value;
			return { transform: [{ translateY: absoluteY - index * itemHeight }], zIndex: 10 };
		}
		let targetIndex = dragIndex;
		if (active < projected && dragIndex > active && dragIndex <= projected) {
			targetIndex -= 1;
		}
		if (active > projected && dragIndex >= projected && dragIndex < active) {
			targetIndex += 1;
		}
		const displacement = (targetIndex - index) * itemHeight;
		return {
			transform: [{ translateY: displacement === 0 ? 0 : withTiming(displacement, ROW_TIMING) }],
			zIndex: 0,
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
		<Animated.View className="relative" style={[{ height: props.itemHeight }, rowStyle]}>
			{props.renderItem({
				index,
				handle,
				item: props.item,
				isDragging: props.isDragging,
			})}
		</Animated.View>
	);
}

export function ReorderableList<T>(props: ReorderableListProps<T>) {
	const activeKey = useSharedValue<string | null>(null);
	const activeIndex = useSharedValue(-1);
	const itemCount = props.items.length;
	const itemHeight = props.itemHeight;
	const itemPositions = Object.fromEntries(
		props.items.map((item, index) => [props.keyExtractor(item), index]),
	);
	const pointerY = useSharedValue(0);
	const dragPositions = useSharedValue<Record<string, number>>({});
	const isFinalizing = useSharedValue(false);
	const projectedIndexValue = useSharedValue(-1);
	const rawTranslationY = useSharedValue(0);
	const scrollRef = props.scrollRef;
	const startScrollOffset = useSharedValue(0);
	const translationY = useSharedValue(0);
	const scrollOffset = useScrollOffset(scrollRef);
	const [draggingKey, setDraggingKey] = useState<string | null>(null);
	const [pendingOrder, setPendingOrder] = useState<readonly string[] | null>(null);
	const onDrop = props.onDrop;
	const onPickUp = props.onPickUp;
	const onReorder = props.onReorder;
	useEffect(() => {
		if (pendingOrder === null) {
			return;
		}
		const currentOrder = props.items.map(props.keyExtractor);
		if (
			currentOrder.length !== pendingOrder.length ||
			currentOrder.some((key, index) => key !== pendingOrder[index])
		) {
			return;
		}
		activeKey.value = null;
		activeIndex.value = -1;
		dragPositions.value = {};
		isFinalizing.value = false;
		projectedIndexValue.value = -1;
		translationY.value = 0;
		setPendingOrder(null);
	}, [
		activeIndex,
		activeKey,
		dragPositions,
		isFinalizing,
		pendingOrder,
		projectedIndexValue,
		props.items,
		props.keyExtractor,
		translationY,
	]);
	useFrameCallback((frame) => {
		if (activeIndex.value < 0 || isFinalizing.value || scrollRef === undefined) {
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
		const nextTranslationY = clamp(
			rawTranslationY.value + scrollOffset.value - startScrollOffset.value,
			-activeIndex.value * itemHeight,
			(itemCount - 1 - activeIndex.value) * itemHeight,
		);
		translationY.value = nextTranslationY;
		projectedIndexValue.value = projectedIndex(
			activeIndex.value,
			nextTranslationY,
			itemHeight,
			itemCount,
		);
	}, true);
	const beginDrag = useCallback(
		(key: string) => {
			setDraggingKey(key);
			onPickUp?.();
		},
		[onPickUp],
	);
	const finishDrag = useCallback(
		(fromIndex: number, toIndex: number) => {
			setDraggingKey(null);
			onDrop?.();
			const nextOrder = props.items.map(props.keyExtractor);
			const [movedKey] = nextOrder.splice(fromIndex, 1);
			nextOrder.splice(toIndex, 0, movedKey);
			setPendingOrder(nextOrder);
			if (fromIndex !== toIndex) {
				onReorder(fromIndex, toIndex);
			}
		},
		[onDrop, onReorder, props.items, props.keyExtractor],
	);
	const insertionLineStyle = useAnimatedStyle(() => ({
		opacity: activeIndex.value < 0 ? 0 : 1,
		transform: [{ translateY: projectedIndexValue.value * itemHeight }],
	}));

	return (
		<Animated.View className="relative">
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
						itemHeight={itemHeight}
						positions={itemPositions}
						activeIndex={activeIndex}
						isFinalizing={isFinalizing}
						scrollOffset={scrollOffset}
						translationY={translationY}
						dragPositions={dragPositions}
						renderItem={props.renderItem}
						onStart={() => beginDrag(key)}
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
