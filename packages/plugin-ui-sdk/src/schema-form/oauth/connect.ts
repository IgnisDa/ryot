import type { Text } from "@ryot-app/i18n/text";

export type SchemaOAuthConnect = (request: {
	readonly field: string;
	readonly provider: string;
	readonly signal: AbortSignal;
}) => Promise<SchemaOAuthConnectOutcome>;

export type SchemaOAuthConnectOutcome =
	| { readonly kind: "cancelled" }
	| { readonly message: Text; readonly kind: "failed" }
	| { readonly kind: "connected"; readonly connectionId: string };
