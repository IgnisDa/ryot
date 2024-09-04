use std::{
    collections::{HashMap, HashSet},
    sync::Arc,
};

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
    access_link, collection, collection_to_entity, daily_user_activity,
    functions::associate_user_with_entity,
    metadata,
    prelude::{
        AccessLink, Collection, CollectionToEntity, DailyUserActivity, Metadata, Review, Seen,
        User, UserMeasurement, UserToEntity, Workout,
    },
    review, seen, user, user_measurement, user_to_entity, workout,
};
use dependent_models::UserWorkoutDetails;
use enums::{EntityLot, MediaLot, SeenState, UserLot, Visibility};
use file_storage_service::FileStorageService;
use fitness_models::UserMeasurementsListInput;
use futures::TryStreamExt;
use itertools::Itertools;
use jwt_service::{verify, Claims};
use markdown::to_html as markdown_to_html;
use media_models::{
    AnimeSpecifics, AudioBookSpecifics, BookSpecifics, CreateOrUpdateCollectionInput,
    MangaSpecifics, MovieSpecifics, PodcastSpecifics, ReviewItem, SeenAnimeExtraInformation,
    SeenMangaExtraInformation, SeenPodcastExtraInformation, SeenShowExtraInformation,
    ShowSpecifics, VideoGameSpecifics, VisualNovelSpecifics,
};
use migrations::AliasedCollectionToEntity;
use rust_decimal::prelude::ToPrimitive;
use rust_decimal_macros::dec;
use sea_orm::{
    prelude::{Date, DateTimeUtc, Expr},
    sea_query::{OnConflict, PgFunc},
    ActiveModelTrait, ActiveValue, ColumnTrait, DatabaseConnection, EntityTrait, FromQueryResult,
    Iterable, ModelTrait, QueryFilter, QueryOrder, QuerySelect, QueryTrait, Select,
    TransactionTrait,
};
use serde::{Deserialize, Serialize};
use user_models::{UserPreferences, UserReviewScale};
use uuid::Uuid;

pub async fn revoke_access_link(db: &DatabaseConnection, access_link_id: String) -> Result<bool> {
    AccessLink::update(access_link::ActiveModel {
        id: ActiveValue::Set(access_link_id),
        is_revoked: ActiveValue::Set(Some(true)),
        ..Default::default()
    })
    .exec(db)
    .await?;
    Ok(true)
}

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
        EntityLot::WorkoutTemplate => CteColAlias::WorkoutTemplateId,
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
        .left_join(UserToEntity)
        .filter(user_to_entity::Column::UserId.eq(user_id))
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
        .left_join(UserToEntity)
        .filter(user_to_entity::Column::UserId.eq(user_id))
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
            EntityLot::WorkoutTemplate => {
                created_collection.workout_template_id = ActiveValue::Set(Some(id))
            }
            EntityLot::Collection => unreachable!(),
        }
        let created = created_collection.insert(db).await?;
        ryot_log!(debug, "Created collection to entity: {:?}", created);
        if input.entity_lot != EntityLot::Workout && input.entity_lot != EntityLot::WorkoutTemplate
        {
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

pub fn user_claims_from_token(token: &str, jwt_secret: &str) -> Result<Claims> {
    verify(token, jwt_secret).map_err(|e| Error::new(format!("Encountered error: {:?}", e)))
}

/// If the token has an access link, then checks that:
/// - the access link is not revoked
/// - if the operation is a mutation, then the access link allows mutations
///
/// If any of the above conditions are not met, then an error is returned.
#[inline]
pub async fn check_token(
    token: &str,
    is_mutation: bool,
    jwt_secret: &str,
    db: &DatabaseConnection,
) -> Result<bool> {
    let claims = user_claims_from_token(token, jwt_secret)?;
    if let Some(access_link) = claims.access_link {
        let access_link = AccessLink::find_by_id(access_link.id)
            .one(db)
            .await?
            .ok_or_else(|| Error::new(BackendError::SessionExpired.to_string()))?;
        if access_link.is_revoked.unwrap_or_default() {
            return Err(Error::new(BackendError::SessionExpired.to_string()));
        }
        if is_mutation {
            if !access_link.is_mutation_allowed.unwrap_or_default() {
                return Err(Error::new(BackendError::MutationNotAllowed.to_string()));
            }
            return Ok(true);
        }
        Ok(true)
    } else {
        Ok(true)
    }
}

pub async fn remove_entity_from_collection(
    db: &DatabaseConnection,
    user_id: &String,
    input: ChangeCollectionToEntityInput,
) -> Result<StringIdObject> {
    let collect = Collection::find()
        .left_join(UserToEntity)
        .filter(collection::Column::Name.eq(input.collection_name))
        .filter(user_to_entity::Column::UserId.eq(input.creator_user_id))
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
    if input.entity_lot != EntityLot::Workout && input.entity_lot != EntityLot::WorkoutTemplate {
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
        EntityLot::Workout | EntityLot::WorkoutTemplate => unreachable!(),
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
            let mut collaborators = vec![user_id.to_owned()];
            if let Some(input_collaborators) = input.collaborators {
                collaborators.extend(input_collaborators);
            }
            let inserts = collaborators
                .into_iter()
                .map(|c| user_to_entity::ActiveModel {
                    user_id: ActiveValue::Set(c),
                    collection_id: ActiveValue::Set(Some(id.clone())),
                    ..Default::default()
                });
            UserToEntity::insert_many(inserts)
                .on_conflict(OnConflict::new().do_nothing().to_owned())
                .exec_without_returning(&txn)
                .await?;
            id
        }
    };
    txn.commit().await?;
    Ok(StringIdObject { id: created })
}

