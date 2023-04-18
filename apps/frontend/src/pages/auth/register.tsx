import { gqlClient } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";
import { BOOKS_SEARCH } from "@trackona/graphql/backend/queries";

export default function Page() {
	const booksSearch = useQuery({
		queryKey: ["booksSearch"],
		queryFn: async () => {
			const {} = await gqlClient.request(BOOKS_SEARCH);
		},
	});

	return (
		<main className="flex min-h-screen flex-col items-center justify-between p-24">
			<div className="text-4xl m-auto">Hello world from Register page!</div>
			<div>{JSON.stringify(booksSearch.data)}</div>
		</main>
	);
}
