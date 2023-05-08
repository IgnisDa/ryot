import { gqlClient } from "../services/api";
import { UserDetailsDocument } from "@ryot/generated/graphql/backend/graphql";
import { useQuery } from "@tanstack/react-query";

export default function (onSuccess?: (data: any) => void) {
	const userDetails = useQuery({
		queryKey: ["userDetails"],
		queryFn: async () => {
			const { userDetails } = await gqlClient.request(UserDetailsDocument);
			return userDetails;
		},
		onSuccess,
	});
	return userDetails.data?.__typename === "User" ? userDetails.data : undefined;
}
