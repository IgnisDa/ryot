use std::{collections::HashMap, sync::Arc};

use apalis::prelude::{MemoryStorage, MessageQueue};
use application_utils::GraphqlRepresentation;
use async_graphql::{Error, Result};
use background::CoreApplicationJob;
use chrono::Utc;
use common_models::{ChangeCollectionToEntityInput, IdAndNamedObject};
use database_models::{
    collection, collection_to_entity, daily_user_activity,
    functions::associate_user_with_entity,
    prelude::{
        Collection, CollectionToEntity, Review, User, UserMeasurement, UserToCollection, Workout,
    },
    user, user_measurement, user_to_collection, workout,
};
use dependent_models::UserWorkoutDetails;
use file_storage_service::FileStorageService;
use fitness_models::UserMeasurementsListInput;
use itertools::Itertools;
use markdown::to_html as markdown_to_html;
use media_models::{
    DailyUserActivityHourCount, DailyUserActivityMetadataCount, ImportOrExportItemRating,
    ImportOrExportItemReview, ReviewItem,
};
use migrations::AliasedCollectionToEntity;
use rust_decimal_macros::dec;
use sea_orm::{
    prelude::Expr, sea_query::PgFunc, ActiveModelTrait, ActiveValue, ColumnTrait,
    DatabaseConnection, EntityTrait, ModelTrait, QueryFilter, QueryOrder, QuerySelect, QueryTrait,
    Select,
};
use user_models::UserReviewScale;

pub fn ilike_sql(value: &str) -> String {
    format!("%{value}%")
}

pub async fn user_by_id(db: &DatabaseConnection, user_id: &String) -> Result<user::Model> {
    User::find_by_id(user_id)
        .one(db)
        .await
        .unwrap()
        .ok_or_else(|| Error::new("No user found"))
}

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

type CteColAlias = collection_to_entity::Column;

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

pub fn get_review_export_item(rev: ReviewItem) -> ImportOrExportItemRating {
    let (show_season_number, show_episode_number) = match rev.show_extra_information {
        Some(d) => (Some(d.season), Some(d.episode)),
        None => (None, None),
    };
    let podcast_episode_number = rev.podcast_extra_information.map(|d| d.episode);
    let anime_episode_number = rev.anime_extra_information.and_then(|d| d.episode);
    let manga_chapter_number = rev.manga_extra_information.and_then(|d| d.chapter);
    ImportOrExportItemRating {
        review: Some(ImportOrExportItemReview {
            visibility: Some(rev.visibility),
            date: Some(rev.posted_on),
            spoiler: Some(rev.is_spoiler),
            text: rev.text_original,
        }),
        rating: rev.rating,
        show_season_number,
        show_episode_number,
        podcast_episode_number,
        anime_episode_number,
        manga_chapter_number,
        comments: match rev.comments.is_empty() {
            true => None,
            false => Some(rev.comments),
        },
    }
}

pub async fn review_by_id(
    db: &DatabaseConnection,
    review_id: String,
    user_id: &String,
    respect_preferences: bool,
) -> Result<ReviewItem> {
    let review = Review::find_by_id(review_id).one(db).await?;
    match review {
        Some(r) => {
            let user = r.find_related(User).one(db).await.unwrap().unwrap();
            let rating = match respect_preferences {
                true => {
                    let preferences = user_by_id(db, user_id).await?.preferences;
                    r.rating.map(|s| {
                        s.checked_div(match preferences.general.review_scale {
                            UserReviewScale::OutOfFive => dec!(20),
                            UserReviewScale::OutOfHundred => dec!(1),
                        })
                        .unwrap()
                        .round_dp(1)
                    })
                }
                false => r.rating,
            };
            Ok(ReviewItem {
                id: r.id,
                posted_on: r.posted_on,
                rating,
                is_spoiler: r.is_spoiler,
                text_original: r.text.clone(),
                text_rendered: r.text.map(|t| markdown_to_html(&t)),
                visibility: r.visibility,
                show_extra_information: r.show_extra_information,
                podcast_extra_information: r.podcast_extra_information,
                anime_extra_information: r.anime_extra_information,
                manga_extra_information: r.manga_extra_information,
                posted_by: IdAndNamedObject {
                    id: user.id,
                    name: user.name,
                },
                comments: r.comments,
            })
        }
        None => Err(Error::new("Unable to find review".to_owned())),
    }
}

pub async fn workout_details(
    db: &DatabaseConnection,
    file_storage_service: &Arc<FileStorageService>,
    user_id: &String,
    workout_id: String,
) -> Result<UserWorkoutDetails> {
    let maybe_workout = Workout::find_by_id(workout_id.clone())
        .filter(workout::Column::UserId.eq(user_id))
        .one(db)
        .await?;
    match maybe_workout {
        None => Err(Error::new(
            "Workout with the given ID could not be found for this user.",
        )),
        Some(e) => {
            let collections =
                entity_in_collections(db, user_id, None, None, None, None, Some(workout_id))
                    .await?;
            let details = e.graphql_representation(file_storage_service).await?;
            Ok(UserWorkoutDetails {
                details,
                collections,
            })
        }
    }
}

