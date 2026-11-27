import { Schema } from "effect";

import { PluginOperationHints, PluginOperationJsonSchema } from "../modules/plugins/manifest";
import { PluginPackageId } from "./brands";
import { strictStruct } from "./utils";

export const KERNEL_CAPABILITY_OWNER = "kernel";

const isCapabilityOwner = Schema.is(PluginPackageId);
const kernelSlugPattern = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

const capabilityIdIssue = (value: string) => {
	const separator = value.indexOf(":");
	const owner = value.slice(0, separator);
	const name = value.slice(separator + 1);
	if (separator <= 0 || name.length === 0) {
		return "Expected <owner>:<name>";
	}
	if (owner === KERNEL_CAPABILITY_OWNER) {
		return kernelSlugPattern.test(name) ? true : "Expected a kernel capability slug";
	}
	if (!isCapabilityOwner(owner)) {
		return "Expected kernel or a plugin package owner";
	}
	return /^(?:operations|queries)\/./.test(name)
		? true
		: "Expected operations/<slug> or queries/<name>";
};

export const CapabilityId = Schema.String.pipe(
	Schema.check(Schema.makeFilter(capabilityIdIssue)),
	Schema.brand("CapabilityId"),
);
export type CapabilityId = typeof CapabilityId.Type;

export const kernelCapabilityId = (slug: string) =>
	CapabilityId.make(`${KERNEL_CAPABILITY_OWNER}:${slug}`);
export const pluginOperationCapabilityId = (packageId: PluginPackageId, slug: string) =>
	CapabilityId.make(`${packageId}:operations/${slug}`);
export const pluginQueryCapabilityId = (packageId: PluginPackageId, query: string) =>
	CapabilityId.make(`${packageId}:queries/${query}`);
export const capabilityOwner = (id: string) => id.slice(0, id.indexOf(":"));

const CapabilitySource = Schema.Union([
	strictStruct({ kind: Schema.Literal("kernel") }),
	strictStruct({
		revisionId: Schema.String,
		contentHash: Schema.String,
		packageId: PluginPackageId,
		operationSlug: Schema.String,
		installationId: Schema.String,
		configRevisionId: Schema.String,
		kind: Schema.Literal("operation"),
	}),
	strictStruct({
		query: Schema.String,
		pluginId: Schema.String,
		revisionId: Schema.String,
		packageId: PluginPackageId,
		kind: Schema.Literal("declared-query"),
		scope: Schema.Literals(["user", "system"]),
	}),
]);

export const Capability = strictStruct({
	id: CapabilityId,
	source: CapabilitySource,
	description: Schema.String,
	hints: PluginOperationHints,
	title: Schema.NonEmptyString,
	input: PluginOperationJsonSchema,
	output: PluginOperationJsonSchema,
});
export type Capability = typeof Capability.Type;
