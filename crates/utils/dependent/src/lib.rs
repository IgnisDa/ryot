use std::{
    collections::{HashMap, hash_map::Entry},
    future::Future,
    sync::Arc,
};

use application_utils::{
    get_podcast_episode_by_number, get_show_episode_by_numbers, graphql_to_db_order,
};
use async_graphql::Result;
use chrono::Timelike;
use common_models::{
    ChangeCollectionToEntityInput, DailyUserActivityHourRecord, DailyUserActivityHourRecordEntity,
};
use common_utils::{
    MAX_IMPORT_RETRIES_FOR_PARTIAL_STATE, SHOW_SPECIAL_SEASON_NAMES, ryot_log, sleep_for_n_seconds,
};
use database_models::{
    collection_to_entity, daily_user_activity, metadata,
    prelude::{
        CollectionToEntity, DailyUserActivity, Exercise, Metadata, Review, Seen, UserMeasurement,
        UserToEntity, Workout,
    },
    review, seen, user_measurement, user_to_entity, workout,
};
use database_utils::{schedule_user_for_workout_revision, user_by_id};
use dependent_models::{
    ApplicationCacheKeyDiscriminants, ExpireCacheKeyInput, ImportCompletedItem, ImportResult,
};
use enum_models::{EntityLot, MediaLot, MediaSource, SeenState};
use futures::TryStreamExt;
use importer_models::{ImportDetails, ImportFailStep, ImportFailedItem, ImportResultResponse};
use media_models::{
    AnimeSpecifics, AudioBookSpecifics, BookSpecifics, CommitMetadataGroupInput, CommitPersonInput,
    CreateOrUpdateCollectionInput, ImportOrExportMetadataItem, MangaSpecifics, MovieSpecifics,
    MusicSpecifics, PartialMetadataWithoutId, PodcastSpecifics, ProgressUpdateInput,
    SeenAnimeExtraInformation, SeenMangaExtraInformation, SeenPodcastExtraInformation,
    SeenShowExtraInformation, ShowSpecifics, UniqueMediaIdentifier, VideoGameSpecifics,
    VisualNovelSpecifics,
};
use migrations::{
    AliasedCollection, AliasedCollectionToEntity, AliasedExercise, AliasedReview, AliasedUser,
    AliasedUserToEntity,
};
use rand::seq::SliceRandom;
use rust_decimal::{
    Decimal,
    prelude::{FromPrimitive, ToPrimitive},
};
use rust_decimal_macros::dec;
use sea_orm::{
    ActiveModelTrait, ActiveValue, ColumnTrait, EntityTrait, FromQueryResult, Order, QueryFilter,
    QueryOrder, QuerySelect,
    prelude::{Date, DateTimeUtc},
};
use sea_query::NullOrdering;
use serde::{Deserialize, Serialize};
use supporting_service::SupportingService;

mod provider_services;
pub use provider_services::*;

mod metadata_operations;
pub use metadata_operations::*;

mod notification_operations;
pub use notification_operations::*;

mod job_operations;
pub use job_operations::*;

mod utility_operations;
pub use utility_operations::*;

mod review_operations;
pub use review_operations::*;

mod seen_operations;
pub use seen_operations::*;

mod fitness_operations;
pub use fitness_operations::*;

mod collection_operations;
pub use collection_operations::*;

mod list_operations;
mod progress_operations;
pub use list_operations::*;
pub use progress_operations::*;

async fn create_collection_and_add_entity_to_it(
    user_id: &String,
    entity_id: String,
    entity_lot: EntityLot,
    collection_name: String,
    ss: &Arc<SupportingService>,
    import_failed_set: &mut Vec<ImportFailedItem>,
) {
    if let Err(e) = collection_operations::create_or_update_collection(
        user_id,
        ss,
        CreateOrUpdateCollectionInput {
            name: collection_name.clone(),
            ..Default::default()
        },
    )
    .await
    {
        import_failed_set.push(ImportFailedItem {
            identifier: collection_name.clone(),
            step: ImportFailStep::DatabaseCommit,
            error: Some(format!("Failed to create collection {}", e.message)),
            ..Default::default()
        });
    }
    if let Err(e) = collection_operations::add_entity_to_collection(
        user_id,
        ChangeCollectionToEntityInput {
            entity_id,
            entity_lot,
            creator_user_id: user_id.clone(),
            collection_name: collection_name.to_string(),
            ..Default::default()
        },
        ss,
    )
    .await
    {
        import_failed_set.push(ImportFailedItem {
            identifier: collection_name.clone(),
            step: ImportFailStep::DatabaseCommit,
            error: Some(format!("Failed to add entity to collection {}", e.message)),
            ..Default::default()
        });
    };
}

