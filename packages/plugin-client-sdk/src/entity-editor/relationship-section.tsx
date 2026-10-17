import type { PluginPackageId } from "@ryot-app/contract/schema/brands";
import {
	Button,
	Dialog,
	FieldMessage,
	LoadMoreButton,
	SearchField,
	StatusMessage,
} from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import {
	describeSchemaFormFields,
	SchemaForm,
	useSchemaForm,
	type SchemaAssetUpload,
	type SchemaAssetRenderer,
} from "@ryot-app/plugin-ui-sdk/schema-form";
import { useDeferredValue, useLayoutEffect, useState } from "react";

import type { RyotClient } from "../client/client";
import { createRyotQuery } from "../queries/definitions";
import { nextPageCursor, paginationItems } from "../queries/pagination";
import { useRyotInfiniteQuery } from "../queries/pagination-hook";
import {
	entityFormValues,
	entityPropertiesPayload,
	type EditorProperties,
	type EditorRelationshipDefinition,
	type EditorRelationshipTarget,
} from "./model";
import { entityEditorCandidatesRecipe } from "./recipes";
import { schemaFormIcons, unsupportedFileUpload } from "./schema-form-icons";

const candidatesQuery = createRyotQuery(
	({
		input,
		client,
	}: {
		readonly client: RyotClient;
		readonly input: {
			readonly after: string | undefined;
			readonly search: string;
			readonly packageId: PluginPackageId;
			readonly entitySchemaSlug: string;
		};
	}) =>
		client.data.query(
			entityEditorCandidatesRecipe({
				after: input.after,
				search: input.search,
				entitySchemaSlug: input.entitySchemaSlug,
				reference: client.pluginIdentity(input.packageId),
			}),
		),
	{ cancelOnUnmount: true },
);

function TargetPicker(props: {
	readonly onClose: () => void;
	readonly packageId: PluginPackageId;
	readonly selected: ReadonlySet<string>;
	readonly definition: EditorRelationshipDefinition;
	readonly onPick: (candidate: Pick<EditorRelationshipTarget, "entityId" | "name">) => void;
}) {
	const [search, setSearch] = useState("");
	const deferredSearch = useDeferredValue(search);
	const result = useRyotInfiniteQuery(
		candidatesQuery,
		{
			search: deferredSearch,
			packageId: props.packageId,
			entitySchemaSlug: props.definition.targetEntitySchemaSlug ?? "",
		},
		{
			initialPageParam: undefined,
			getNextPageParam: nextPageCursor,
			getPageInput: (input, after: string | undefined) => ({ ...input, after }),
		},
	);
	const candidates = paginationItems(
		result.pages,
		(page) => page.items,
		(item) => item.id,
	);
	return (
		<Dialog
			size="md"
			closeLabel="Close"
			onClose={props.onClose}
			title={`Add ${props.definition.name}`}
		>
			<div className="flex flex-col gap-3">
				<SearchField
					autoFocus
					value={search}
					label="Search"
					icon={<AppIcon size={15} name="search" />}
					clearIcon={<AppIcon name="x" size={14} />}
					onChange={(value) => {
						setSearch(value);
					}}
				/>
				{result.isError ? (
					<StatusMessage tone="error">Options could not be loaded.</StatusMessage>
				) : null}
				{result.data === undefined && !result.isError ? (
					<StatusMessage tone="pending">Loading…</StatusMessage>
				) : null}
				{result.data !== undefined && candidates.length === 0 ? (
					<StatusMessage tone="pending">Nothing matches.</StatusMessage>
				) : null}
				<ul className="m-0 flex list-none flex-col gap-1 p-0">
					{candidates.map((candidate) => (
						<li key={candidate.id}>
							<Button
								size="sm"
								variant="ghost"
								className="w-full justify-start"
								disabled={props.selected.has(candidate.id)}
								onClick={() => {
									props.onPick({ name: candidate.name, entityId: candidate.id });
									props.onClose();
								}}
							>
								{candidate.name}
							</Button>
						</li>
					))}
				</ul>
				{result.hasNextPage ? (
					<LoadMoreButton
						size="sm"
						label="Show more"
						disabled={result.isFetching}
						onClick={result.fetchNextPage}
						isFetchingNextPage={result.isFetchingNextPage}
					/>
				) : null}
			</div>
		</Dialog>
	);
}

