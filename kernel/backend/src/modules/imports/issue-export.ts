import { IngestionIssue } from "@ryot-app/contract/modules/imports/ingestion";
import { ImportRunFailureReason } from "@ryot-app/contract/modules/imports/schemas";
import type { ImportRunId } from "@ryot-app/contract/schema/brands";
import { encodeJsonString } from "@ryot-app/ts-utils/json";
import { Effect, Schema, Stream } from "effect";

const encodeIssue = Schema.encodeSync(Schema.fromJsonString(IngestionIssue));
const encodeFailureReason = Schema.encodeSync(
	Schema.fromJsonString(Schema.NullOr(ImportRunFailureReason)),
);

export const createIssuesExport = <E>(input: {
	readonly runId: ImportRunId;
	readonly source: string;
	readonly failureReason: ImportRunFailureReason | null;
	readonly listPage: (
		after?: string,
	) => Effect.Effect<readonly { readonly data: IngestionIssue }[], E>;
}) => {
	const encoder = new TextEncoder();
	const page = (after?: string): Stream.Stream<Uint8Array, E> =>
		Stream.fromEffect(Effect.suspend(() => input.listPage(after))).pipe(
			Stream.flatMap((items) =>
				Stream.fromIterable(
					items.map(({ data }, index) =>
						encoder.encode(`${after === undefined && index === 0 ? "" : ","}${encodeIssue(data)}`),
					),
				).pipe(
					Stream.concat(
						items.length < 100 ? Stream.empty : Stream.suspend(() => page(items.at(-1)?.data.id)),
					),
				),
			),
		);
	return {
		fileName: `ryot-import-issues-${input.runId}.json`,
		stream: Stream.succeed(
			encoder.encode(
				`{"runId":${encodeJsonString(input.runId)},"source":${encodeJsonString(input.source)},"failureReason":${encodeFailureReason(input.failureReason)},"issues":[`,
			),
		).pipe(Stream.concat(page()), Stream.concat(Stream.succeed(encoder.encode("]}")))),
	};
};
