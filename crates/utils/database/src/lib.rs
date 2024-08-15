use async_graphql::Result;
use database_models::{
    collection, collection_to_entity,
    prelude::{Collection, CollectionToEntity, UserMeasurement, UserToCollection},
    user_measurement, user_to_collection,
};
use fitness_models::UserMeasurementsListInput;
use itertools::Itertools;
use sea_orm::{ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter, QueryOrder, QueryTrait};

pub async fn user_measurements_list(
    db: &DatabaseConnection,
    user_id: &String,
    input: UserMeasurementsListInput,
) -> Result<Vec<user_measurement::Model>> {
    let resp = UserMeasurement::find()
        .apply_if(input.start_time, |query, v| {
            query.filter(user_measurement::Column::Timestamp.lte(v))
        })
        .apply_if(input.end_time, |query, v| {
            query.filter(user_measurement::Column::Timestamp.gte(v))
        })
        .filter(user_measurement::Column::UserId.eq(user_id))
        .order_by_asc(user_measurement::Column::Timestamp)
        .all(db)
        .await?;
    Ok(resp)
}

pub type CteColAlias = collection_to_entity::Column;

pub async fn entity_in_collections(
    db: &DatabaseConnection,
    user_id: &String,
    metadata_id: Option<String>,
    person_id: Option<String>,
    metadata_group_id: Option<String>,
    exercise_id: Option<String>,
    workout_id: Option<String>,
) -> Result<Vec<collection::Model>> {
    let user_collections = Collection::find()
        .left_join(UserToCollection)
        .filter(user_to_collection::Column::UserId.eq(user_id))
        .all(db)
        .await
        .unwrap();
    let mtc = CollectionToEntity::find()
        .filter(
            CteColAlias::CollectionId
                .is_in(user_collections.into_iter().map(|c| c.id).collect_vec()),
        )
        .filter(
            CteColAlias::MetadataId
                .eq(metadata_id)
                .or(CteColAlias::PersonId.eq(person_id))
                .or(CteColAlias::MetadataGroupId.eq(metadata_group_id))
                .or(CteColAlias::ExerciseId.eq(exercise_id))
                .or(CteColAlias::WorkoutId.eq(workout_id)),
        )
        .find_also_related(Collection)
        .all(db)
        .await
        .unwrap();
    let resp = mtc.into_iter().flat_map(|(_, b)| b).collect_vec();
    Ok(resp)
}
