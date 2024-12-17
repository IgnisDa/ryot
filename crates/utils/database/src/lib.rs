use std::{collections::HashMap, sync::Arc};

use application_utils::{
    get_podcast_episode_by_number, get_show_episode_by_numbers, GraphqlRepresentation,
};
use async_graphql::{Error, Result};
use background::ApplicationJob;
use chrono::{Timelike, Utc};
use common_models::{
    BackendError, ChangeCollectionToEntityInput, DailyUserActivityHourRecord,
    DailyUserActivityHourRecordEntity, DefaultCollection, IdAndNamedObject, StringIdObject,
};
use common_utils::ryot_log;
use database_models::{
    access_link, collection, collection_to_entity, daily_user_activity,
    functions::associate_user_with_entity,
    metadata,
    prelude::{
        AccessLink, Collection, CollectionToEntity, DailyUserActivity, Exercise, Metadata, Review,
        Seen, User, UserMeasurement, UserToEntity, Workout, WorkoutTemplate,
    },
    review, seen, user, user_measurement, user_to_entity, workout,
};
use dependent_models::{UserWorkoutDetails, UserWorkoutTemplateDetails};
use enums::{EntityLot, MediaLot, SeenState, UserLot, Visibility};
use fitness_models::UserMeasurementsListInput;
use futures::TryStreamExt;
use itertools::Itertools;
use jwt_service::{verify, Claims};
use markdown::to_html as markdown_to_html;
use media_models::{
    AnimeSpecifics, AudioBookSpecifics, BookSpecifics, CreateOrUpdateCollectionInput,
    MangaSpecifics, MovieSpecifics, MusicSpecifics, PodcastSpecifics, ReviewItem,
    SeenAnimeExtraInformation, SeenMangaExtraInformation, SeenPodcastExtraInformation,
    SeenShowExtraInformation, ShowSpecifics, VideoGameSpecifics, VisualNovelSpecifics,
};
use migrations::AliasedCollectionToEntity;
use rust_decimal::{prelude::ToPrimitive, Decimal};
use rust_decimal_macros::dec;
use sea_orm::{
    prelude::{Date, DateTimeUtc, Expr},
    sea_query::{NullOrdering, OnConflict, PgFunc},
    ActiveModelTrait, ActiveValue, ColumnTrait, DatabaseConnection, EntityTrait, FromQueryResult,
    Iterable, Order, QueryFilter, QueryOrder, QuerySelect, QueryTrait, Select, TransactionTrait,
};
use serde::{Deserialize, Serialize};
use supporting_service::SupportingService;
use user_models::UserReviewScale;
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

pub async fn user_by_id(user_id: &String, ss: &Arc<SupportingService>) -> Result<user::Model> {
    let user = User::find_by_id(user_id)
        .one(&ss.db)
        .await?
        .ok_or_else(|| Error::new("No user found"))?;
    Ok(user)
}

pub async fn admin_account_guard(user_id: &String, ss: &Arc<SupportingService>) -> Result<()> {
    let main_user = user_by_id(user_id, ss).await?;
    if main_user.lot != UserLot::Admin {
        return Err(Error::new(BackendError::AdminOnlyAction.to_string()));
    }
    Ok(())
}

pub async fn server_key_validation_guard(is_server_key_validated: bool) -> Result<()> {
    if !is_server_key_validated {
        return Err(Error::new(
            "This feature is only available on the Pro version",
        ));
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
            query.filter(user_measurement::Column::Timestamp.gte(v))
        })
        .apply_if(input.end_time, |query, v| {
            query.filter(user_measurement::Column::Timestamp.lte(v))
        })
        .filter(user_measurement::Column::UserId.eq(user_id))
        .order_by_asc(user_measurement::Column::Timestamp)
        .all(db)
        .await?;
    Ok(resp)
}

type CteColAlias = collection_to_entity::Column;

