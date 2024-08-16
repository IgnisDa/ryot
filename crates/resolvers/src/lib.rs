use application_utils::AuthContext;
use async_graphql::{EmptySubscription, MergedObject, Schema};
use async_graphql_axum::{GraphQLRequest, GraphQLResponse};
use axum::Extension;

pub use exporter_resolver::*;
pub use file_storage_resolver::*;
pub use fitness_resolver::*;
pub use importer_resolver::*;
pub use miscellaneous_resolver::*;
pub use router_resolver::*;

#[derive(MergedObject, Default)]
pub struct QueryRoot(
    MiscellaneousQuery,
    ImporterQuery,
    ExporterQuery,
    ExerciseQuery,
    FileStorageQuery,
);

#[derive(MergedObject, Default)]
pub struct MutationRoot(
    MiscellaneousMutation,
    ImporterMutation,
    ExporterMutation,
    ExerciseMutation,
    FileStorageMutation,
);

pub type GraphqlSchema = Schema<QueryRoot, MutationRoot, EmptySubscription>;

pub async fn graphql_handler(
    schema: Extension<GraphqlSchema>,
    gql_ctx: AuthContext,
    req: GraphQLRequest,
) -> GraphQLResponse {
    schema.execute(req.into_inner().data(gql_ctx)).await.into()
}
