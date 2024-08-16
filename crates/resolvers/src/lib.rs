use async_graphql::{EmptySubscription, MergedObject, Schema};

pub use exporter_resolver::*;
pub use file_storage_resolver::*;
pub use fitness_resolver::*;
pub use importer_resolver::*;
pub use miscellaneous_resolver::*;

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
