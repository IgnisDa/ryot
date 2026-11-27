import { KERNEL_NAMESPACE, Message, MessageKey, stampNamespace } from "@ryot-app/i18n/message";
import { Schema } from "effect";

import { type AppSchema, appSchemaCodec, mapAppSchemaText } from "../../schema/property-schema";
import { strictStruct } from "../../schema/utils";

/**
 * Manifest display text: a key without arguments in the declaring catalog. The kernel stamps the
 * owner's namespace wherever it stores or serves the text.
 */
export const ManifestText = strictStruct({ key: MessageKey });
export type ManifestText = typeof ManifestText.Type;

const KernelMessage = Message.check(
	Schema.makeFilter(
		(message) => message.namespace === KERNEL_NAMESPACE || "Expected a kernel message",
	),
);

/**
 * Manifest AppSchema display text: manifest text, or a kernel message carried by kernel-provided
 * schema building blocks such as review fields.
 */
export const AuthoredSchemaText = Schema.Union([ManifestText, KernelMessage]);
export type AuthoredSchemaText = typeof AuthoredSchemaText.Type;

export const AuthoredAppSchema = appSchemaCodec(AuthoredSchemaText);
export type AuthoredAppSchema = AppSchema<AuthoredSchemaText>;

/** Stamps a manifest AppSchema's manifest text with its owner's namespace. */
export const stampAppSchema = (namespace: string, schema: AuthoredAppSchema): AppSchema =>
	mapAppSchemaText(schema, (text) =>
		"namespace" in text ? text : stampNamespace(namespace, text),
	);
