export type SchemaOAuthConnectOutcome =
	| { readonly kind: "cancelled" }
	| { readonly kind: "failed"; readonly message: string }
	| { readonly kind: "connected"; readonly connectionId: string };

export type SchemaOAuthConnect = (request: {
	readonly field: string;
	readonly provider: string;
	readonly signal: AbortSignal;
}) => Promise<SchemaOAuthConnectOutcome>;
