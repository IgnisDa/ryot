import { TextFieldValue, rowsResultSchema } from "@ryot/contract/modules/ryotql/language";
import { EntityId } from "@ryot/contract/schema/brands";
import { strictStruct } from "@ryot/contract/schema/utils";
import {
	and,
	ascending,
	column,
	document,
	eq,
	field,
	isNotNull,
	literal,
	rows,
	table,
} from "@ryot/ryotql";
import { Result, Schema } from "effect";

const userLibraryResponse = strictStruct({
	data: strictStruct({ library: rowsResultSchema(strictStruct({ entityId: TextFieldValue })) }),
});

export const UserLibrary = strictStruct({ entityId: EntityId });
export type UserLibrary = typeof UserLibrary.Type;

export const buildUserLibraryDocument = () => {
	const library = table("entity", "library");

	return document({
		library: rows(library, {
			limit: 1,
			orderBy: [ascending(column(library, "id"))],
			fields: [field("entityId", column(library, "id"))],
			where: and(
				eq(column(library, "entitySchemaSlug"), literal("library")),
				isNotNull(column(library, "userId")),
			),
		}),
	});
};

const decodeUserLibraryResult = Schema.decodeUnknownResult(userLibraryResponse);

export const decodeUserLibraryResponse = (response: unknown) =>
	Result.flatMap(decodeUserLibraryResult(response), ({ data }) => {
		const row = data.library.items[0];
		return row
			? Result.succeed({ entityId: EntityId.make(row.entityId.value) } satisfies UserLibrary)
			: Result.fail(new Error("User library entity not found"));
	});
