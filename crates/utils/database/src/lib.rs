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
use enums::{UserLot, Visibility};
use file_storage_service::FileStorageService;
use fitness_models::UserMeasurementsListInput;
use itertools::Itertools;
use markdown::to_html as markdown_to_html;
use media_models::{
    CreateOrUpdateCollectionInput, ImportOrExportItemRating, ImportOrExportItemReview, ReviewItem,
};
use migrations::AliasedCollectionToEntity;
use rust_decimal_macros::dec;
use sea_orm::{
    prelude::Expr,
    sea_query::{OnConflict, PgFunc},
    ActiveModelTrait, ActiveValue, ColumnTrait, DatabaseConnection, EntityTrait, Iterable,
    ModelTrait, QueryFilter, QueryOrder, QuerySelect, QueryTrait, Select, TransactionTrait,
};
use user_models::{UserPreferences, UserReviewScale};

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
        ryot_log!(debug, "Created collection to entity: {:?}", created);
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
    CollectionToEntity::delete_many()
        .filter(collection_to_entity::Column::CollectionId.eq(collect.id.clone()))
        .filter(
            collection_to_entity::Column::MetadataId
                .eq(input.metadata_id.clone())
                .or(collection_to_entity::Column::PersonId.eq(input.person_id.clone()))
                .or(collection_to_entity::Column::MetadataGroupId
                    .eq(input.metadata_group_id.clone()))
                .or(collection_to_entity::Column::ExerciseId.eq(input.exercise_id.clone()))
                .or(collection_to_entity::Column::WorkoutId.eq(input.workout_id.clone())),
        )
        .exec(db)
        .await?;
    if input.workout_id.is_none() {
        associate_user_with_entity(
            user_id,
            input.metadata_id,
            input.person_id,
            input.exercise_id,
            input.metadata_group_id,
            db,
        )
        .await?;
    }
    Ok(StringIdObject { id: collect.id })
}

pub async fn item_reviews(
    db: &DatabaseConnection,
    user_id: &String,
    metadata_id: Option<String>,
    person_id: Option<String>,
    metadata_group_id: Option<String>,
    collection_id: Option<String>,
) -> Result<Vec<ReviewItem>> {
    let all_reviews = Review::find()
        .select_only()
        .column(review::Column::Id)
        .order_by_desc(review::Column::PostedOn)
        .apply_if(metadata_id, |query, v| {
            query.filter(review::Column::MetadataId.eq(v))
        })
        .apply_if(metadata_group_id, |query, v| {
            query.filter(review::Column::MetadataGroupId.eq(v))
        })
        .apply_if(person_id, |query, v| {
            query.filter(review::Column::PersonId.eq(v))
        })
        .apply_if(collection_id, |query, v| {
            query.filter(review::Column::CollectionId.eq(v))
        })
        .into_tuple::<String>()
        .all(db)
        .await
        .unwrap();
    let mut reviews = vec![];
    for r_id in all_reviews {
        reviews.push(review_by_id(db, r_id, user_id, true).await?);
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