pub fn get_cte_column_from_lot(entity_lot: EntityLot) -> collection_to_entity::Column {
    match entity_lot {
        EntityLot::Metadata => CteColAlias::MetadataId,
        EntityLot::Person => CteColAlias::PersonId,
        EntityLot::MetadataGroup => CteColAlias::MetadataGroupId,
        EntityLot::Exercise => CteColAlias::ExerciseId,
        EntityLot::Workout => CteColAlias::WorkoutId,
        EntityLot::WorkoutTemplate => CteColAlias::WorkoutTemplateId,
        EntityLot::Collection | EntityLot::Review | EntityLot::UserMeasurement => unreachable!(),
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

pub async fn user_workout_details(
    user_id: &String,
    workout_id: String,
    ss: &Arc<SupportingService>,
) -> Result<UserWorkoutDetails> {
    let maybe_workout = Workout::find_by_id(workout_id.clone())
        .filter(workout::Column::UserId.eq(user_id))
        .one(&ss.db)
        .await?;
    let Some(e) = maybe_workout else {
        return Err(Error::new(
            "Workout with the given ID could not be found for this user.",
        ));
    };
    let collections =
        entity_in_collections(&ss.db, user_id, &workout_id, EntityLot::Workout).await?;
    let details = e.graphql_representation(&ss.file_storage_service).await?;
    Ok(UserWorkoutDetails {
        details,
        collections,
    })
}

pub async fn user_workout_template_details(
    db: &DatabaseConnection,
    user_id: &String,
    workout_template_id: String,
) -> Result<UserWorkoutTemplateDetails> {
    let maybe_template = WorkoutTemplate::find_by_id(workout_template_id.clone())
        .one(db)
        .await?;
    let Some(details) = maybe_template else {
        return Err(Error::new(
            "Workout template with the given ID could not be found.",
        ));
    };
    let collections = entity_in_collections(
        db,
        user_id,
        &workout_template_id,
        EntityLot::WorkoutTemplate,
    )
    .await?;
    Ok(UserWorkoutTemplateDetails {
        details,
        collections,
    })
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
    let Some(access_link) = claims.access_link else {
        return Ok(true);
    };
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
        associate_user_with_entity(db, user_id, &input.entity_id, input.entity_lot).await?;
    }
    Ok(StringIdObject { id: collect.id })
}

pub async fn item_reviews(
    user_id: &String,
    entity_id: &String,
    entity_lot: EntityLot,
    // DEV: Setting this to true will return ALL user's reviews + public reviews by others
    get_public: bool,
    ss: &Arc<SupportingService>,
) -> Result<Vec<ReviewItem>> {
    let column = match entity_lot {
        EntityLot::Metadata => review::Column::MetadataId,
        EntityLot::MetadataGroup => review::Column::MetadataGroupId,
        EntityLot::Person => review::Column::PersonId,
        EntityLot::Exercise => review::Column::ExerciseId,
        EntityLot::Collection => review::Column::CollectionId,
        EntityLot::Workout
        | EntityLot::WorkoutTemplate
        | EntityLot::Review
        | EntityLot::UserMeasurement => unreachable!(),
    };
    let all_reviews = Review::find()
        .filter(match get_public {
            false => review::Column::UserId.eq(user_id),
            true => review::Column::UserId
                .eq(user_id)
                .or(review::Column::Visibility.eq(Visibility::Public)),
        })
        .find_also_related(User)
        .order_by_desc(review::Column::PostedOn)
        .filter(column.eq(entity_id))
        .all(&ss.db)
        .await
        .unwrap();
    let mut reviews = vec![];
    for (review, user) in all_reviews {
        let user = user.unwrap();
        let rating = match true {
            true => {
                let preferences = user_by_id(user_id, ss).await?.preferences;
                review.rating.map(|s| {
                    s.checked_div(match preferences.general.review_scale {
                        UserReviewScale::OutOfFive => dec!(20),
                        UserReviewScale::OutOfHundred | UserReviewScale::ThreePointSmiley => {
                            dec!(1)
                        }
                    })
                    .unwrap()
                    .round_dp(1)
                })
            }
            false => review.rating,
        };
        let seen_items_associated_with = Seen::find()
            .select_only()
            .column(seen::Column::Id)
            .filter(seen::Column::ReviewId.eq(&review.id))
            .into_tuple::<String>()
            .all(&ss.db)
            .await?;
        let to_push = ReviewItem {
            rating,
            id: review.id,
            seen_items_associated_with,
            posted_on: review.posted_on,
            is_spoiler: review.is_spoiler,
            visibility: review.visibility,
            text_original: review.text.clone(),
            text_rendered: review.text.map(|t| markdown_to_html(&t)),
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
        music_specifics: Option<MusicSpecifics>,
        podcast_specifics: Option<PodcastSpecifics>,
        show_specifics: Option<ShowSpecifics>,
        video_game_specifics: Option<VideoGameSpecifics>,
        manual_time_spent: Option<Decimal>,
        visual_novel_specifics: Option<VisualNovelSpecifics>,
        anime_specifics: Option<AnimeSpecifics>,
        manga_specifics: Option<MangaSpecifics>,
    }

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
            .order_by_with_nulls(
                daily_user_activity::Column::Date,
                Order::Desc,
                NullOrdering::Last,
            )
            .one(db)
            .await?
            .and_then(|i| i.date)
            .unwrap_or_default(),
    };
    let mut activities = HashMap::new();

    fn get_activity_count<'a>(
        activities: &'a mut HashMap<Option<Date>, daily_user_activity::Model>,
        user_id: &'a String,
        date: Option<Date>,
        entity_id: String,
        entity_lot: EntityLot,
        metadata_lot: Option<MediaLot>,
        timestamp: DateTimeUtc,
    ) -> &'a mut daily_user_activity::Model {
        ryot_log!(debug, "Updating activity counts for id: {:?}", entity_id);
        let existing = activities
            .entry(date)
            .or_insert(daily_user_activity::Model {
                date,
                user_id: user_id.to_owned(),
                ..Default::default()
            });
        existing.entity_ids.push(entity_id.clone());
        let hour = if timestamp.minute() < 30 {
            timestamp.hour()
        } else {
            timestamp.hour() + 1
        };
        let maybe_idx = existing.hour_records.iter().position(|hr| hr.hour == hour);
        if let Some(idx) = maybe_idx {
            existing.hour_records.get_mut(idx).unwrap().entities.push(
                DailyUserActivityHourRecordEntity {
                    entity_id,
                    entity_lot,
                    metadata_lot,
                },
            );
        } else {
            existing.hour_records.push(DailyUserActivityHourRecord {
                hour,
                entities: vec![DailyUserActivityHourRecordEntity {
                    entity_id,
                    entity_lot,
                    metadata_lot,
                }],
            });
        }
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
            seen::Column::ManualTimeSpent,
        ])
        .column_as(metadata::Column::Lot, "metadata_lot")
        .columns([
            metadata::Column::AudioBookSpecifics,
            metadata::Column::BookSpecifics,
            metadata::Column::MovieSpecifics,
            metadata::Column::MusicSpecifics,
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
        let activity = get_activity_count(
            &mut activities,
            user_id,
            seen.finished_on,
            seen.seen_id,
            EntityLot::Metadata,
            Some(seen.metadata_lot),
            seen.last_updated_on,
        );
        if let (Some(show_seen), Some(show_extra)) =
            (seen.show_specifics, seen.show_extra_information)
        {
            if let Some(runtime) =
                get_show_episode_by_numbers(&show_seen, show_extra.season, show_extra.episode)
                    .and_then(|(_, e)| e.runtime)
            {
                activity.show_duration += runtime;
            }
        } else if let (Some(podcast_seen), Some(podcast_extra)) =
            (seen.podcast_specifics, seen.podcast_extra_information)
        {
            if let Some(runtime) =
                get_podcast_episode_by_number(&podcast_seen, podcast_extra.episode)
                    .and_then(|e| e.runtime)
            {
                activity.podcast_duration += runtime;
            }
        } else if let Some(audio_book_extra) = seen.audio_book_specifics {
            if let Some(runtime) = audio_book_extra.runtime {
                activity.audio_book_duration += runtime;
            }
        } else if let Some(movie_extra) = seen.movie_specifics {
            if let Some(runtime) = movie_extra.runtime {
                activity.movie_duration += runtime;
            }
        } else if let Some(music_extra) = seen.music_specifics {
            if let Some(runtime) = music_extra.duration {
                activity.music_duration += runtime;
            }
        } else if let Some(book_extra) = seen.book_specifics {
            if let Some(pages) = book_extra.pages {
                activity.book_pages += pages;
            }
        } else if let Some(visual_novel_extra) = seen.visual_novel_specifics {
            if let Some(runtime) = visual_novel_extra.length {
                activity.visual_novel_duration += runtime;
            }
        } else if let Some(_video_game_extra) = seen.video_game_specifics {
            if let Some(manual_time_spent) = seen.manual_time_spent {
                activity.video_game_duration +=
                    (manual_time_spent / dec!(60)).to_i32().unwrap_or_default();
            }
        }
        match seen.metadata_lot {
            MediaLot::Book => activity.book_count += 1,
            MediaLot::Show => activity.show_count += 1,
            MediaLot::Music => activity.music_count += 1,
            MediaLot::Anime => activity.anime_count += 1,
            MediaLot::Movie => activity.movie_count += 1,
            MediaLot::Manga => activity.manga_count += 1,
            MediaLot::Podcast => activity.podcast_count += 1,
            MediaLot::VideoGame => activity.video_game_count += 1,
            MediaLot::AudioBook => activity.audio_book_count += 1,
            MediaLot::VisualNovel => activity.visual_novel_count += 1,
        };
    }

    let exercises = Exercise::find().all(db).await.unwrap();
    let user_exercises = UserToEntity::find()
        .filter(user_to_entity::Column::UserId.eq(user_id))
        .filter(user_to_entity::Column::ExerciseId.is_not_null())
        .all(db)
        .await?;
    let mut workout_stream = Workout::find()
        .filter(workout::Column::UserId.eq(user_id))
        .filter(workout::Column::EndTime.gte(start_from))
        .stream(db)
        .await?;
    while let Some(workout) = workout_stream.try_next().await? {
        let date = workout.end_time.date_naive();
        let activity = get_activity_count(
            &mut activities,
            user_id,
            Some(date),
            workout.id,
            EntityLot::Workout,
            None,
            workout.start_time,
        );
        activity.workout_count += 1;
        activity.workout_duration += workout.duration / 60;
        let workout_total = workout.summary.total.unwrap();
        activity.workout_personal_bests += workout_total.personal_bests_achieved as i32;
        activity.workout_weight += workout_total.weight.to_i32().unwrap_or_default();
        activity.workout_reps += workout_total.reps.to_i32().unwrap_or_default();
        activity.workout_distance += workout_total.distance.to_i32().unwrap_or_default();
        activity.workout_rest_time += (workout_total.rest_time as i32) / 60;
        for exercise in workout.information.exercises {
            let db_ex = exercises.iter().find(|e| e.id == exercise.id).unwrap();
            if user_exercises
                .iter()
                .find(|e| e.exercise_id == Some(db_ex.id.clone()))
                .unwrap()
                .exercise_extra_information
                .as_ref()
                .map(|d| d.settings.exclude_from_analytics)
                .unwrap_or_default()
            {
                continue;
            }
            activity.workout_exercises.push(db_ex.name.clone());
            activity.workout_equipments.extend(db_ex.equipment);
            activity.workout_muscles.extend(db_ex.muscles.clone());
        }
    }

    let mut measurement_stream = UserMeasurement::find()
        .filter(user_measurement::Column::UserId.eq(user_id))
        .filter(user_measurement::Column::Timestamp.gte(start_from))
        .stream(db)
        .await?;
    while let Some(measurement) = measurement_stream.try_next().await? {
        let date = measurement.timestamp.date_naive();
        let activity = get_activity_count(
            &mut activities,
            user_id,
            Some(date),
            measurement.timestamp.to_string(),
            EntityLot::UserMeasurement,
            None,
            measurement.timestamp,
        );
        activity.measurement_count += 1;
    }

    let mut review_stream = Review::find()
        .filter(review::Column::UserId.eq(user_id))
        .filter(review::Column::PostedOn.gte(start_from))
        .stream(db)
        .await?;
    while let Some(review) = review_stream.try_next().await? {
        let date = review.posted_on.date_naive();
        let activity = get_activity_count(
            &mut activities,
            user_id,
            Some(date),
            review.id,
            EntityLot::Review,
            None,
            review.posted_on,
        );
        match review.entity_lot {
            EntityLot::Person => activity.person_review_count += 1,
            EntityLot::Exercise => activity.exercise_review_count += 1,
            EntityLot::Metadata => activity.metadata_review_count += 1,
            EntityLot::Collection => activity.collection_review_count += 1,
            EntityLot::MetadataGroup => activity.metadata_group_review_count += 1,
            _ => {}
        }
    }

    for (_, activity) in activities.iter_mut() {
        let deleted = DailyUserActivity::delete_many()
            .filter(daily_user_activity::Column::Date.eq(activity.date))
            .filter(daily_user_activity::Column::UserId.eq(user_id))
            .exec(db)
            .await?;
        if deleted.rows_affected > 0 {
            ryot_log!(debug, "Deleted existing activity = {:?}", activity.date);
        }
        ryot_log!(debug, "Inserting activity = {:?}", activity.date);
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
        let total_count = total_metadata_count
            + activity.measurement_count
            + activity.workout_count
            + total_review_count;
        let total_duration = activity.workout_duration
            + activity.audio_book_duration
            + activity.podcast_duration
            + activity.movie_duration
            + activity.show_duration
            + activity.visual_novel_duration
            + activity.video_game_duration;
        activity.hour_records.sort_by_key(|hr| hr.hour);
        let mut model: daily_user_activity::ActiveModel = activity.clone().into();
        model.id = ActiveValue::NotSet;
        model.total_review_count = ActiveValue::Set(total_review_count);
        model.total_metadata_count = ActiveValue::Set(total_metadata_count);
        model.total_count = ActiveValue::Set(total_count);
        model.total_duration = ActiveValue::Set(total_duration);
        model.insert(db).await.ok();
    }

    Ok(())
}

pub async fn deploy_job_to_calculate_user_activities_and_summary(
    user_id: &String,
    calculate_from_beginning: bool,
    ss: &Arc<SupportingService>,
) {
    ss.perform_application_job(ApplicationJob::RecalculateUserActivitiesAndSummary(
        user_id.to_owned(),
        calculate_from_beginning,
    ))
    .await
    .unwrap();
}

pub async fn schedule_user_for_workout_revision(
    user_id: &String,
    ss: &Arc<SupportingService>,
) -> Result<()> {
    let user = User::find_by_id(user_id)
        .one(&ss.db)
        .await?
        .ok_or_else(|| Error::new("User with the given ID does not exist"))?;
    let mut extra_information = user.extra_information.clone().unwrap_or_default();
    extra_information.scheduled_for_workout_revision = true;
    let mut user: user::ActiveModel = user.into();
    user.extra_information = ActiveValue::Set(Some(extra_information));
    user.update(&ss.db).await?;
    ryot_log!(debug, "Scheduled user for workout revision: {:?}", user_id);
    Ok(())
}
