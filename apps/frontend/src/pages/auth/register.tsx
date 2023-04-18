import { gqlClient } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";
import { BOOKS_SEARCH } from "@trackona/graphql/backend/queries";

export default function Page() {
	const booksSearch = useQuery({
		queryKey: ["booksSearch"],
		queryFn: async () => {
			const { booksSearch } = await gqlClient.request(BOOKS_SEARCH, {
				query: "Throne of Glass",
			});
			return booksSearch;
		},
	});

	return (
		<main>
			<div>Hello world from Register page!</div>
			<div>{JSON.stringify(booksSearch.data)}</div>
		</main>
	);
}
