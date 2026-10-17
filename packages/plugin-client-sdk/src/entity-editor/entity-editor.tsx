import type { AssetLocator, ManagedAssetLocator } from "@ryot-app/contract/modules/assets/schemas";
import {
	type EntityEditorSaveRequest,
	retryableEntityEditorSaveRequest,
} from "@ryot-app/contract/modules/entities/editor";
import { EntityId, EntitySchemaSlug, type PluginPackageId } from "@ryot-app/contract/schema/brands";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { ActionForm, Button, Field, StatusMessage, TextField } from "@ryot-app/plugin-ui-sdk";
import {
	type SchemaAssetUpload,
	SchemaForm,
	type SchemaFormValues,
	useSchemaForm,
	validateSchemaFormValues,
} from "@ryot-app/plugin-ui-sdk/schema-form";
import { Effect } from "effect";
import { useLayoutEffect, useRef, useState } from "react";

import { managedAssetKey } from "../assets/keys";
import { ManagedAssetProvider } from "../assets/provider";
import { AssetImage } from "../assets/schema-form";
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
	managedAssetsOf,
	unreferencedUploads,
} from "./model";
import {
	entityEditorEntityDefinitionRecipe,
	entityEditorEntityRecipe,
	entityEditorRelationshipDefinitionsRecipe,
	entityEditorRelationshipsRecipe,
} from "./recipes";
import { RelationshipSection } from "./relationship-section";
import { schemaFormIcons } from "./schema-form-icons";

type EntityEditorMode =
	| { readonly kind: "edit"; readonly entityId: string }
	| { readonly kind: "create"; readonly seedEntityId?: string; readonly initialName?: string };

export type EntityEditorProps = {
	readonly onCancel: () => void;
	readonly mode: EntityEditorMode;
	readonly entitySchemaSlug: string;
	readonly packageId: PluginPackageId;
	readonly onSaved: (entityId: string) => void;
};

const editorTitle = (mode: EntityEditorMode, entityName: string) =>
	`${mode.kind === "edit" ? "Edit" : "New"} ${entityName}`;

const STALE_MESSAGE = "This changed elsewhere. Reload and try again.";
const SAVE_FAILED_MESSAGE = "Could not save. Try again.";

type DefinitionsInput = { readonly entitySchemaSlug: string; readonly packageId: PluginPackageId };

type SourceInput = DefinitionsInput & {
	readonly forEdit: boolean;
	readonly entityId: string | null;
	readonly relationshipSlugs: readonly string[];
};

const definitionsQuery = createRyotQuery(
	({ input, client }: { readonly client: RyotClient; readonly input: DefinitionsInput }) =>
		Effect.gen(function* () {
			const reference = client.pluginIdentity(input.packageId);
			const entity = yield* client.data.query(
				entityEditorEntityDefinitionRecipe({ reference, slug: input.entitySchemaSlug }),
			);
			const relationshipSlugs = entity.editor?.relationships ?? [];
			const found =
				relationshipSlugs.length === 0
					? []
					: yield* client.data.query(
							entityEditorRelationshipDefinitionsRecipe({ reference, slugs: relationshipSlugs }),
						);
			const relationships = relationshipSlugs.flatMap((slug) => {
				const definition = found.find((candidate) => candidate.slug === slug);
				const target = definition?.targetEntitySchemaSlug ?? null;
				return definition === undefined || target === null
					? []
					: [{ ...definition, targetEntitySchemaSlug: target }];
			});
			return { entity, relationships };
		}),
);