function TargetRow(props: {
	readonly error: string | undefined;
	readonly definition: EditorRelationshipDefinition;
	readonly target: EditorRelationshipTarget;
	readonly onRemove: () => void;
	readonly onChange: (properties: EditorProperties) => void;
	readonly uploadAsset: SchemaAssetUpload;
	readonly renderAsset: SchemaAssetRenderer;
	readonly onReorder: () => void;
}) {
	const { target, definition } = props;
	const schema = definition.propertiesSchema;
	const form = useSchemaForm({ schemas: [schema], onSubmit: () => undefined });
	const [initialValues] = useState(() => entityFormValues(schema, target.properties));
	useLayoutEffect(() => {
		form.reset({ fields: initialValues });
	}, [form, initialValues]);
	const editable = describeSchemaFormFields(schema).fields.length > 0;
	return (
		<li className="flex flex-col gap-2 rounded-lg border border-border-card bg-surface p-3">
			<div className="flex flex-row items-center gap-2">
				<span className="min-w-0 flex-1 truncate text-sm font-medium text-text">{target.name}</span>
				<Button
					size="sm"
					variant="ghost"
					onClick={props.onRemove}
					aria-label={`Remove ${target.name} from ${definition.name}`}
				>
					Remove
				</Button>
			</div>
			{editable ? (
				<SchemaForm
					form={form}
					schema={schema}
					icons={schemaFormIcons}
					onReorder={props.onReorder}
					uploadAsset={props.uploadAsset}
					renderAsset={props.renderAsset}
					uploadFile={unsupportedFileUpload}
					onChange={() =>
						props.onChange(
							entityPropertiesPayload(
								schema,
								form.state.values.fields,
								"create",
								target.properties,
							),
						)
					}
				/>
			) : null}
			{props.error === undefined ? null : <FieldMessage>{props.error}</FieldMessage>}
		</li>
	);
}

export function RelationshipSection(props: {
	readonly packageId: PluginPackageId;
	readonly definition: EditorRelationshipDefinition;
	readonly targets: readonly EditorRelationshipTarget[];
	readonly errors: ReadonlyMap<string, string>;
	readonly onChange: (targets: readonly EditorRelationshipTarget[]) => void;
	readonly uploadAsset: SchemaAssetUpload;
	readonly renderAsset: SchemaAssetRenderer;
	readonly onReorder: () => void;
}) {
	const { targets, definition } = props;
	const [picking, setPicking] = useState(false);
	return (
		<section aria-label={definition.name} className="flex flex-col gap-2">
			<h3 className="text-sm font-semibold text-text">{definition.name}</h3>
			{targets.length === 0 ? (
				<p className="text-xs text-text-subtle">None added.</p>
			) : (
				<ul className="m-0 flex list-none flex-col gap-2 p-0">
					{targets.map((target) => (
						<TargetRow
							target={target}
							key={target.entityId}
							definition={definition}
							onReorder={props.onReorder}
							uploadAsset={props.uploadAsset}
							renderAsset={props.renderAsset}
							error={props.errors.get(target.entityId)}
							onRemove={() =>
								props.onChange(targets.filter(({ entityId }) => entityId !== target.entityId))
							}
							onChange={(properties) =>
								props.onChange(
									targets.map((current) =>
										current.entityId === target.entityId ? { ...current, properties } : current,
									),
								)
							}
						/>
					))}
				</ul>
			)}
			<Button
				size="sm"
				variant="secondary"
				className="self-start"
				onClick={() => setPicking(true)}
				aria-label={`Add ${definition.name}`}
			>
				Add
			</Button>
			{picking ? (
				<TargetPicker
					definition={definition}
					packageId={props.packageId}
					onClose={() => setPicking(false)}
					selected={new Set(targets.map(({ entityId }) => entityId))}
					onPick={(candidate) => props.onChange([...targets, { ...candidate, properties: {} }])}
				/>
			) : null}
		</section>
	);
}