pub async fn process_import<F>(
    user_id: &String,
    respect_cache: bool,
    mut import: ImportResult,
    ss: &Arc<SupportingService>,
    on_item_processed: impl Fn(Decimal) -> F,
) -> Result<(ImportResult, ImportResultResponse)>
where
    F: Future<Output = Result<()>>,
{
    let preferences = user_by_id(user_id, ss).await?.preferences;

    let mut aggregated_metadata: HashMap<
        (MediaSource, String, MediaLot),
        ImportOrExportMetadataItem,
    > = HashMap::new();
    let mut other_items = Vec::new();

    for item in import.completed {
        match item {
            ImportCompletedItem::Metadata(mut current_metadata) => {
                let key = (
                    current_metadata.source,
                    current_metadata.identifier.clone(),
                    current_metadata.lot,
                );
                match aggregated_metadata.entry(key) {
                    Entry::Occupied(mut entry) => {
                        let existing_metadata = entry.get_mut();
                        existing_metadata
                            .seen_history
                            .append(&mut current_metadata.seen_history);
                        existing_metadata
                            .reviews
                            .append(&mut current_metadata.reviews);
                        existing_metadata
                            .collections
                            .append(&mut current_metadata.collections);
                    }
                    Entry::Vacant(entry) => {
                        entry.insert(current_metadata);
                    }
                }
            }
            other => {
                other_items.push(other);
            }
        }
    }

    import.completed = aggregated_metadata
        .into_values()
        .map(ImportCompletedItem::Metadata)
        .chain(other_items.into_iter())
        .collect();

    import.completed.retain(|i| match i {
        ImportCompletedItem::Metadata(m) => {
            !m.seen_history.is_empty() || !m.reviews.is_empty() || !m.collections.is_empty()
        }
        ImportCompletedItem::Person(p) => !p.reviews.is_empty() || !p.collections.is_empty(),
        ImportCompletedItem::MetadataGroup(m) => !m.reviews.is_empty() || !m.collections.is_empty(),
        _ => true,
    });

    import.completed.shuffle(&mut rand::rng());

    // DEV: We need to make sure that exercises are created first because workouts are
    // dependent on them.
    import.completed.sort_by_key(|i| match i {
        ImportCompletedItem::Exercise(_) => 0,
        _ => 1,
    });

    let source_result = import.clone();
    let total = import.completed.len();

    let mut need_to_schedule_user_for_workout_revision = false;

    for (idx, item) in import.completed.into_iter().enumerate() {
        ryot_log!(
            debug,
            "Processing item ({}) {}/{}",
            item.to_string(),
            idx + 1,
            total,
        );
        match item {
            ImportCompletedItem::Empty => {}
            ImportCompletedItem::Metadata(metadata) => {
                let db_metadata_id = match commit_metadata(
                    PartialMetadataWithoutId {
                        lot: metadata.lot,
                        source: metadata.source,
                        title: metadata.source_id.clone(),
                        identifier: metadata.identifier.clone(),
                        ..Default::default()
                    },
                    ss,
                )
                .await
                {
                    Ok(m) => m.id,
                    Err(e) => {
                        import.failed.push(ImportFailedItem {
                            error: Some(e.message),
                            lot: Some(metadata.lot),
                            step: ImportFailStep::DatabaseCommit,
                            identifier: metadata.source_id.to_string(),
                        });
                        continue;
                    }
                };
                let mut was_updated_successfully = false;
                for attempt in 0..MAX_IMPORT_RETRIES_FOR_PARTIAL_STATE {
                    let is_partial = Metadata::find_by_id(&db_metadata_id)
                        .select_only()
                        .column(metadata::Column::IsPartial)
                        .into_tuple::<bool>()
                        .one(&ss.db)
                        .await?
                        .unwrap_or(true);
                    if is_partial {
                        deploy_update_metadata_job(&db_metadata_id, ss).await?;
                        let sleep_time = u64::pow(2, (attempt + 1).try_into().unwrap());
                        ryot_log!(debug, "Sleeping for {}s before metadata check", sleep_time);
                        sleep_for_n_seconds(sleep_time).await;
                    } else {
                        was_updated_successfully = true;
                        break;
                    }
                }
                if !was_updated_successfully {
                    import.failed.push(ImportFailedItem {
                        lot: Some(metadata.lot),
                        identifier: db_metadata_id.clone(),
                        step: ImportFailStep::MediaDetailsFromProvider,
                        error: Some("Progress update *might* be wrong".to_owned()),
                    });
                }
                for seen in metadata.seen_history.iter() {
                    let progress = match seen.progress {
                        Some(_p) => seen.progress,
                        None => Some(dec!(100)),
                    };
                    if let Err(e) = progress_update(
                        user_id,
                        respect_cache,
                        ProgressUpdateInput {
                            progress,
                            date: seen.ended_on,
                            start_date: seen.started_on,
                            metadata_id: db_metadata_id.clone(),
                            show_season_number: seen.show_season_number,
                            show_episode_number: seen.show_episode_number,
                            manga_volume_number: seen.manga_volume_number,
                            anime_episode_number: seen.anime_episode_number,
                            manga_chapter_number: seen.manga_chapter_number,
                            podcast_episode_number: seen.podcast_episode_number,
                            provider_watched_on: seen.provider_watched_on.clone(),
                            ..Default::default()
                        },
                        ss,
                    )
                    .await
                    {
                        import.failed.push(ImportFailedItem {
                            lot: Some(metadata.lot),
                            step: ImportFailStep::DatabaseCommit,
                            identifier: metadata.source_id.to_owned(),
                            error: Some(e.message),
                        });
                    };
                }
                for review in metadata.reviews.iter() {
                    if let Some(input) = convert_review_into_input(
                        review,
                        &preferences,
                        db_metadata_id.clone(),
                        EntityLot::Metadata,
                    ) {
                        if let Err(e) = post_review(user_id, input, ss).await {
                            import.failed.push(ImportFailedItem {
                                lot: Some(metadata.lot),
                                step: ImportFailStep::DatabaseCommit,
                                identifier: metadata.source_id.to_owned(),
                                error: Some(e.message),
                            });
                        };
                    }
                }
                for col in metadata.collections.into_iter() {
                    create_collection_and_add_entity_to_it(
                        user_id,
                        db_metadata_id.clone(),
                        EntityLot::Metadata,
                        col,
                        ss,
                        &mut import.failed,
                    )
                    .await;
                }
            }
            ImportCompletedItem::MetadataGroup(metadata_group) => {
                let db_metadata_group_id = match commit_metadata_group(
                    CommitMetadataGroupInput {
                        name: metadata_group.title.clone(),
                        unique: UniqueMediaIdentifier {
                            lot: metadata_group.lot,
                            source: metadata_group.source,
                            identifier: metadata_group.identifier.clone(),
                        },
                        ..Default::default()
                    },
                    ss,
                )
                .await
                {
                    Ok(m) => m.id,
                    Err(e) => {
                        import.failed.push(ImportFailedItem {
                            error: Some(e.message),
                            lot: Some(metadata_group.lot),
                            step: ImportFailStep::DatabaseCommit,
                            identifier: metadata_group.title.to_string(),
                        });
                        continue;
                    }
                };
                deploy_update_metadata_group_job(&db_metadata_group_id, ss).await?;
                for review in metadata_group.reviews.iter() {
                    if let Some(input) = convert_review_into_input(
                        review,
                        &preferences,
                        db_metadata_group_id.clone(),
                        EntityLot::MetadataGroup,
                    ) {
                        if let Err(e) = post_review(user_id, input, ss).await {
                            import.failed.push(ImportFailedItem {
                                lot: Some(metadata_group.lot),
                                step: ImportFailStep::DatabaseCommit,
                                identifier: metadata_group.title.to_owned(),
                                error: Some(e.message),
                            });
                        };
                    }
                }
                for col in metadata_group.collections.into_iter() {
                    create_collection_and_add_entity_to_it(
                        user_id,
                        db_metadata_group_id.clone(),
                        EntityLot::MetadataGroup,
                        col,
                        ss,
                        &mut import.failed,
                    )
                    .await;
                }
            }
            ImportCompletedItem::Person(person) => {
                let db_person_id = match commit_person(
                    CommitPersonInput {
                        source: person.source,
                        name: person.name.clone(),
                        identifier: person.identifier.clone(),
                        source_specifics: person.source_specifics.clone(),
                        ..Default::default()
                    },
                    ss,
                )
                .await
                {
                    Ok(p) => p.id,
                    Err(e) => {
                        import.failed.push(ImportFailedItem {
                            error: Some(e.message),
                            identifier: person.name.to_string(),
                            step: ImportFailStep::DatabaseCommit,
                            ..Default::default()
                        });
                        continue;
                    }
                };
                deploy_update_person_job(&db_person_id, ss).await?;
                for review in person.reviews.iter() {
                    if let Some(input) = convert_review_into_input(
                        review,
                        &preferences,
                        db_person_id.clone(),
                        EntityLot::Person,
                    ) {
                        if let Err(e) = post_review(user_id, input, ss).await {
                            import.failed.push(ImportFailedItem {
                                error: Some(e.message),
                                identifier: person.name.to_owned(),
                                step: ImportFailStep::DatabaseCommit,
                                ..Default::default()
                            });
                        };
                    }
                }
                for col in person.collections.into_iter() {
                    create_collection_and_add_entity_to_it(
                        user_id,
                        db_person_id.clone(),
                        EntityLot::Person,
                        col,
                        ss,
                        &mut import.failed,
                    )
                    .await;
                }
            }
            ImportCompletedItem::Collection(col_details) => {
                if let Err(e) = collection_operations::create_or_update_collection(
                    user_id,
                    ss,
                    col_details.clone(),
                )
                .await
                {
                    import.failed.push(ImportFailedItem {
                        error: Some(e.message),
                        identifier: col_details.name.clone(),
                        step: ImportFailStep::DatabaseCommit,
                        ..Default::default()
                    });
                }
            }
            ImportCompletedItem::Exercise(exercise) => {
                if let Err(e) = create_custom_exercise(user_id, exercise.clone(), ss).await {
                    import.failed.push(ImportFailedItem {
                        error: Some(e.message),
                        identifier: exercise.name.clone(),
                        step: ImportFailStep::DatabaseCommit,
                        ..Default::default()
                    });
                }
            }
            ImportCompletedItem::Workout(workout) => {
                need_to_schedule_user_for_workout_revision = true;
                if let Err(err) = create_or_update_user_workout(user_id, workout.clone(), ss).await
                {
                    import.failed.push(ImportFailedItem {
                        error: Some(err.message),
                        identifier: workout.name,
                        step: ImportFailStep::DatabaseCommit,
                        ..Default::default()
                    });
                }
            }
            ImportCompletedItem::ApplicationWorkout(workout) => {
                need_to_schedule_user_for_workout_revision = true;
                let workout_input = db_workout_to_workout_input(workout.details);
                match create_or_update_user_workout(user_id, workout_input.clone(), ss).await {
                    Err(err) => {
                        import.failed.push(ImportFailedItem {
                            error: Some(err.message),
                            identifier: workout_input.name,
                            step: ImportFailStep::DatabaseCommit,
                            ..Default::default()
                        });
                    }
                    Ok(workout_id) => {
                        for col in workout.collections.into_iter() {
                            create_collection_and_add_entity_to_it(
                                user_id,
                                workout_id.clone(),
                                EntityLot::Workout,
                                col,
                                ss,
                                &mut import.failed,
                            )
                            .await;
                        }
                    }
                }
            }
            ImportCompletedItem::Measurement(measurement) => {
                if let Err(err) = create_user_measurement(user_id, measurement.clone(), ss).await {
                    import.failed.push(ImportFailedItem {
                        error: Some(err.message),
                        step: ImportFailStep::DatabaseCommit,
                        identifier: measurement.timestamp.to_string(),
                        ..Default::default()
                    });
                }
            }
        }

        on_item_processed(
            Decimal::from_usize(idx + 1).unwrap() / Decimal::from_usize(total).unwrap() * dec!(100),
        )
        .await?;
    }

    if need_to_schedule_user_for_workout_revision {
        schedule_user_for_workout_revision(user_id, ss).await?;
    }

    let details = ImportResultResponse {
        failed_items: import.failed,
        import: ImportDetails { total },
    };

    Ok((source_result, details))
}