pub async fn calculate_user_activities_and_summary(
    db: &DatabaseConnection,
    user_id: &String,
    calculate_from_beginning: bool,
) -> Result<()> {
    #[derive(Debug, Serialize, Deserialize, Clone, FromQueryResult)]
    struct SeenItem {
        seen_id: String,
        show_extra_information: Option<SeenShowExtraInformation>,
        podcast_extra_information: Option<SeenPodcastExtraInformation>,
        anime_extra_information: Option<SeenAnimeExtraInformation>,
        manga_extra_information: Option<SeenMangaExtraInformation>,
        metadata_id: String,
        finished_on: Option<Date>,
        last_updated_on: DateTimeUtc,
        metadata_lot: MediaLot,
        audio_book_specifics: Option<AudioBookSpecifics>,
        book_specifics: Option<BookSpecifics>,
        movie_specifics: Option<MovieSpecifics>,
        podcast_specifics: Option<PodcastSpecifics>,
        show_specifics: Option<ShowSpecifics>,
        video_game_specifics: Option<VideoGameSpecifics>,
        visual_novel_specifics: Option<VisualNovelSpecifics>,
        anime_specifics: Option<AnimeSpecifics>,
        manga_specifics: Option<MangaSpecifics>,
    }
    struct TrackerItem {
        activity: daily_user_activity::Model,
        shows: HashSet<String>,
        show_seasons: HashSet<i32>,
        anime_episodes: HashSet<i32>,
        manga_chapters: HashSet<i32>,
        manga_volumes: HashSet<i32>,
    }
    type Tracker = HashMap<Date, TrackerItem>;

    let start_from = match calculate_from_beginning {
        true => {
            DailyUserActivity::delete_many()
                .filter(daily_user_activity::Column::UserId.eq(user_id))
                .exec(db)
                .await?;
            Date::default()
        }
        false => DailyUserActivity::find()
            .filter(daily_user_activity::Column::UserId.eq(user_id))
            .order_by_desc(daily_user_activity::Column::Date)
            .one(db)
            .await?
            .map(|i| i.date)
            .unwrap_or_default(),
    };
    let mut activities: Tracker = HashMap::new();

    fn get_activity_count<'a>(
        entity_id: String,
        activities: &'a mut Tracker,
        user_id: &'a String,
        date: Date,
    ) -> &'a mut TrackerItem {
        ryot_log!(debug, "Updating activity counts for id: {:?}", entity_id);
        let existing = activities.entry(date).or_insert(TrackerItem {
            activity: daily_user_activity::Model {
                date,
                user_id: user_id.to_owned(),
                ..Default::default()
            },
            shows: HashSet::new(),
            show_seasons: HashSet::new(),
            anime_episodes: HashSet::new(),
            manga_chapters: HashSet::new(),
            manga_volumes: HashSet::new(),
        });
        existing
    }
    let mut seen_stream = Seen::find()
        .filter(seen::Column::UserId.eq(user_id))
        .filter(seen::Column::State.eq(SeenState::Completed))
        .filter(seen::Column::LastUpdatedOn.gt(start_from))
        .left_join(Metadata)
        .select_only()
        .column_as(seen::Column::Id, "seen_id")
        .columns([
            seen::Column::ShowExtraInformation,
            seen::Column::PodcastExtraInformation,
            seen::Column::AnimeExtraInformation,
            seen::Column::MangaExtraInformation,
            seen::Column::MetadataId,
            seen::Column::FinishedOn,
            seen::Column::LastUpdatedOn,
        ])
        .column_as(metadata::Column::Lot, "metadata_lot")
        .columns([
            metadata::Column::AudioBookSpecifics,
            metadata::Column::BookSpecifics,
            metadata::Column::MovieSpecifics,
            metadata::Column::PodcastSpecifics,
            metadata::Column::ShowSpecifics,
            metadata::Column::VideoGameSpecifics,
            metadata::Column::VisualNovelSpecifics,
            metadata::Column::AnimeSpecifics,
            metadata::Column::MangaSpecifics,
        ])
        .into_model::<SeenItem>()
        .stream(db)
        .await?;

    while let Some(seen) = seen_stream.try_next().await? {
        let default_date = Date::from_ymd_opt(2023, 4, 3).unwrap(); // DEV: The first commit of Ryot
        let date = seen.finished_on.unwrap_or(default_date);
        let TrackerItem {
            activity,
            shows,
            show_seasons,
            anime_episodes,
            manga_chapters,
            manga_volumes,
        } = get_activity_count(seen.seen_id, &mut activities, user_id, date);
        if let (Some(show_seen), Some(show_extra)) =
            (seen.show_specifics, seen.show_extra_information)
        {
            shows.insert(seen.metadata_id.clone());
            show_seasons.insert(show_extra.season);
            if let Some(runtime) = show_seen
                .get_episode(show_extra.season, show_extra.episode)
                .and_then(|(_, e)| e.runtime)
            {
                activity.show_duration += runtime;
            }
        } else if let (Some(podcast_seen), Some(podcast_extra)) =
            (seen.podcast_specifics, seen.podcast_extra_information)
        {
            if let Some(runtime) = podcast_seen
                .episode_by_number(podcast_extra.episode)
                .and_then(|e| e.runtime)
            {
                activity.podcast_duration += runtime;
            }
        } else if let (Some(_), Some(anime_extra)) =
            (seen.anime_specifics, seen.anime_extra_information)
        {
            if let Some(episode) = anime_extra.episode {
                anime_episodes.insert(episode);
            }
        } else if let (Some(_), Some(manga_extra)) =
            (seen.manga_specifics, seen.manga_extra_information)
        {
            if let Some(chapter) = manga_extra.chapter {
                manga_chapters.insert(chapter);
            }
            if let Some(volume) = manga_extra.volume {
                manga_volumes.insert(volume);
            }
        } else if let Some(audio_book_extra) = seen.audio_book_specifics {
            if let Some(runtime) = audio_book_extra.runtime {
                activity.audio_book_duration += runtime;
            }
        } else if let Some(movie_extra) = seen.movie_specifics {
            if let Some(runtime) = movie_extra.runtime {
                activity.movie_duration += runtime;
            }
        } else if let Some(book_extra) = seen.book_specifics {
            if let Some(pages) = book_extra.pages {
                activity.book_pages += pages;
            }
        } else if let Some(visual_novel_extra) = seen.visual_novel_specifics {
            if let Some(runtime) = visual_novel_extra.length {
                activity.visual_novel_duration += runtime;
            }
        }
        match seen.metadata_lot {
            MediaLot::Anime => activity.anime_count += 1,
            MediaLot::Manga => activity.manga_count += 1,
            MediaLot::Podcast => activity.podcast_count += 1,
            MediaLot::Show => activity.show_episode_count += 1,
            MediaLot::VideoGame => activity.video_game_count += 1,
            MediaLot::VisualNovel => activity.visual_novel_count += 1,
            MediaLot::Book => activity.book_count += 1,
            MediaLot::AudioBook => activity.audio_book_count += 1,
            MediaLot::Movie => activity.movie_count += 1,
        };
    }

    let mut workout_stream = Workout::find()
        .filter(workout::Column::UserId.eq(user_id))
        .filter(workout::Column::EndTime.gte(start_from))
        .stream(db)
        .await?;
    while let Some(item) = workout_stream.try_next().await? {
        let date = item.end_time.date_naive();
        let TrackerItem { activity, .. } =
            get_activity_count(item.id, &mut activities, user_id, date);
        activity.workout_count += 1;
        activity.workout_duration += item.duration / 60;
        let workout_total = item.summary.total.unwrap();
        activity.workout_personal_bests += workout_total.personal_bests_achieved as i32;
        activity.workout_weight += workout_total.weight.to_i32().unwrap_or_default();
        activity.workout_reps += workout_total.reps.to_i32().unwrap_or_default();
        activity.workout_distance += workout_total.distance.to_i32().unwrap_or_default();
        activity.workout_rest_time += workout_total.rest_time as i32;
    }

    let mut measurement_stream = UserMeasurement::find()
        .filter(user_measurement::Column::UserId.eq(user_id))
        .filter(user_measurement::Column::Timestamp.gte(start_from))
        .stream(db)
        .await?;
    while let Some(item) = measurement_stream.try_next().await? {
        let date = item.timestamp.date_naive();
        let TrackerItem { activity, .. } =
            get_activity_count(item.timestamp.to_string(), &mut activities, user_id, date);
        activity.measurement_count += 1;
    }

    let mut review_stream = Review::find()
        .filter(review::Column::UserId.eq(user_id))
        .filter(review::Column::PostedOn.gte(start_from))
        .stream(db)
        .await?;
    while let Some(item) = review_stream.try_next().await? {
        let date = item.posted_on.date_naive();
        let TrackerItem { activity, .. } =
            get_activity_count(item.id, &mut activities, user_id, date);
        match item.entity_lot {
            EntityLot::Metadata => activity.metadata_review_count += 1,
            EntityLot::Person => activity.person_review_count += 1,
            EntityLot::MetadataGroup => activity.metadata_group_review_count += 1,
            EntityLot::Collection => activity.collection_review_count += 1,
            EntityLot::Exercise => activity.exercise_review_count += 1,
            _ => {}
        }
    }

    for (_, track_item) in activities {
        let TrackerItem { activity, .. } = track_item;
        if let Some(entity) = DailyUserActivity::find()
            .filter(daily_user_activity::Column::Date.eq(activity.date))
            .filter(daily_user_activity::Column::UserId.eq(user_id))
            .one(db)
            .await?
        {
            entity.delete(db).await?;
        }
        let total_review_count = activity.metadata_review_count
            + activity.collection_review_count
            + activity.metadata_group_review_count
            + activity.person_review_count
            + activity.exercise_review_count;
        let total_metadata_count = activity.movie_count
            + activity.show_count
            + activity.podcast_count
            + activity.anime_count
            + activity.manga_count
            + activity.audio_book_count
            + activity.book_count
            + activity.video_game_count
            + activity.visual_novel_count;
        let total_count =
            total_metadata_count + activity.measurement_count + activity.workout_count;
        let total_duration = activity.workout_duration
            + activity.audio_book_duration
            + activity.podcast_duration
            + activity.movie_duration
            + activity.show_duration;
        let total_anime_episodes = track_item.anime_episodes.len().try_into().unwrap();
        let total_manga_chapters = track_item.manga_chapters.len().try_into().unwrap();
        let total_manga_volumes = track_item.manga_volumes.len().try_into().unwrap();
        let total_shows = track_item.shows.len().try_into().unwrap();
        let total_show_seasons = track_item.show_seasons.len().try_into().unwrap();
        let mut model: daily_user_activity::ActiveModel = activity.into();
        model.anime_episode_count = ActiveValue::Set(total_anime_episodes);
        model.manga_chapter_count = ActiveValue::Set(total_manga_chapters);
        model.manga_volume_count = ActiveValue::Set(total_manga_volumes);
        model.show_count = ActiveValue::Set(total_shows);
        model.show_season_count = ActiveValue::Set(total_show_seasons);
        model.total_review_count = ActiveValue::Set(total_review_count);
        model.total_metadata_count = ActiveValue::Set(total_metadata_count);
        model.total_count = ActiveValue::Set(total_count);
        model.total_duration = ActiveValue::Set(total_duration);
        model.insert(db).await.ok();
    }

    Ok(())
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
