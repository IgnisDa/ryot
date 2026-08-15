import { router, useLocalSearchParams } from "expo-router";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppModal } from "@/modules/ui/modal";

import { IMPORT_WIZARD_TITLE, ImportStartWizard } from "./import-start-wizard";

const IMPORT_START_OPEN_VALUE = "1";
const IMPORT_START_SEARCH_PARAM = "start";
type ImportStartParams = Partial<Record<typeof IMPORT_START_SEARCH_PARAM, string | string[]>>;

const setStartParam = (value: string | undefined) =>
	router.setParams({ [IMPORT_START_SEARCH_PARAM]: value });

const isStartOpen = (value: string | string[] | undefined) =>
	(Array.isArray(value) ? value[0] : value) === IMPORT_START_OPEN_VALUE;

export function useImportStartFlow() {
	return { open: () => setStartParam(IMPORT_START_OPEN_VALUE) };
}

export function ImportStartHost() {
	const insets = useSafeAreaInsets();
	const params = useLocalSearchParams<ImportStartParams>();
	const isOpen = isStartOpen(params[IMPORT_START_SEARCH_PARAM]);
	const close = () => setStartParam(undefined);

	if (!isOpen) {
		return null;
	}

	return (
		<AppModal
			visible={isOpen}
			onClose={close}
			closeLabel="Close the import wizard"
			className="md:items-center md:justify-center md:p-6"
		>
			<View
				aria-modal
				role="dialog"
				accessibilityViewIsModal
				aria-label={IMPORT_WIZARD_TITLE}
				style={{ paddingTop: insets.top }}
				className="w-full flex-1 bg-bg md:max-h-[85%] md:max-w-2xl md:flex-initial md:rounded-xl md:border md:border-border md:bg-surface md:shadow-card"
			>
				<ImportStartWizard onClose={close} />
			</View>
		</AppModal>
	);
}