pub fn apply_collection_filter<E, C, D>(
    query: Select<E>,
    collection_id: Option<Vec<String>>,
    invert_collection: Option<bool>,
    entity_column: C,
    id_column: D,
) -> Select<E>
where
    E: EntityTrait,
    C: ColumnTrait,
    D: ColumnTrait,
{
    query.apply_if(collection_id, |query, v| {
        let unique_collections = v.into_iter().unique().collect_vec();
        let count = unique_collections.len() as i32;
        let subquery = CollectionToEntity::find()
            .select_only()
            .column(id_column)
            .filter(
                Expr::col((
                    AliasedCollectionToEntity::Table,
                    collection_to_entity::Column::CollectionId,
                ))
                .eq(PgFunc::any(unique_collections)),
            )
            .filter(id_column.is_not_null())
            .group_by(id_column)
            .having(
                collection_to_entity::Column::CollectionId
                    .count()
                    .eq(Expr::val(count)),
            )
            .into_query();
        if invert_collection.unwrap_or_default() {
            query.filter(entity_column.not_in_subquery(subquery))
        } else {
            query.filter(entity_column.in_subquery(subquery))
        }
    })
}

pub async fn add_entity_to_collection(
    db: &DatabaseConnection,
    user_id: &String,
    input: ChangeCollectionToEntityInput,
    perform_core_application_job: &MemoryStorage<CoreApplicationJob>,
) -> Result<bool> {
    let collection = Collection::find()
        .left_join(UserToCollection)
        .filter(user_to_collection::Column::UserId.eq(user_id))
        .filter(collection::Column::Name.eq(input.collection_name))
        .one(db)
        .await
        .unwrap()
        .unwrap();
    let mut updated: collection::ActiveModel = collection.into();
    updated.last_updated_on = ActiveValue::Set(Utc::now());
    let collection = updated.update(db).await.unwrap();
    let resp = if let Some(etc) = CollectionToEntity::find()
        .filter(CteColAlias::CollectionId.eq(collection.id.clone()))
        .filter(
            CteColAlias::MetadataId
                .eq(input.metadata_id.clone())
                .or(CteColAlias::PersonId.eq(input.person_id.clone()))
                .or(CteColAlias::MetadataGroupId.eq(input.metadata_group_id.clone()))
                .or(CteColAlias::ExerciseId.eq(input.exercise_id.clone()))
                .or(CteColAlias::WorkoutId.eq(input.workout_id.clone())),
        )
        .one(db)
        .await?
    {
        let mut to_update: collection_to_entity::ActiveModel = etc.into();
        to_update.last_updated_on = ActiveValue::Set(Utc::now());
        to_update.update(db).await?
    } else {
        let created_collection = collection_to_entity::ActiveModel {
            collection_id: ActiveValue::Set(collection.id),
            information: ActiveValue::Set(input.information),
            person_id: ActiveValue::Set(input.person_id.clone()),
            workout_id: ActiveValue::Set(input.workout_id.clone()),
            metadata_id: ActiveValue::Set(input.metadata_id.clone()),
            exercise_id: ActiveValue::Set(input.exercise_id.clone()),
            metadata_group_id: ActiveValue::Set(input.metadata_group_id.clone()),
            ..Default::default()
        };
        let created = created_collection.insert(db).await?;
        tracing::debug!("Created collection to entity: {:?}", created);
        if input.workout_id.is_none() {
            associate_user_with_entity(
                user_id,
                input.metadata_id,
                input.person_id,
                input.exercise_id,
                input.metadata_group_id,
                db,
            )
            .await
            .ok();
        }
        created
    };
    perform_core_application_job
        .enqueue(CoreApplicationJob::EntityAddedToCollection(
            user_id.to_owned(),
            resp.id,
        ))
        .await
        .unwrap();
    Ok(true)
}

pub fn consolidate_activities(
    inputs: Vec<daily_user_activity::Model>,
) -> daily_user_activity::Model {
    let mut total_counts = 0;
    let mut review_counts = 0;
    let mut workout_counts = 0;
    let mut measurement_counts = 0;
    let mut new_hour_counts = HashMap::new();
    let mut new_metadata_counts = HashMap::new();
    for item in inputs.iter() {
        total_counts += item.total_counts;
        review_counts += item.review_counts;
        workout_counts += item.workout_counts;
        measurement_counts += item.measurement_counts;
        for hc in item.hour_counts.iter() {
            let key = hc.hour;
            let existing = new_hour_counts.entry(key).or_insert(0);
            *existing += hc.count;
        }
        for mc in item.metadata_counts.iter() {
            let key = mc.lot;
            let existing = new_metadata_counts.entry(key).or_insert(0);
            *existing += mc.count;
        }
    }
    let hour_counts = new_hour_counts
        .into_iter()
        .map(|(k, v)| DailyUserActivityHourCount { hour: k, count: v })
        .collect();
    let metadata_counts = new_metadata_counts
        .into_iter()
        .map(|(k, v)| DailyUserActivityMetadataCount { lot: k, count: v })
        .collect();
    daily_user_activity::Model {
        hour_counts,
        total_counts,
        review_counts,
        workout_counts,
        metadata_counts,
        measurement_counts,
        date: inputs[0].date,
        user_id: inputs[0].user_id.clone(),
    }
}
