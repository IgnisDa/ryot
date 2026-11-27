import type { AssetLocator, ManagedAssetLocator } from "@ryot-app/contract/modules/assets/schemas";
import type { EntityEditorSaveRequest } from "@ryot-app/contract/modules/entities/editor";
import { relationshipEnds } from "@ryot-app/contract/modules/relationships/orientation";
import { EntityId, EntitySchemaSlug, type PluginPackageId } from "@ryot-app/contract/schema/brands";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import type { Message } from "@ryot-app/i18n/message";
import { useT } from "@ryot-app/i18n/react";
import type { Text } from "@ryot-app/i18n/text";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import {
	ActionForm,
	Button,
	DestructiveConfirmation,
	Field,
	StatusMessage,
	TextField,
} from "@ryot-app/plugin-ui-sdk";
import {
	SchemaForm,
	type SchemaFormValues,
	useSchemaForm,
	validateSchemaFormValues,
} from "@ryot-app/plugin-ui-sdk/schema-form";
import { Effect } from "effect";
import { useLayoutEffect, useRef, useState } from "react";

import { ManagedAssetProvider } from "../assets/provider";
import { AssetImage, useSchemaAssetUpload } from "../assets/schema-form";
import type { RyotClient } from "../client/client";
import { PluginScreenFrame } from "../plugin-screen";
import { readCursorPages } from "../queries/cursor-pages";
import { createRyotQuery } from "../queries/definitions";
import { useRyotQuery } from "../queries/hooks";
import { usePluginNavigation, useRyot, useRyotSchedule } from "../queries/provider";
import {
	buildSubmission,
	type EditorProperties,
	type EditorRelationshipDefinition,
	type EditorRelationshipTarget,
	type EditorRelationshipTargets,
	entityFormValues,
	entityPropertiesPayload,
	entityRelationshipPayload,
	managedAssetsOf,
} from "./model";
import {
	entityEditorEntityDefinitionRecipe,
	entityEditorEntityRecipe,
	entityEditorRelationshipDefinitionsRecipe,
	entityEditorRelationshipsRecipe,
	entityEditorTargetsRecipe,
} from "./recipes";
import { RelationshipSection } from "./relationship-section";
import { retryableEntityEditorSaveRequest } from "./request";
import { schemaFormIcons } from "./schema-form-icons";

export type EntityEditorProps = {
	readonly onCancel: () => void;
	readonly onDeleted: () => void;
	readonly mode: EntityEditorMode;
	readonly entitySchemaSlug: string;
	readonly packageId: PluginPackageId;
	readonly onSaved: (entityId: string, parentEntityId: string | undefined) => void;
};

type EntityEditorMode =
	| { readonly kind: "edit"; readonly entityId: string }
	| {
			readonly kind: "create";
			readonly initialName?: string;
			readonly seedEntityId?: string;
			readonly initialProperties?: EditorProperties;
			readonly parents?: Readonly<Record<string, string>>;
	  };

const editorTitle = (mode: EntityEditorMode, name: Message) =>
	kernelMessage("sdk.entity-editor.title", { name, mode: mode.kind });

type DefinitionsInput = { readonly entitySchemaSlug: string; readonly packageId: PluginPackageId };

type SourceInput = DefinitionsInput & {
	readonly forEdit: boolean;
	readonly entityId: null | string;
	readonly parents: Readonly<Record<string, string>>;
	readonly relationships: readonly Pick<
		EditorRelationshipDefinition,
		"slug" | "direction" | "relatedEntitySchemaSlug"
	>[];
};

const definitionsQuery = createRyotQuery(
	({ input, client }: { readonly client: RyotClient; readonly input: DefinitionsInput }) =>
		Effect.gen(function* () {
			const reference = client.pluginIdentity(input.packageId);
			const entity = yield* client.data.query(
				entityEditorEntityDefinitionRecipe({ reference, slug: input.entitySchemaSlug }),
				{},
			);
			const declared = entity.editor?.relationships ?? [];
			const found =
				declared.length === 0
					? []
					: yield* client.data.query(
							entityEditorRelationshipDefinitionsRecipe({
								reference,
								slugs: declared.map(({ slug }) => slug),
							}),
							{},
						);
			const relationships = declared.flatMap(({ slug, direction }) => {
				const definition = found.find((candidate) => candidate.slug === slug);
				if (definition === undefined) {
					return [];
				}
				const related = definition[`${relationshipEnds(direction).related}EntitySchemaSlug`];
				return related === null
					? []
					: [
							{
								slug,
								direction,
								name: definition.name,
								relatedEntitySchemaSlug: related,
								propertiesSchema: definition.propertiesSchema,
							},
						];
			});
			return { entity, relationships };
		}),
);

