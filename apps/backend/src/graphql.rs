use async_graphql::{EmptySubscription, MergedObject, Schema};

use crate::{
    fitness::exercise::resolver::{ExerciseMutation, ExerciseQuery},
    importer::{ImporterMutation, ImporterQuery},
    miscellaneous::resolver::{MiscellaneousMutation, MiscellaneousQuery},
};

#[derive(MergedObject, Default)]
pub struct QueryRoot(MiscellaneousQuery, ImporterQuery, ExerciseQuery);

#[derive(MergedObject, Default)]
pub struct MutationRoot(MiscellaneousMutation, ImporterMutation, ExerciseMutation);

pub type GraphqlSchema = Schema<QueryRoot, MutationRoot, EmptySubscription>;

pub async fn get_schema() -> GraphqlSchema {
    Schema::build(
        QueryRoot::default(),
        MutationRoot::default(),
        EmptySubscription,
    )
    .finish()
}
