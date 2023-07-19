use async_graphql::{EmptySubscription, MergedObject, Schema, SimpleObject};
use serde::{Deserialize, Serialize};

use crate::{
    fitness::exercise::resolver::{ExerciseMutation, ExerciseQuery},
    importer::{ImporterMutation, ImporterQuery},
    miscellaneous::resolver::{MiscellaneousMutation, MiscellaneousQuery},
    utils::{AppServices, MemoryDatabase},
};

#[derive(Debug, SimpleObject, Serialize, Deserialize)]
pub struct IdObject {
    pub id: i32,
}

#[derive(MergedObject, Default)]
pub struct QueryRoot(MiscellaneousQuery, ImporterQuery, ExerciseQuery);

#[derive(MergedObject, Default)]
pub struct MutationRoot(MiscellaneousMutation, ImporterMutation, ExerciseMutation);

pub type GraphqlSchema = Schema<QueryRoot, MutationRoot, EmptySubscription>;

pub async fn get_schema(app_services: &AppServices, auth_db: MemoryDatabase) -> GraphqlSchema {
    Schema::build(
        QueryRoot::default(),
        MutationRoot::default(),
        EmptySubscription,
    )
    .data(auth_db)
    .data(app_services.media_service.clone())
    .data(app_services.importer_service.clone())
    .data(app_services.exercise_service.clone())
    .finish()
}
