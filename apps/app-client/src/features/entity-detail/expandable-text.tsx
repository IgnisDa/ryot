import type { ComponentProps, ComponentRef } from "react";
import { useEffect, useRef, useState } from "react";
import { Platform } from "react-native";

import { Pressable } from "@/components/ui/pressable";
import { Text } from "@/components/ui/text";

export function ExpandableText(props: {
	children: string;
	className: string;
	collapsedLines?: number;
	toggleTextStyle?: ComponentProps<typeof Text>["style"];
}) {
	const { children, className, toggleTextStyle, collapsedLines = 4 } = props;
	const [expanded, setExpanded] = useState(false);
	const [canExpand, setCanExpand] = useState(false);
	const textRef = useRef<ComponentRef<typeof Text>>(null);

	useEffect(() => {
		if (Platform.OS !== "web") {
			return undefined;
		}
		if (typeof HTMLElement === "undefined" || typeof window === "undefined") {
			return undefined;
		}

		const text = textRef.current;
		if (!(text instanceof HTMLElement)) {
			return undefined;
		}

		const updateCanExpand = () => {
			const lineHeight = Number.parseFloat(window.getComputedStyle(text).lineHeight);
			if (Number.isNaN(lineHeight)) {
				return undefined;
			}

			setCanExpand(text.scrollHeight > lineHeight * collapsedLines + 1);
			return undefined;
		};

		updateCanExpand();

		const resizeObserver =
			typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(updateCanExpand);
		resizeObserver?.observe(text);
		window.addEventListener("resize", updateCanExpand);

		return () => {
			resizeObserver?.disconnect();
			window.removeEventListener("resize", updateCanExpand);
		};
	}, [children, collapsedLines]);

	return (
		<>
			{Platform.OS !== "web" ? (
				<Text
					className={className}
					accessibilityElementsHidden
					importantForAccessibility="no-hide-descendants"
					onTextLayout={(event) => setCanExpand(event.nativeEvent.lines.length > collapsedLines)}
					style={{ left: 0, right: 0, opacity: 0, position: "absolute" }}
				>
					{children}
				</Text>
			) : null}
			<Text
				ref={textRef}
				className={className}
				numberOfLines={expanded ? undefined : collapsedLines}
			>
				{children}
			</Text>
			{canExpand ? (
				<Pressable className="mt-2 self-start" onPress={() => setExpanded((value) => !value)}>
					<Text className="text-[13px] font-sans-medium web:text-[15px]" style={toggleTextStyle}>
						{expanded ? "Show less" : "Read more"}
					</Text>
				</Pressable>
			) : null}
		</>
	);
}
