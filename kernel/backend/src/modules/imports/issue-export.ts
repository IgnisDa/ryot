import { IngestionIssue } from "@ryot-app/contract/modules/imports/ingestion";
import { ImportRunFailureReason } from "@ryot-app/contract/modules/imports/schemas";
import type { ImportRunId } from "@ryot-app/contract/schema/brands";
import { encodeJsonString } from "@ryot-app/ts-utils/json";
import { Effect, Schema, Stream } from "effect";

const encodeIssue = Schema.encodeEffect(Schema.fromJsonString(IngestionIssue));
const encodeFailureReason = Schema.encodeEffect(
	Schema.fromJsonString(Schema.NullOr(ImportRunFailureReason)),
);

export const createIssuesExport = <E>(input: {
	readonly source: string;
	readonly runId: ImportRunId;
	readonly failureReason: null | ImportRunFailureReason;
	readonly listPage: (
		after?: string,
	) => Effect.Effect<readonly { readonly data: IngestionIssue }[], E>;
}) => {
	const encoder = new TextEncoder();
	const page = (after?: string): Stream.Stream<Uint8Array, E> =>
		Stream.fromEffect(Effect.suspend(() => input.listPage(after))).pipe(
			Stream.flatMap((items) =>
				Stream.fromEffect(
					Effect.forEach(items, ({ data }, index) =>
						encodeIssue(data).pipe(
							Effect.orDie,
							Effect.map((issue) =>
								encoder.encode(`${after === undefined && index === 0 ? "" : ","}${issue}`),
							),
						),
					),
				).pipe(
					Stream.flatMap(Stream.fromIterable),
					Stream.concat(
						items.length < 100 ? Stream.empty : Stream.suspend(() => page(items.at(-1)?.data.id)),
					),
				),
			),
		);
	return {
		fileName: `ryot-import-issues-${input.runId}.json`,
		stream: Stream.fromEffect(
			encodeFailureReason(input.failureReason).pipe(
				Effect.orDie,
				Effect.map((failureReason) =>
					encoder.encode(
						`{"runId":${encodeJsonString(input.runId)},"source":${encodeJsonString(input.source)},"failureReason":${failureReason},"issues":[`,
					),
				),
			),
		).pipe(Stream.concat(page()), Stream.concat(Stream.succeed(encoder.encode("]}")))),
	};
};
