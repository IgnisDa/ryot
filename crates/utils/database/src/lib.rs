use std::sync::Arc;

use apalis::prelude::{MemoryStorage, MessageQueue};
use application_utils::GraphqlRepresentation;
use async_graphql::{Error, Result};
use background::{ApplicationJob, CoreApplicationJob};
use chrono::Utc;
use common_models::{
    BackendError, ChangeCollectionToEntityInput, DefaultCollection, IdAndNamedObject,
    StringIdObject,
};
use common_utils::{ryot_log, IsFeatureEnabled};
use database_models::{
    collection, collection_to_entity,
    functions::associate_user_with_entity,
    prelude::{
        Collection, CollectionToEntity, Review, User, UserMeasurement, UserToCollection, Workout,
    },
    review, user, user_measurement, user_to_collection, workout,
};
use dependent_models::UserWorkoutDetails;
use enums::{EntityLot, UserLot, Visibility};
use file_storage_service::FileStorageService;
use fitness_models::UserMeasurementsListInput;
use itertools::Itertools;
use markdown::to_html as markdown_to_html;
use media_models::{CreateOrUpdateCollectionInput, ReviewItem};
use migrations::AliasedCollectionToEntity;
use rust_decimal_macros::dec;
use sea_orm::{
    prelude::Expr,
    sea_query::{OnConflict, PgFunc},
    ActiveModelTrait, ActiveValue, ColumnTrait, DatabaseConnection, EntityTrait, Iterable,
    QueryFilter, QueryOrder, QuerySelect, QueryTrait, Select, TransactionTrait,
};
use user_models::{UserPreferences, UserReviewScale};
use uuid::Uuid;

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

pub async fn user_preferences_by_id(
    db: &DatabaseConnection,
    user_id: &String,
    config: &Arc<config::AppConfig>,
) -> Result<UserPreferences> {
    let mut preferences = user_by_id(db, user_id).await?.preferences;
    preferences.features_enabled.media.anime =
        config.anime_and_manga.is_enabled() && preferences.features_enabled.media.anime;
    preferences.features_enabled.media.audio_book =
        config.audio_books.is_enabled() && preferences.features_enabled.media.audio_book;
    preferences.features_enabled.media.book =
        config.books.is_enabled() && preferences.features_enabled.media.book;
    preferences.features_enabled.media.show =
        config.movies_and_shows.is_enabled() && preferences.features_enabled.media.show;
    preferences.features_enabled.media.manga =
        config.anime_and_manga.is_enabled() && preferences.features_enabled.media.manga;
    preferences.features_enabled.media.movie =
        config.movies_and_shows.is_enabled() && preferences.features_enabled.media.movie;
    preferences.features_enabled.media.podcast =
        config.podcasts.is_enabled() && preferences.features_enabled.media.podcast;
    preferences.features_enabled.media.video_game =
        config.video_games.is_enabled() && preferences.features_enabled.media.video_game;
    Ok(preferences)
}

