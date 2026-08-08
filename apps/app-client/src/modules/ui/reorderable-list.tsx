import { type ReactNode, useCallback, useState } from "react";
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
	itemCount: number;
	itemHeight: number;
	onStart: () => void;
	isDragging: boolean;
	pointerY: SharedValue<number>;
	activeIndex: SharedValue<number>;
	translationY: SharedValue<number>;
	scrollOffset: SharedValue<number>;
	projectedIndex: SharedValue<number>;
	rawTranslationY: SharedValue<number>;
	startScrollOffset: SharedValue<number>;
	renderItem: ReorderableListProps<T>["renderItem"];
	onFinish: (fromIndex: number, toIndex: number) => void;
}) {
	const index = props.index;
	const onStart = props.onStart;
	const onFinish = props.onFinish;
	const pointerY = props.pointerY;
	const itemCount = props.itemCount;
	const itemHeight = props.itemHeight;
	const activeIndex = props.activeIndex;
	const translationY = props.translationY;
	const scrollOffset = props.scrollOffset;
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
			rawTranslationY.value = event.translationY;
			pointerY.value = event.absoluteY;
			updateTranslation(event.translationY);
		},
		onActivate: (event) => {
			activeIndex.value = index;
			rawTranslationY.value = 0;
			startScrollOffset.value = scrollOffset.value;
			pointerY.value = event.absoluteY;
			translationY.value = 0;
			projectedIndexValue.value = index;
			scheduleOnRN(onStart);
		},
		onFinalize: () => {
			if (activeIndex.value !== index) {
				return;
			}
			const toIndex = projectedIndexValue.value;
			activeIndex.value = -1;
			projectedIndexValue.value = -1;
			translationY.value = 0;
			scheduleOnRN(onFinish, index, toIndex);
		},
	});
	const rowStyle = useAnimatedStyle(() => {
		const active = activeIndex.value;
		const projected = projectedIndexValue.value;
		if (active === index) {
			return { transform: [{ translateY: translationY.value }], zIndex: 10 };
		}
		let displacement = 0;
		if (active < projected && index > active && index <= projected) {
			displacement = -itemHeight;
		}
		if (active > projected && index >= projected && index < active) {
			displacement = itemHeight;
		}
		return {
			transform: [{ translateY: withTiming(displacement, ROW_TIMING) }],
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
	const activeIndex = useSharedValue(-1);
	const itemCount = props.items.length;
	const itemHeight = props.itemHeight;
	const pointerY = useSharedValue(0);
	const projectedIndexValue = useSharedValue(-1);
	const rawTranslationY = useSharedValue(0);
	const scrollRef = props.scrollRef;
	const startScrollOffset = useSharedValue(0);
	const translationY = useSharedValue(0);
	const scrollOffset = useScrollOffset(scrollRef);
	const [draggingKey, setDraggingKey] = useState<string | null>(null);
	const onDrop = props.onDrop;
	const onPickUp = props.onPickUp;
	const onReorder = props.onReorder;
	useFrameCallback((frame) => {
		if (activeIndex.value < 0 || scrollRef === undefined) {
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
			if (fromIndex !== toIndex) {
				onReorder(fromIndex, toIndex);
			}
		},
		[onDrop, onReorder],
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
						index={index}
						pointerY={pointerY}
						onFinish={finishDrag}
						itemCount={itemCount}
						itemHeight={itemHeight}
						activeIndex={activeIndex}
						scrollOffset={scrollOffset}
						translationY={translationY}
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