const sourceQuery = createRyotQuery(
	({ input, client }: { readonly client: RyotClient; readonly input: SourceInput }) =>
		Effect.gen(function* () {
			const reference = client.pluginIdentity(input.packageId);
			const relationships: Record<string, EditorRelationshipTarget[]> = Object.fromEntries(
				input.relationships.map(({ slug }) => [slug, []]),
			);
			for (const definition of input.relationships) {
				const parentId = input.parents[definition.slug];
				if (definition.direction !== "parent" || parentId === undefined) {
					continue;
				}
				const [parent] = yield* client.data.query(
					entityEditorTargetsRecipe({
						reference,
						entitySchemaSlug: definition.relatedEntitySchemaSlug,
					}),
					{ entityIds: [EntityId.make(parentId)] },
				);
				if (parent !== undefined) {
					relationships[definition.slug] = [
						{ properties: {}, name: parent.name, entityId: parent.id },
					];
				}
			}
			if (input.entityId === null) {
				return { entity: null, relationships };
			}
			const entityId = input.entityId;
			const entity = yield* client.data.query(
				entityEditorEntityRecipe({ reference, entitySchemaSlug: input.entitySchemaSlug }),
				{ entityId },
			);
			if (entity === null) {
				return { entity: null, relationships };
			}
			const rows = yield* Effect.forEach(["outgoing", "incoming"] as const, (direction) => {
				const slugs = input.relationships
					.filter(
						(definition) => (definition.direction === "outgoing") === (direction === "outgoing"),
					)
					.map(({ slug }) => slug);
				return slugs.length === 0
					? Effect.succeed([])
					: readCursorPages((after) =>
							client.data.query(
								entityEditorRelationshipsRecipe({ slugs, direction, reference }),
								{ entityId },
								{ pages: { relationships: { after } } },
							),
						).pipe(Effect.map(({ items }) => items));
			});
			const visible = rows
				.flat()
				.filter(({ userId }) => !input.forEdit || userId !== null)
				.sort((left, right) => Number(left.userId === null) - Number(right.userId === null));
			for (const row of visible) {
				const targets = relationships[row.slug] ?? [];
				if (!targets.some(({ entityId: related }) => related === row.entityId)) {
					targets.push({ name: row.name, entityId: row.entityId, properties: row.properties });
				}
				relationships[row.slug] = targets;
			}
			return { entity, relationships };
		}),
	{ cancelOnUnmount: true },
);

const renderAsset = (asset: AssetLocator) => <AssetImage asset={asset} />;

type SaveStatus =
	| { readonly kind: "idle" }
	| { readonly kind: "saving" }
	| { readonly kind: "error"; readonly message: Text };

export function EntityEditor(props: EntityEditorProps) {
	const t = useT();
	const { packageId, entitySchemaSlug } = props;
	const definitions = useRyotQuery(definitionsQuery, { packageId, entitySchemaSlug });
	if (definitions.isError) {
		return <LoadFailure onRetry={() => definitions.refetch()} />;
	}
	if (definitions.data === undefined) {
		return (
			<StatusMessage tone="pending">{t(kernelMessage("common.status.loading"))}</StatusMessage>
		);
	}
	if (definitions.data.entity.editor === null) {
		return (
			<StatusMessage tone="error">
				{t(kernelMessage("sdk.entity-editor.not-editable"))}
			</StatusMessage>
		);
	}
	return <EntityEditorSource {...props} definitions={definitions.data} />;
}