const sourceQuery = createRyotQuery(
	({ input, client }: { readonly client: RyotClient; readonly input: SourceInput }) =>
		Effect.gen(function* () {
			const empty = { entity: null, relationships: {} satisfies EditorRelationshipTargets };
			if (input.entityId === null) {
				return empty;
			}
			const reference = client.pluginIdentity(input.packageId);
			const entity = yield* client.data.query(
				entityEditorEntityRecipe({
					reference,
					entityId: input.entityId,
					entitySchemaSlug: input.entitySchemaSlug,
				}),
			);
			if (entity === null) {
				return empty;
			}
			const rows =
				input.relationshipSlugs.length === 0
					? { items: [] }
					: yield* readCursorPages((after) =>
							client.data.query(
								entityEditorRelationshipsRecipe({
									after,
									reference,
									slugs: input.relationshipSlugs,
									sourceEntityId: input.entityId ?? "",
								}),
							),
						);
			const visible = input.forEdit
				? rows.items.filter(({ userId }) => userId !== null)
				: rows.items;
			const relationships: Record<string, EditorRelationshipTarget[]> = {};
			for (const row of [...visible].sort(
				(left, right) => Number(left.userId === null) - Number(right.userId === null),
			)) {
				const targets = relationships[row.slug] ?? [];
				if (!targets.some(({ entityId }) => entityId === row.entityId)) {
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
	| { readonly kind: "error"; readonly message: string };

function EntityEditorForm(
	props: EntityEditorProps & {
		readonly definitions: {
			readonly entity: { readonly name: string; readonly propertiesSchema: AppSchema };
			readonly relationships: readonly EditorRelationshipDefinition[];
		};
		readonly source: {
			readonly relationships: EditorRelationshipTargets;
			readonly entity: {
				readonly name: string;
				readonly updatedAt: string;
				readonly properties: EditorProperties;
			} | null;
		};
	},
) {
	const client = useRyot();
	const schedule = useRyotSchedule();
	const reorderFeedback = () => {
		const identity = client.pluginIdentity(props.packageId);
		schedule.run(
			client
				.device({ action: "haptic", kind: "selection", pluginId: identity.pluginId })
				.pipe(Effect.ignore),
			() => undefined,
		);
	};
	const { mode, source, definitions } = props;
	const attempt = useRef<EntityEditorSaveRequest | undefined>(undefined);
	const schema = definitions.entity.propertiesSchema;
	const formMode = mode.kind === "edit" ? "edit" : "create";
	const stored = source.entity?.properties ?? {};
	const uploaded = useRef(new Map<string, ManagedAssetLocator>());
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

	const cleanup = (assets: readonly ManagedAssetLocator[]) =>
		Effect.forEach(assets, (asset) => Effect.ignore(client.uploads.cleanup(asset)), {
			discard: true,
		});

	const submit = (values: SchemaFormValues) => {
		const errors = new Map<string, string>();
		for (const definition of definitions.relationships) {
			for (const target of relationships[definition.slug] ?? []) {
				const message = [
					...validateSchemaFormValues(
						definition.propertiesSchema,
						entityFormValues(definition.propertiesSchema, target.properties),
					).values(),
				][0];
				if (message !== undefined) {
					errors.set(target.entityId, message);
				}
			}
		}
		setRowErrors(errors);
		if (name.trim() === "") {
			setNameError("Enter a name");
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
						Effect.sync(() => setStatus({ kind: "error", message: SAVE_FAILED_MESSAGE })),
					onSuccess: (output) => {
						if (output.kind === "saved") {
							return cleanup(
								unreferencedUploads(uploaded.current, properties, schema, relationshipAssets()),
							).pipe(Effect.andThen(Effect.sync(() => props.onSaved(output.entityId))));
						}
						return Effect.sync(() =>
							setStatus({
								kind: "error",
								message: output.kind === "stale" ? STALE_MESSAGE : output.message,
							}),
						);
					},
				}),
			),
			() => undefined,
		);
	};

	const form = useSchemaForm({ mode: formMode, onSubmit: submit, schemas: [schema] });
	const [initialValues] = useState(() => entityFormValues(schema, stored));
	useLayoutEffect(() => {
		form.reset({ fields: initialValues });
	}, [form, initialValues]);

	const uploadAsset: SchemaAssetUpload = (request) =>
		Effect.runPromise(
			client.uploads.uploadPermanent(request).pipe(
				Effect.match({
					onFailure: () => ({ kind: "failed" as const, message: "Upload failed. Try again." }),
					onSuccess: (asset) => {
						uploaded.current.set(managedAssetKey(asset), asset);
						return { asset, kind: "uploaded" as const };
					},
				}),
			),
		);

	const cancel = () => {
		schedule.run(
			cleanup([...uploaded.current.values()]).pipe(Effect.andThen(Effect.sync(props.onCancel))),
			() => undefined,
		);
	};

	return (
		<ActionForm
			onSubmit={() => void form.handleSubmit()}
			label={editorTitle(mode, definitions.entity.name)}
			className="mx-auto flex w-full max-w-2xl flex-col gap-5"
		>
			<Field label="Name" error={nameError}>
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
						Promise.resolve({ kind: "failed", message: "File uploads are not supported here." })
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
				<Button variant="ghost" onClick={cancel} disabled={status.kind === "saving"}>
					Cancel
				</Button>
				<Button loading={status.kind === "saving"} onClick={() => void form.handleSubmit()}>
					Save
				</Button>
			</div>
		</ActionForm>
	);
}

function EntityEditorSource(
	props: EntityEditorProps & {
		readonly definitions: Parameters<typeof EntityEditorForm>[0]["definitions"];
	},
) {
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
			relationshipSlugs: definitions.relationships.map(({ slug }) => slug),
		},
		{ refreshOnMutation: false },
	);
	if (source.isError) {
		return <LoadFailure onRetry={() => source.refetch()} />;
	}
	if (source.data === undefined) {
		return <StatusMessage tone="pending">Loading…</StatusMessage>;
	}
	if (entityId !== null && source.data.entity === null) {
		return <StatusMessage tone="error">This item is unavailable.</StatusMessage>;
	}
	return <EntityEditorForm {...props} source={source.data} definitions={definitions} />;
}

function LoadFailure(props: { readonly onRetry: () => void }) {
	return (
		<div className="flex flex-col items-start gap-3">
			<StatusMessage tone="error">The editor could not be loaded.</StatusMessage>
			<Button variant="secondary" onClick={props.onRetry}>
				Retry
			</Button>
		</div>
	);
}

export function EntityEditor(props: EntityEditorProps) {
	const { packageId, entitySchemaSlug } = props;
	const definitions = useRyotQuery(definitionsQuery, { packageId, entitySchemaSlug });
	if (definitions.isError) {
		return <LoadFailure onRetry={() => definitions.refetch()} />;
	}
	if (definitions.data === undefined) {
		return <StatusMessage tone="pending">Loading…</StatusMessage>;
	}
	if (definitions.data.entity.editor === null) {
		return <StatusMessage tone="error">This item cannot be edited here.</StatusMessage>;
	}
	return <EntityEditorSource {...props} definitions={definitions.data} />;
}

export function EntityEditorScreen(props: Omit<EntityEditorProps, "onCancel" | "onSaved">) {
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
				onSaved={(entityId) => client.navigation.replace({ entityId, kind: "entity" })}
			/>
		</PluginScreenFrame>
	);
}
