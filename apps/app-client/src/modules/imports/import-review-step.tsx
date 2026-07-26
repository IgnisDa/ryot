import { Text, View } from "react-native";

import { AppButton } from "@/modules/ui/button";
import { FormMessage } from "@/modules/ui/form";
import { schemaReviewRows } from "@/modules/ui/schema-form/review-summary";
import type { SchemaFormValues } from "@/modules/ui/schema-form/schema-form-state";

import { importSourceInputShape, type ImportWizardSource } from "./source-selection";

const UNDOABLE_NOTE =
	"Starting this adds these entries to your library. An import cannot be undone.";

export function ImportReviewStep(props: {
	readonly pending: boolean;
	readonly onBack: () => void;
	readonly onStart: () => void;
	readonly values: SchemaFormValues;
	readonly source: ImportWizardSource;
	readonly failureDetail: string | undefined;
}) {
	const rows = schemaReviewRows(props.source.inputSchema, props.values);
	return (
		<View className="gap-4">
			<View className="gap-3 rounded-lg border border-border bg-surface p-3">
				<View className="flex-row items-center justify-between gap-3">
					<Text numberOfLines={1} className="min-w-0 flex-1 font-ui-semibold text-base text-text">
						{props.source.name}
					</Text>
					<Text className="rounded-pill border border-border-strong px-2 py-0.5 font-ui-medium text-[11px] text-text-muted">
						{importSourceInputShape(props.source.inputSchema)}
					</Text>
				</View>
				{rows.length === 0 ? (
					<Text className="font-ui text-sm text-text-muted">
						This service needs nothing else from you.
					</Text>
				) : (
					<View className="gap-2">
						{rows.map((row) => (
							<View key={row.label} className="gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
								<Text className="font-ui text-xs text-text-subtle sm:w-40">{row.label}</Text>
								<Text className="min-w-0 flex-1 font-ui-medium text-sm text-text">{row.value}</Text>
							</View>
						))}
					</View>
				)}
			</View>
			<Text className="font-ui text-sm leading-6 text-text-muted">{UNDOABLE_NOTE}</Text>
			{props.failureDetail === undefined ? null : <FormMessage>{props.failureDetail}</FormMessage>}
			<View className="gap-2 sm:flex-row-reverse sm:justify-end">
				<AppButton
					size="default"
					variant="primary"
					className="sm:px-6"
					label="Start import"
					pending={props.pending}
					onPress={props.onStart}
					pendingLabel="Starting..."
				/>
				<AppButton
					label="Back"
					size="default"
					className="sm:px-6"
					onPress={props.onBack}
					disabled={props.pending}
				/>
			</View>
		</View>
	);
}