export function EntityEditorScreen(
	props: Omit<EntityEditorProps, "onSaved" | "onCancel" | "onDeleted">,
) {
	const { mode, packageId, entitySchemaSlug } = props;
	const client = useRyot();
	const navigation = usePluginNavigation();
	const definitions = useRyotQuery(definitionsQuery, { packageId, entitySchemaSlug });
	return (
		<PluginScreenFrame
			title={
				definitions.data === undefined ? null : editorTitle(mode, definitions.data.entity.name)
			}
		>
			<EntityEditor
				{...props}
				onCancel={() => navigation.back()}
				onDeleted={() => navigation.back()}
				onSaved={(entityId, parentEntityId) =>
					parentEntityId === undefined
						? client.navigation.replace({ entityId, kind: "entity" })
						: navigation.back()
				}
			/>
		</PluginScreenFrame>
	);
}

function LoadFailure(props: { readonly onRetry: () => void }) {
	const t = useT();
	return (
		<div className="flex flex-col items-start gap-3">
			<StatusMessage tone="error">
				{t(kernelMessage("sdk.entity-editor.load-failed"))}
			</StatusMessage>
			<Button variant="secondary" onClick={props.onRetry}>
				{t(kernelMessage("common.action.retry"))}
			</Button>
		</div>
	);
}

function EntityEditorSource(
	props: EntityEditorProps & {
		readonly definitions: Parameters<typeof EntityEditorForm>[0]["definitions"];
	},
) {
	const t = useT();
	const { mode, packageId, definitions, entitySchemaSlug } = props;
	const forEdit = mode.kind === "edit";
	const entityId = mode.kind === "edit" ? mode.entityId : (mode.seedEntityId ?? null);
	const source = useRyotQuery(
		sourceQuery,
		{
			forEdit,
			entityId,
			packageId,
			entitySchemaSlug,
			parents: (mode.kind === "create" ? mode.parents : undefined) ?? {},
			relationships: definitions.relationships.map(
				({ slug, direction, relatedEntitySchemaSlug }) => ({
					slug,
					direction,
					relatedEntitySchemaSlug,
				}),
			),
		},
		{ refreshOnMutation: false },
	);
	if (source.isError) {
		return <LoadFailure onRetry={() => source.refetch()} />;
	}
	if (source.data === undefined) {
		return (
			<StatusMessage tone="pending">{t(kernelMessage("common.status.loading"))}</StatusMessage>
		);
	}
	if (entityId !== null && source.data.entity === null) {
		return (
			<StatusMessage tone="error">
				{t(kernelMessage("sdk.entity-editor.unavailable"))}
			</StatusMessage>
		);
	}
	if (forEdit && source.data.entity?.canEdit !== true) {
		return (
			<StatusMessage tone="error">
				{t(kernelMessage("sdk.entity-editor.not-editable"))}
			</StatusMessage>
		);
	}
	return <EntityEditorForm {...props} source={source.data} definitions={definitions} />;
}

