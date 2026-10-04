import { EntitySchemaSlug, type PluginPackageId } from "@ryot-app/contract/schema/brands";
import { Button, FieldMessage } from "@ryot-app/plugin-ui-sdk";
import {
	describeSchemaFormFields,
	SchemaForm,
	useSchemaForm,
	type SchemaAssetUpload,
	type SchemaAssetRenderer,
} from "@ryot-app/plugin-ui-sdk/schema-form";
import { Effect } from "effect";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { useRyot, useRyotSchedule } from "../queries/provider";
import {
	entityFormValues,
	entityPropertiesPayload,
	type EditorProperties,
	type EditorRelationshipDefinition,
	type EditorRelationshipTarget,
} from "./model";
import { entityEditorTargetsRecipe } from "./recipes";
import { schemaFormIcons, unsupportedFileUpload } from "./schema-form-icons";

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
	const client = useRyot();
	const schedule = useRyotSchedule();
	const cancel = useRef<(() => void) | undefined>(undefined);
	const [picking, setPicking] = useState(false);
	const [failed, setFailed] = useState(false);
	useEffect(() => () => cancel.current?.(), []);

	const pick = () => {
		const targetSlug = definition.targetEntitySchemaSlug;
		if (picking || targetSlug === null) {
			return;
		}
		setPicking(true);
		setFailed(false);
		const reference = client.pluginIdentity(props.packageId);
		cancel.current = schedule.run(
			Effect.gen(function* () {
				const outcome = yield* client.screens.pickEntity({
					schema: {
						slug: EntitySchemaSlug.make(targetSlug),
						owner: { kind: "plugin", pluginId: reference.pluginId },
					},
				});
				if (outcome.kind !== "selected") {
					return;
				}
				const existing = new Set(targets.map(({ entityId }) => entityId));
				const entityIds = [...new Set(outcome.entityIds)].filter((id) => !existing.has(id));
				if (entityIds.length === 0) {
					return;
				}
				const found = yield* client.data.query(
					entityEditorTargetsRecipe({ reference, entityIds, entitySchemaSlug: targetSlug }),
				);
				const names = new Map(found.map(({ id, name }) => [id, name]));
				props.onChange([
					...targets,
					...entityIds.flatMap((entityId) => {
						const name = names.get(entityId);
						return name === undefined ? [] : [{ name, entityId, properties: {} }];
					}),
				]);
			}).pipe(Effect.catch(() => Effect.sync(() => setFailed(true)))),
			() => setPicking(false),
		);
	};

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
										current.entityId === target.entityId
											? { properties, name: current.name, entityId: current.entityId }
											: current,
									),
								)
							}
						/>
					))}
				</ul>
			)}
			<Button
				size="sm"
				onClick={pick}
				loading={picking}
				variant="secondary"
				className="self-start"
				aria-label={`Add ${definition.name}`}
			>
				Add
			</Button>
			{failed ? <FieldMessage>Could not add. Try again.</FieldMessage> : null}
		</section>
	);
}