pub async fn admin_account_guard(db: &DatabaseConnection, user_id: &String) -> Result<()> {
    let main_user = user_by_id(db, user_id).await?;
    if main_user.lot != UserLot::Admin {
        return Err(Error::new(BackendError::AdminOnlyAction.to_string()));
    }
    Ok(())
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

fn get_cte_column_from_lot(entity_lot: EntityLot) -> collection_to_entity::Column {
    match entity_lot {
        EntityLot::Metadata => CteColAlias::MetadataId,
        EntityLot::Person => CteColAlias::PersonId,
        EntityLot::MetadataGroup => CteColAlias::MetadataGroupId,
        EntityLot::Exercise => CteColAlias::ExerciseId,
        EntityLot::Workout => CteColAlias::WorkoutId,
        EntityLot::Collection => unreachable!(),
    }
}

pub async fn entity_in_collections_with_collection_to_entity_ids(
    db: &DatabaseConnection,
    user_id: &String,
    entity_id: &String,
    entity_lot: EntityLot,
) -> Result<Vec<(collection::Model, Uuid)>> {
    let user_collections = Collection::find()
        .left_join(UserToCollection)
        .filter(user_to_collection::Column::UserId.eq(user_id))
        .all(db)
        .await
        .unwrap();
    let column = get_cte_column_from_lot(entity_lot);
    let mtc = CollectionToEntity::find()
        .filter(
            CteColAlias::CollectionId
                .is_in(user_collections.into_iter().map(|c| c.id).collect_vec()),
        )
        .filter(column.eq(entity_id))
        .find_also_related(Collection)
        .all(db)
        .await
        .unwrap();
    let resp = mtc
        .into_iter()
        .map(|(cte, col)| (col.unwrap(), cte.id))
        .collect_vec();
    Ok(resp)
}

pub async fn entity_in_collections(
    db: &DatabaseConnection,
    user_id: &String,
    entity_id: &String,
    entity_lot: EntityLot,
) -> Result<Vec<collection::Model>> {
    let eic =
        entity_in_collections_with_collection_to_entity_ids(db, user_id, entity_id, entity_lot)
            .await?;
    Ok(eic.into_iter().map(|(c, _)| c).collect_vec())
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
                entity_in_collections(db, user_id, &workout_id, EntityLot::Workout).await?;
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
    let column = get_cte_column_from_lot(input.entity_lot);
    let resp = if let Some(etc) = CollectionToEntity::find()
        .filter(CteColAlias::CollectionId.eq(collection.id.clone()))
        .filter(column.eq(input.entity_id.clone()))
        .one(db)
        .await?
    {
        let mut to_update: collection_to_entity::ActiveModel = etc.into();
        to_update.last_updated_on = ActiveValue::Set(Utc::now());
        to_update.update(db).await?
    } else {
        let mut created_collection = collection_to_entity::ActiveModel {
            collection_id: ActiveValue::Set(collection.id),
            information: ActiveValue::Set(input.information),
            ..Default::default()
        };
        let id = input.entity_id.clone();
        match input.entity_lot {
            EntityLot::Metadata => created_collection.metadata_id = ActiveValue::Set(Some(id)),
            EntityLot::Person => created_collection.person_id = ActiveValue::Set(Some(id)),
            EntityLot::MetadataGroup => {
                created_collection.metadata_group_id = ActiveValue::Set(Some(id))
            }
            EntityLot::Exercise => created_collection.exercise_id = ActiveValue::Set(Some(id)),
            EntityLot::Workout => created_collection.workout_id = ActiveValue::Set(Some(id)),
            EntityLot::Collection => unreachable!(),
        }
        let created = created_collection.insert(db).await?;
        ryot_log!(debug, "Created collection to entity: {:?}", created);
        if input.entity_lot != EntityLot::Workout {
            associate_user_with_entity(db, user_id, input.entity_id, input.entity_lot)
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

pub async fn remove_entity_from_collection(
    db: &DatabaseConnection,
    user_id: &String,
    input: ChangeCollectionToEntityInput,
) -> Result<StringIdObject> {
    let collect = Collection::find()
        .left_join(UserToCollection)
        .filter(collection::Column::Name.eq(input.collection_name))
        .filter(user_to_collection::Column::UserId.eq(input.creator_user_id))
        .one(db)
        .await
        .unwrap()
        .unwrap();
    let column = get_cte_column_from_lot(input.entity_lot);
    CollectionToEntity::delete_many()
        .filter(collection_to_entity::Column::CollectionId.eq(collect.id.clone()))
        .filter(column.eq(input.entity_id.clone()))
        .exec(db)
        .await?;
    if input.entity_lot != EntityLot::Workout {
        associate_user_with_entity(db, user_id, input.entity_id, input.entity_lot).await?;
    }
    Ok(StringIdObject { id: collect.id })
}

pub async fn item_reviews(
    db: &DatabaseConnection,
    user_id: &String,
    entity_id: &String,
    entity_lot: EntityLot,
) -> Result<Vec<ReviewItem>> {
    let column = match entity_lot {
        EntityLot::Metadata => review::Column::MetadataId,
        EntityLot::MetadataGroup => review::Column::MetadataGroupId,
        EntityLot::Person => review::Column::PersonId,
        EntityLot::Exercise => review::Column::ExerciseId,
        EntityLot::Collection => review::Column::CollectionId,
        EntityLot::Workout => unreachable!(),
    };
    let all_reviews = Review::find()
        .filter(review::Column::UserId.eq(user_id))
        .find_also_related(User)
        .order_by_desc(review::Column::PostedOn)
        .filter(column.eq(entity_id))
        .all(db)
        .await
        .unwrap();
    let mut reviews = vec![];
    for (review, user) in all_reviews {
        let user = user.unwrap();
        let rating = match true {
            true => {
                let preferences = user_by_id(db, user_id).await?.preferences;
                review.rating.map(|s| {
                    s.checked_div(match preferences.general.review_scale {
                        UserReviewScale::OutOfFive => dec!(20),
                        UserReviewScale::OutOfHundred => dec!(1),
                    })
                    .unwrap()
                    .round_dp(1)
                })
            }
            false => review.rating,
        };
        let to_push = ReviewItem {
            rating,
            id: review.id,
            posted_on: review.posted_on,
            is_spoiler: review.is_spoiler,
            text_original: review.text.clone(),
            text_rendered: review.text.map(|t| markdown_to_html(&t)),
            visibility: review.visibility,
            show_extra_information: review.show_extra_information,
            podcast_extra_information: review.podcast_extra_information,
            anime_extra_information: review.anime_extra_information,
            manga_extra_information: review.manga_extra_information,
            posted_by: IdAndNamedObject {
                id: user.id,
                name: user.name,
            },
            comments: review.comments,
        };
        reviews.push(to_push);
    }
    let all_reviews = reviews
        .into_iter()
        .filter(|r| match r.visibility {
            Visibility::Private => &r.posted_by.id == user_id,
            _ => true,
        })
        .collect();
    Ok(all_reviews)
}

pub async fn create_or_update_collection(
    db: &DatabaseConnection,
    user_id: &String,
    input: CreateOrUpdateCollectionInput,
) -> Result<StringIdObject> {
    let txn = db.begin().await?;
    let meta = Collection::find()
        .filter(collection::Column::Name.eq(input.name.clone()))
        .filter(collection::Column::UserId.eq(user_id))
        .one(&txn)
        .await
        .unwrap();
    let mut new_name = input.name.clone();
    let created = match meta {
        Some(m) if input.update_id.is_none() => m.id,
        _ => {
            let col = collection::ActiveModel {
                id: match input.update_id {
                    Some(i) => {
                        let already = Collection::find_by_id(i.clone())
                            .one(&txn)
                            .await
                            .unwrap()
                            .unwrap();
                        if DefaultCollection::iter()
                            .map(|s| s.to_string())
                            .contains(&already.name)
                        {
                            new_name = already.name;
                        }
                        ActiveValue::Unchanged(i.clone())
                    }
                    None => ActiveValue::NotSet,
                },
                last_updated_on: ActiveValue::Set(Utc::now()),
                name: ActiveValue::Set(new_name),
                user_id: ActiveValue::Set(user_id.to_owned()),
                description: ActiveValue::Set(input.description),
                information_template: ActiveValue::Set(input.information_template),
                ..Default::default()
            };
            let inserted = col
                .save(&txn)
                .await
                .map_err(|_| Error::new("There was an error creating the collection".to_owned()))?;
            let id = inserted.id.unwrap();
            let collaborators = vec![user_id.to_owned()];
            let inserts = collaborators
                .into_iter()
                .map(|c| user_to_collection::ActiveModel {
                    user_id: ActiveValue::Set(c),
                    collection_id: ActiveValue::Set(id.clone()),
                });
            UserToCollection::insert_many(inserts)
                .on_conflict(OnConflict::new().do_nothing().to_owned())
                .exec_without_returning(&txn)
                .await?;
            id
        }
    };
    txn.commit().await?;
    Ok(StringIdObject { id: created })
}

pub async fn deploy_job_to_calculate_user_activities_and_summary(
    perform_application_job: &MemoryStorage<ApplicationJob>,
    user_id: &String,
    calculate_from_beginning: bool,
) -> Result<()> {
    perform_application_job
        .clone()
        .enqueue(ApplicationJob::RecalculateUserActivitiesAndSummary(
            user_id.to_owned(),
            calculate_from_beginning,
        ))
        .await
        .unwrap();
    Ok(())
}