pub async fn calculate_user_activities_and_summary(
    user_id: &String,
    ss: &Arc<SupportingService>,
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
                .exec(&ss.db)
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
            .one(&ss.db)
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
        .stream(&ss.db)
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
                activity.music_duration += runtime / 60;
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

    let exercises = Exercise::find().all(&ss.db).await.unwrap();
    let user_exercises = UserToEntity::find()
        .filter(user_to_entity::Column::UserId.eq(user_id))
        .filter(user_to_entity::Column::ExerciseId.is_not_null())
        .all(&ss.db)
        .await?;
    let mut workout_stream = Workout::find()
        .filter(workout::Column::UserId.eq(user_id))
        .filter(workout::Column::EndTime.gte(start_from))
        .stream(&ss.db)
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
        activity.workout_calories_burnt += workout
            .calories_burnt
            .unwrap_or_default()
            .to_i32()
            .unwrap_or_default();
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
        .stream(&ss.db)
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
        .stream(&ss.db)
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

    expire_user_collections_list_cache(user_id, ss).await?;
    let collections_response = user_collections_list(user_id, ss).await?;

    let user_owned_collection_ids: Vec<String> = collections_response
        .response
        .iter()
        .filter(|collection| collection.creator.id == *user_id)
        .map(|collection| collection.id.clone())
        .collect();

    let mut collection_stream = CollectionToEntity::find()
        .filter(collection_to_entity::Column::CollectionId.is_in(user_owned_collection_ids))
        .filter(collection_to_entity::Column::LastUpdatedOn.gt(start_from))
        .stream(&ss.db)
        .await?;

    while let Some(cte) = collection_stream.try_next().await? {
        let date = cte.last_updated_on.date_naive();
        let activity = get_activity_count(
            &mut activities,
            user_id,
            Some(date),
            cte.id.to_string(),
            cte.entity_lot,
            None,
            cte.last_updated_on,
        );

        match cte.entity_lot {
            EntityLot::Metadata => activity.metadata_collection_count += 1,
            EntityLot::Person => activity.person_collection_count += 1,
            EntityLot::MetadataGroup => activity.metadata_group_collection_count += 1,
            _ => {}
        }
    }

    for (_, activity) in activities.iter_mut() {
        DailyUserActivity::delete_many()
            .filter(daily_user_activity::Column::UserId.eq(user_id))
            .filter(match activity.date {
                None => daily_user_activity::Column::Date.is_null(),
                Some(date) => daily_user_activity::Column::Date.eq(date),
            })
            .exec(&ss.db)
            .await?;
        ryot_log!(debug, "Inserting activity = {:?}", activity.date);
        let total_collection_count = activity.person_collection_count
            + activity.metadata_collection_count
            + activity.metadata_group_collection_count;

        activity.total_person_count =
            activity.person_review_count + activity.person_collection_count;
        activity.total_metadata_group_count =
            activity.metadata_group_review_count + activity.metadata_group_collection_count;

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
            + activity.music_count
            + activity.audio_book_count
            + activity.book_count
            + activity.video_game_count
            + activity.visual_novel_count
            + activity.metadata_collection_count;
        let total_count = total_metadata_count
            + activity.measurement_count
            + activity.workout_count
            + total_review_count
            + total_collection_count;
        let total_duration = activity.workout_duration
            + activity.audio_book_duration
            + activity.podcast_duration
            + activity.movie_duration
            + activity.show_duration
            + activity.music_duration
            + activity.visual_novel_duration
            + activity.video_game_duration;
        activity.hour_records.sort_by_key(|hr| hr.hour);
        let mut model: daily_user_activity::ActiveModel = activity.clone().into();
        model.id = ActiveValue::NotSet;
        model.total_count = ActiveValue::Set(total_count);
        model.total_duration = ActiveValue::Set(total_duration);
        model.total_review_count = ActiveValue::Set(total_review_count);
        model.total_metadata_count = ActiveValue::Set(total_metadata_count);
        model.total_collection_count = ActiveValue::Set(total_collection_count);
        model.insert(&ss.db).await.unwrap();
    }

    ss.cache_service
        .expire_key(ExpireCacheKeyInput::BySanitizedKey {
            user_id: Some(user_id.to_owned()),
            key: ApplicationCacheKeyDiscriminants::UserAnalytics,
        })
        .await?;

    ryot_log!(debug, "Expired cache key for user: {:?}", user_id);

    Ok(())
}
