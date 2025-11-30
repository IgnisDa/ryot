use std::{collections::HashMap, sync::Arc};

use anyhow::Result;
use application_utils::{get_podcast_episode_by_number, get_show_episode_by_numbers};
use chrono::{NaiveDate, Timelike};
use common_models::{DailyUserActivityHourRecord, DailyUserActivityHourRecordEntity};
use common_utils::ryot_log;
use database_models::{
    collection_to_entity, daily_user_activity, metadata,
    prelude::{
        CollectionToEntity, DailyUserActivity, Exercise, Metadata, Review, Seen, UserMeasurement,
        UserToEntity, Workout,
    },
    review, seen, user_measurement, user_to_entity, workout,
};
use dependent_entity_list_utils::user_collections_list;
use dependent_models::{ApplicationCacheKeyDiscriminants, ExpireCacheKeyInput};
use enum_models::{EntityLot, MediaLot, SeenState};
use futures::{TryStreamExt, try_join};
use media_models::{
    AnimeSpecifics, AudioBookSpecifics, BookSpecifics, MangaSpecifics, MovieSpecifics,
    MusicSpecifics, PodcastSpecifics, SeenAnimeExtraInformation, SeenMangaExtraInformation,
    SeenPodcastExtraInformation, SeenShowExtraInformation, ShowSpecifics, VideoGameSpecifics,
    VisualNovelSpecifics,
};
use rust_decimal::{Decimal, dec, prelude::ToPrimitive};
use sea_orm::{
    ActiveModelTrait, ActiveValue, ColumnTrait, EntityTrait, FromQueryResult, IntoActiveModel,
    Order, QueryFilter, QueryOrder, QuerySelect,
    prelude::{Date, DateTimeUtc},
    sea_query::NullOrdering,
};
use serde::{Deserialize, Serialize};
use supporting_service::SupportingService;

pub async fn calculate_user_activities_and_summary(
    user_id: &String,
    ss: &Arc<SupportingService>,
    calculate_from_beginning: bool,
) -> Result<()> {
    #[derive(Debug, Serialize, Deserialize, Clone, FromQueryResult)]
    struct SeenItem {
        seen_id: String,
        metadata_id: String,
        metadata_lot: MediaLot,
        last_updated_on: DateTimeUtc,
        finished_on: Option<DateTimeUtc>,
        manual_time_spent: Option<Decimal>,
        show_specifics: Option<ShowSpecifics>,
        book_specifics: Option<BookSpecifics>,
        movie_specifics: Option<MovieSpecifics>,
        music_specifics: Option<MusicSpecifics>,
        anime_specifics: Option<AnimeSpecifics>,
        manga_specifics: Option<MangaSpecifics>,
        podcast_specifics: Option<PodcastSpecifics>,
        video_game_specifics: Option<VideoGameSpecifics>,
        audio_book_specifics: Option<AudioBookSpecifics>,
        visual_novel_specifics: Option<VisualNovelSpecifics>,
        show_extra_information: Option<SeenShowExtraInformation>,
        anime_extra_information: Option<SeenAnimeExtraInformation>,
        manga_extra_information: Option<SeenMangaExtraInformation>,
        podcast_extra_information: Option<SeenPodcastExtraInformation>,
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
        activities: &'a mut HashMap<Option<NaiveDate>, daily_user_activity::Model>,
        user_id: &'a String,
        dt: Option<DateTimeUtc>,
        entity_id: String,
        entity_lot: EntityLot,
        metadata_lot: Option<MediaLot>,
        timestamp: DateTimeUtc,
    ) -> &'a mut daily_user_activity::Model {
        ryot_log!(debug, "Updating activity counts for id: {:?}", entity_id);
        let date = dt.map(|d| d.date_naive());
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
        } else if let Some(_video_game_extra) = seen.video_game_specifics
            && let Some(manual_time_spent) = seen.manual_time_spent
        {
            activity.video_game_duration +=
                (manual_time_spent / dec!(60)).to_i32().unwrap_or_default();
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

    let (exercises, user_exercises) = try_join!(
        Exercise::find().all(&ss.db),
        UserToEntity::find()
            .filter(user_to_entity::Column::UserId.eq(user_id))
            .filter(user_to_entity::Column::ExerciseId.is_not_null())
            .all(&ss.db)
    )?;
    let mut workout_stream = Workout::find()
        .filter(workout::Column::UserId.eq(user_id))
        .filter(workout::Column::EndTime.gte(start_from))
        .stream(&ss.db)
        .await?;
    while let Some(workout) = workout_stream.try_next().await? {
        let activity = get_activity_count(
            &mut activities,
            user_id,
            Some(workout.end_time),
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
        let activity = get_activity_count(
            &mut activities,
            user_id,
            Some(measurement.timestamp),
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
        let activity = get_activity_count(
            &mut activities,
            user_id,
            Some(review.posted_on),
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

    let collections_response = user_collections_list(user_id, ss).await?;

    let user_owned_collection_ids: Vec<String> = collections_response
        .response
        .iter()
        .filter(|collection| collection.creator.id == *user_id)
        .map(|collection| collection.id.clone())
        .collect();

    let mut collection_stream = CollectionToEntity::find()
        .filter(collection_to_entity::Column::CollectionId.is_in(user_owned_collection_ids))
        .filter(collection_to_entity::Column::CreatedOn.gt(start_from))
        .stream(&ss.db)
        .await?;

    while let Some(cte) = collection_stream.try_next().await? {
        let activity = get_activity_count(
            &mut activities,
            user_id,
            Some(cte.created_on),
            cte.id.to_string(),
            cte.entity_lot,
            None,
            cte.created_on,
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

        let total_person_count = activity.person_review_count + activity.person_collection_count;
        let total_metadata_group_count =
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
            + total_person_count
            + total_metadata_group_count;
        let total_duration = activity.workout_duration
            + activity.audio_book_duration
            + activity.podcast_duration
            + activity.movie_duration
            + activity.show_duration
            + activity.music_duration
            + activity.visual_novel_duration
            + activity.video_game_duration;
        activity.hour_records.sort_by_key(|hr| hr.hour);
        let mut model = activity.clone().into_active_model();
        model.id = ActiveValue::NotSet;
        model.total_count = ActiveValue::Set(total_count);
        model.total_duration = ActiveValue::Set(total_duration);
        model.total_person_count = ActiveValue::Set(total_person_count);
        model.total_review_count = ActiveValue::Set(total_review_count);
        model.total_metadata_count = ActiveValue::Set(total_metadata_count);
        model.total_collection_count = ActiveValue::Set(total_collection_count);
        model.total_metadata_group_count = ActiveValue::Set(total_metadata_group_count);
        model.insert(&ss.db).await.unwrap();
    }

    cache_service::expire_key(
        ss,
        ExpireCacheKeyInput::BySanitizedKey {
            user_id: Some(user_id.to_owned()),
            key: ApplicationCacheKeyDiscriminants::UserAnalytics,
        },
    )
    .await?;

    Ok(())
}
