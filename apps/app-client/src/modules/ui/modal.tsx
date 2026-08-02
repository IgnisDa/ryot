import { useHotkey } from "@tanstack/react-hotkeys";
import clsx from "clsx";
import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { Modal, Pressable, View } from "react-native";

const visibleModals: symbol[] = [];

export function AppModal(props: {
	readonly visible: boolean;
	readonly className?: string;
	readonly closeLabel: string;
	readonly children: ReactNode;
	readonly onClose: () => void;
	readonly backdropClassName?: string;
}) {
	const id = useRef(Symbol("modal")).current;

	useEffect(() => {
		if (!props.visible) {
			return undefined;
		}
		visibleModals.push(id);
		return () => {
			const index = visibleModals.lastIndexOf(id);
			if (index !== -1) {
				visibleModals.splice(index, 1);
			}
		};
	}, [id, props.visible]);

	useHotkey(
		"Escape",
		() => {
			if (visibleModals.at(-1) === id) {
				props.onClose();
			}
		},
		{
			ignoreInputs: false,
			preventDefault: true,
			stopPropagation: true,
			enabled: props.visible,
			conflictBehavior: "allow",
		},
	);

	return (
		<Modal transparent animationType="fade" visible={props.visible} onRequestClose={props.onClose}>
			<View accessibilityViewIsModal className={clsx("flex-1", props.className)}>
				<Pressable
					onPress={props.onClose}
					accessibilityRole="button"
					accessibilityLabel={props.closeLabel}
					className={clsx("absolute inset-0", props.backdropClassName ?? "bg-overlay")}
				/>
				{props.children}
			</View>
		</Modal>
	);
}
