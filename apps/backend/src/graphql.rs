use async_graphql::{extensions::Tracing, EmptySubscription, MergedObject, Schema};
use resolvers::{ExporterMutation, ExporterQuery};

use crate::{
    app_utils::AppServices,
    fitness::resolver::{ExerciseMutation, ExerciseQuery},
    importer::{ImporterMutation, ImporterQuery},
    miscellaneous::{MiscellaneousMutation, MiscellaneousQuery},
};

#[derive(MergedObject, Default)]
pub struct QueryRoot(
    MiscellaneousQuery,
    ImporterQuery,
    ExporterQuery,
    ExerciseQuery,
);

#[derive(MergedObject, Default)]
pub struct MutationRoot(
    MiscellaneousMutation,
    ImporterMutation,
    ExporterMutation,
    ExerciseMutation,
);

pub type GraphqlSchema = Schema<QueryRoot, MutationRoot, EmptySubscription>;

pub async fn get_schema(app_services: &AppServices) -> GraphqlSchema {
    Schema::build(
        QueryRoot::default(),
        MutationRoot::default(),
        EmptySubscription,
    )
    .extension(Tracing)
    .data(app_services.media_service.clone())
    .data(app_services.importer_service.clone())
    .data(app_services.exporter_service.clone())
    .data(app_services.exercise_service.clone())
    .finish()
}
