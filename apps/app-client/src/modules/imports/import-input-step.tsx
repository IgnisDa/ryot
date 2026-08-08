import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { AppIcon } from "@/modules/icons";
import { AppButton } from "@/modules/ui/button";
import { FormMessage } from "@/modules/ui/form";
import type { SchemaFileUpload } from "@/modules/ui/schema-form/file/file-upload";
import { SchemaForm, type SchemaFormApi } from "@/modules/ui/schema-form/schema-form";

import type { ImportWizardSource } from "./source-selection";

const HELP_LABEL = "Where do I find this file?";

function ImportExportHelp(props: {
	readonly openLink: (url: string) => void;
	readonly help: NonNullable<ImportWizardSource["exportHelp"]>;
}) {
	const [isOpen, setIsOpen] = useState(false);
	const docsUrl = props.help.docsUrl;
	return (
		<View className="gap-2 rounded-lg border border-border bg-surface p-3">
			<Pressable
				accessibilityRole="button"
				accessibilityLabel={HELP_LABEL}
				onPress={() => setIsOpen(!isOpen)}
				accessibilityState={{ expanded: isOpen }}
				className="flex-row items-center justify-between gap-2"
			>
				<Text className="min-w-0 flex-1 font-ui-medium text-sm text-text">{HELP_LABEL}</Text>
				<AppIcon
					size={16}
					className="text-text-subtle"
					name={isOpen ? "chevron-up" : "chevron-down"}
				/>
			</Pressable>
			{isOpen ? (
				<View className="gap-2">
					{(props.help.steps ?? []).map((step, index) => (
						<View key={step} className="flex-row gap-2">
							<Text className="font-ui text-xs tabular-nums text-text-subtle">{`${index + 1}.`}</Text>
							<Text className="min-w-0 flex-1 font-ui text-xs leading-5 text-text-muted">
								{step}
							</Text>
						</View>
					))}
					{docsUrl === undefined ? null : (
						<Pressable
							accessibilityRole="link"
							accessibilityLabel="Open the export guide"
							onPress={() => props.openLink(docsUrl)}
							className="flex-row items-center gap-1.5 self-start py-1"
						>
							<Text className="font-ui-medium text-sm text-accent-text">Open the export guide</Text>
							<AppIcon size={14} name="arrow-right" className="text-accent-text" />
						</Pressable>
					)}
				</View>
			) : null}
		</View>
	);
}

export function ImportInputStep(props: {
	readonly onBack: () => void;
	readonly form: SchemaFormApi;
	readonly onContinue: () => void;
	readonly source: ImportWizardSource;
	readonly uploadFile: SchemaFileUpload;
	readonly openLink: (url: string) => void;
	readonly failureDetail: string | undefined;
}) {
	return (
		<View className="gap-4">
			<View className="gap-1">
				<Text className="font-display-semibold text-lg text-text">{props.source.name}</Text>
				<Text className="font-ui text-sm leading-6 text-text-muted">
					{props.source.description}
				</Text>
			</View>
			{props.source.exportHelp === undefined ? null : (
				<ImportExportHelp help={props.source.exportHelp} openLink={props.openLink} />
			)}
			<SchemaForm
				form={props.form}
				onChange={() => undefined}
				uploadFile={props.uploadFile}
				schema={props.source.inputSchema}
			/>
			{props.failureDetail === undefined ? null : <FormMessage>{props.failureDetail}</FormMessage>}
			<View className="gap-2 sm:flex-row-reverse sm:justify-end">
				<AppButton
					size="default"
					label="Continue"
					variant="primary"
					className="sm:px-6"
					onPress={props.onContinue}
				/>
				<AppButton size="default" label="Back" onPress={props.onBack} className="sm:px-6" />
			</View>
		</View>
	);
}
