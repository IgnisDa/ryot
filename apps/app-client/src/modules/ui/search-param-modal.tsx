import { router, useLocalSearchParams } from "expo-router";
import type { ReactNode } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppModal } from "@/modules/ui/modal";

const OPEN_VALUE = "1";

type SearchParamValue = string | string[] | undefined;

const setParam = (param: string, value: string | undefined) => router.setParams({ [param]: value });

const firstValue = (value: SearchParamValue) => (Array.isArray(value) ? value[0] : value);

/**
 * Keeps a full-screen flow in the URL so native back and web history close it, rather than in
 * component state that a navigation would strand.
 */
export function useSearchParamModal(param: string) {
	const params = useLocalSearchParams();
	return {
		isOpen: firstValue(params[param]) === OPEN_VALUE,
		open: () => setParam(param, OPEN_VALUE),
		close: () => setParam(param, undefined),
	};
}

export function SearchParamModalHost(props: {
	readonly title: string;
	readonly isOpen: boolean;
	readonly closeLabel: string;
	readonly onClose: () => void;
	readonly children: ReactNode;
}) {
	const insets = useSafeAreaInsets();

	if (!props.isOpen) {
		return null;
	}

	return (
		<AppModal
			visible={props.isOpen}
			onClose={props.onClose}
			closeLabel={props.closeLabel}
			className="md:items-center md:justify-center md:p-6"
		>
			<View
				aria-modal
				role="dialog"
				aria-label={props.title}
				accessibilityViewIsModal
				style={{ paddingTop: insets.top }}
				className="w-full flex-1 bg-bg md:max-h-[85%] md:max-w-2xl md:flex-initial md:rounded-xl md:border md:border-border md:bg-surface md:shadow-card"
			>
				{props.children}
			</View>
		</AppModal>
	);
}
