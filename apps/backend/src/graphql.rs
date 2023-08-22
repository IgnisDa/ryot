use async_graphql::{EmptySubscription, MergedObject, Schema};

use crate::{
    fitness::exercise::resolver::{ExerciseMutation, ExerciseQuery},
    importer::{ImporterMutation, ImporterQuery},
    miscellaneous::resolver::{MiscellaneousMutation, MiscellaneousQuery},
    users::resolver::{UsersMutation, UsersQuery},
    utils::AppServices,
};

#[derive(MergedObject, Default)]
pub struct QueryRoot(MiscellaneousQuery, ImporterQuery, ExerciseQuery, UsersQuery);

#[derive(MergedObject, Default)]
pub struct MutationRoot(
    MiscellaneousMutation,
    ImporterMutation,
    ExerciseMutation,
    UsersMutation,
);

pub type GraphqlSchema = Schema<QueryRoot, MutationRoot, EmptySubscription>;

pub async fn get_schema(app_services: &AppServices) -> GraphqlSchema {
    Schema::build(
        QueryRoot::default(),
        MutationRoot::default(),
        EmptySubscription,
    )
    .data(app_services.media_service.clone())
    .data(app_services.importer_service.clone())
    .data(app_services.exercise_service.clone())
    .data(app_services.users_service.clone())
    .finish()
}
