import { gqlClient } from "../services/api";
import { USER_DETAILS } from "@ryot/graphql/backend/queries";
import { useQuery } from "@tanstack/react-query";

export default function () {
	const userDetails = useQuery({
		queryKey: ["userDetails"],
		queryFn: async () => {
			const { userDetails } = await gqlClient.request(USER_DETAILS);
			return userDetails;
		},
		staleTime: Infinity,
	});
	return userDetails.data?.__typename === "User" ? userDetails.data : undefined;
}
