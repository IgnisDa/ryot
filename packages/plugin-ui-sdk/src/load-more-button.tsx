import { useT } from "@ryot-app/i18n/react";
import type { Text } from "@ryot-app/i18n/text";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { type ComponentProps, type ReactNode, useEffect, useRef } from "react";

import { Button } from "./button";

type LoadMoreButtonProps = Omit<ComponentProps<typeof Button>, "loading" | "children"> & {
	readonly label?: Text;
	readonly icon?: ReactNode;
	readonly loadingLabel?: Text;
	readonly isFetchingNextPage: boolean;
	readonly onVisible?: undefined | (() => void);
};

const PREFETCH_MARGIN = "0px 0px 800px 0px";

const scrollParent = (element: HTMLElement) => {
	for (let parent = element.parentElement; parent !== null; parent = parent.parentElement) {
		const { overflowY } = getComputedStyle(parent);
		if (overflowY === "auto" || overflowY === "scroll") {
			return parent;
		}
	}
	return null;
};

export function LoadMoreButton({
	icon,
	label,
	onVisible,
	loadingLabel,
	type = "button",
	isFetchingNextPage,
	variant = "secondary",
	...props
}: LoadMoreButtonProps) {
	const t = useT();
	const ref = useRef<HTMLButtonElement>(null);
	const idle = props.disabled !== true && !isFetchingNextPage;
	useEffect(() => {
		const element = ref.current;
		if (
			onVisible === undefined ||
			!idle ||
			element === null ||
			typeof IntersectionObserver !== "function"
		) {
			return undefined;
		}
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) {
					observer.disconnect();
					onVisible();
				}
			},
			{ root: scrollParent(element), rootMargin: PREFETCH_MARGIN },
		);
		observer.observe(element);
		return () => observer.disconnect();
	}, [idle, onVisible]);
	return (
		<Button {...props} ref={ref} type={type} variant={variant} loading={isFetchingNextPage}>
			{icon}
			{isFetchingNextPage
				? (loadingLabel ?? t(kernelMessage("common.status.loading-more")))
				: (label ?? t(kernelMessage("common.action.load-more")))}
		</Button>
	);
}