function EntityEditorForm(
	props: EntityEditorProps & {
		readonly source: {
			readonly relationships: EditorRelationshipTargets;
			readonly entity: null | {
				readonly name: string;
				readonly updatedAt: string;
				readonly properties: EditorProperties;
			};
		};
		readonly definitions: {
			readonly relationships: readonly EditorRelationshipDefinition[];
			readonly entity: {
				readonly name: Message;
				readonly propertiesSchema: AppSchema;
				readonly editor: null | { readonly deletable?: boolean | undefined };
			};
		};
	},
) {
	const client = useRyot();
	const schedule = useRyotSchedule();
	const t = useT();
	const reorderFeedback = () => {
		schedule.run(
			client.device({ action: "haptic", kind: "selection" }).pipe(Effect.ignore),
			() => undefined,
		);
	};
	const { mode, source, definitions } = props;
	const attempt = useRef<undefined | EntityEditorSaveRequest>(undefined);
	const schema = definitions.entity.propertiesSchema;
	const formMode = mode.kind === "edit" ? "edit" : "create";
	const stored = source.entity?.properties ?? {};
	const nameInput = useRef<HTMLInputElement>(null);
	const [nameError, setNameError] = useState<string>();
	const [status, setStatus] = useState<SaveStatus>({ kind: "idle" });
	const [name, setName] = useState(
		(mode.kind === "create" ? mode.initialName : undefined) ?? source.entity?.name ?? "",
	);
	const [relationships, setRelationships] = useState<EditorRelationshipTargets>(
		source.relationships,
	);
	const [rowErrors, setRowErrors] = useState<ReadonlyMap<string, string>>(new Map());
	const relationshipAssets = () =>
		definitions.relationships.flatMap((definition) =>
			(relationships[definition.slug] ?? []).flatMap((target) =>
				managedAssetsOf(target.properties, definition.propertiesSchema),
			),
		);
	const [managed, setManaged] = useState<readonly ManagedAssetLocator[]>(
		managedAssetsOf(stored, schema),
	);

	const parentEntityId = definitions.relationships
		.flatMap((definition) =>
			definition.direction === "parent" ? (source.relationships[definition.slug] ?? []) : [],
		)
		.at(0)?.entityId;
	const submit = (values: SchemaFormValues) => {
		const errors = new Map<string, string>();
		for (const definition of definitions.relationships) {
			for (const target of relationships[definition.slug] ?? []) {
				const message = [
					...validateSchemaFormValues(
						definition.propertiesSchema,
						entityFormValues(definition.propertiesSchema, target.properties),
						t,
					).values(),
				][0];
				if (message !== undefined) {
					errors.set(target.entityId, message);
				}
			}
		}
		setRowErrors(errors);
		if (name.trim() === "") {
			setNameError(t(kernelMessage("sdk.entity-editor.name-required")));
			nameInput.current?.focus();
			return;
		}
		if (errors.size > 0) {
			return;
		}
		setNameError(undefined);
		setStatus({ kind: "saving" });
		const properties = entityPropertiesPayload(schema, values, formMode, stored);
		const submission = buildSubmission({
			name,
			properties,
			relationships,
			entitySchema: {
				slug: EntitySchemaSlug.make(props.entitySchemaSlug),
				owner: { kind: "plugin", pluginId: client.pluginIdentity(props.packageId).pluginId },
			},
			target:
				mode.kind === "edit" && source.entity !== null
					? {
							kind: "update",
							entityId: EntityId.make(mode.entityId),
							expected: {
								name: source.entity.name,
								updatedAt: source.entity.updatedAt,
								properties: { ...source.entity.properties },
								relationships: entityRelationshipPayload(source.relationships),
							},
						}
					: { kind: "create" },
		});
		const request = retryableEntityEditorSaveRequest(
			attempt.current,
			submission,
			new Date(schedule.now()),
		);
		attempt.current = request;
		schedule.run(
			client.entities.save(request).pipe(
				Effect.matchEffect({
					onFailure: () =>
						Effect.sync(() =>
							setStatus({
								kind: "error",
								message: t(kernelMessage("sdk.entity-editor.save-failed")),
							}),
						),
					onSuccess: (output) => {
						if (output.kind === "saved") {
							return Effect.sync(() => props.onSaved(output.entityId, parentEntityId));
						}
						return Effect.sync(() =>
							setStatus({
								kind: "error",
								message:
									output.kind === "invalid"
										? t(output.reason)
										: t(kernelMessage("sdk.entity-editor.stale")),
							}),
						);
					},
				}),
			),
			() => undefined,
		);
	};

	const deleteTrigger = useRef<HTMLButtonElement>(null);
	const deleteAttempt = useRef<undefined | EntityEditorSaveRequest>(undefined);
	const [deleting, setDeleting] = useState<null | SaveStatus>(null);
	const confirmDelete = () => {
		if (mode.kind !== "edit" || source.entity === null) {
			return;
		}
		setDeleting({ kind: "saving" });
		const request = retryableEntityEditorSaveRequest(
			deleteAttempt.current,
			{
				action: "delete",
				entityId: EntityId.make(mode.entityId),
				expectedUpdatedAt: source.entity.updatedAt,
				entitySchema: {
					slug: EntitySchemaSlug.make(props.entitySchemaSlug),
					owner: { kind: "plugin", pluginId: client.pluginIdentity(props.packageId).pluginId },
				},
			},
			new Date(schedule.now()),
		);
		deleteAttempt.current = request;
		schedule.run(
			client.entities.save(request).pipe(
				Effect.match({
					onFailure: () =>
						setDeleting({
							kind: "error",
							message: t(kernelMessage("sdk.entity-editor.delete-failed")),
						}),
					onSuccess: (output) => {
						if (output.kind === "deleted") {
							props.onDeleted();
							return;
						}
						setDeleting({
							kind: "error",
							message:
								output.kind === "invalid"
									? t(output.reason)
									: t(kernelMessage("sdk.entity-editor.stale")),
						});
					},
				}),
			),
			() => undefined,
		);
	};

	const form = useSchemaForm({ mode: formMode, onSubmit: submit, schemas: [schema] });
	const [initialValues] = useState(() =>
		entityFormValues(schema, {
			...stored,
			...(mode.kind === "create" ? mode.initialProperties : undefined),
		}),
	);
	useLayoutEffect(() => {
		form.reset({ fields: initialValues });
	}, [form, initialValues]);

	const uploadAsset = useSchemaAssetUpload();

	return (
		<ActionForm
			onSubmit={() => void form.handleSubmit()}
			label={t(editorTitle(mode, definitions.entity.name))}
			className="mx-auto flex w-full max-w-2xl flex-col gap-5"
		>
			<Field error={nameError} label={t(kernelMessage("sdk.entity-editor.name"))}>
				{(control) => (
					<TextField
						{...control}
						value={name}
						ref={nameInput}
						onChange={(event) => setName(event.currentTarget.value)}
					/>
				)}
			</Field>
			<ManagedAssetProvider assets={[...managed, ...relationshipAssets()]}>
				<SchemaForm
					form={form}
					schema={schema}
					mode={formMode}
					icons={schemaFormIcons}
					uploadAsset={uploadAsset}
					renderAsset={renderAsset}
					onReorder={reorderFeedback}
					uploadFile={() =>
						Promise.resolve({
							kind: "failed",
							message: t(kernelMessage("sdk.entity-editor.uploads-unsupported")),
						})
					}
					onChange={() =>
						setManaged(
							managedAssetsOf(
								entityPropertiesPayload(schema, form.state.values.fields, formMode, stored),
								schema,
							),
						)
					}
				/>
				{definitions.relationships.map((definition) => (
					<RelationshipSection
						errors={rowErrors}
						key={definition.slug}
						definition={definition}
						uploadAsset={uploadAsset}
						renderAsset={renderAsset}
						packageId={props.packageId}
						onReorder={reorderFeedback}
						targets={relationships[definition.slug] ?? []}
						onChange={(targets) =>
							setRelationships((current) => ({ ...current, [definition.slug]: targets }))
						}
					/>
				))}
			</ManagedAssetProvider>
			{status.kind === "error" ? (
				<StatusMessage tone="error">{status.message}</StatusMessage>
			) : null}
			<div className="flex flex-row justify-end gap-2">
				{mode.kind === "edit" && definitions.entity.editor?.deletable === true ? (
					<Button
						variant="danger"
						ref={deleteTrigger}
						className="mr-auto"
						disabled={status.kind === "saving"}
						onClick={() => setDeleting({ kind: "idle" })}
					>
						{t(kernelMessage("common.action.delete"))}
					</Button>
				) : null}
				<Button variant="ghost" onClick={props.onCancel} disabled={status.kind === "saving"}>
					{t(kernelMessage("common.action.cancel"))}
				</Button>
				<Button loading={status.kind === "saving"} onClick={() => void form.handleSubmit()}>
					{t(kernelMessage("common.action.save"))}
				</Button>
			</div>
			{deleting === null ? null : (
				<DestructiveConfirmation
					onConfirm={confirmDelete}
					triggerRef={deleteTrigger}
					onClose={() => setDeleting(null)}
					pending={deleting.kind === "saving"}
					actionLabel={t(kernelMessage("common.action.delete"))}
					pendingLabel={t(kernelMessage("common.status.deleting"))}
					title={t(kernelMessage("sdk.entity-editor.delete-title"))}
					detail={t(kernelMessage("sdk.entity-editor.delete-detail"))}
					errorMessage={deleting.kind === "error" ? deleting.message : undefined}
				/>
			)}
		</ActionForm>
	);
}
