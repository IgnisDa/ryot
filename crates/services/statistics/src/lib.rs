use std::{cmp::Reverse, collections::HashMap, sync::Arc};

use anyhow::Result;
use application_utils::{get_podcast_episode_by_number, get_show_episode_by_numbers};
use chrono::{NaiveDate, Timelike};
use common_models::{
    ApplicationDateRange, DailyUserActivitiesResponseGroupedBy, DailyUserActivityHourRecord,
    DailyUserActivityHourRecordEntity, UserAnalyticsInput, UserLevelCacheKey,
};
use database_models::{
    metadata,
    prelude::{Exercise, Metadata, Review, Seen, UserMeasurement, UserToEntity, Workout},
    review, seen, user_measurement, user_to_entity, workout,
};
use dependent_models::{
    ApplicationCacheKey, ApplicationCacheValue, CachedResponse, DailyUserActivitiesResponse,
    DailyUserActivityItem, FitnessAnalyticsEquipment, FitnessAnalyticsExercise,
    FitnessAnalyticsMuscle, UserAnalytics, UserFitnessAnalytics,
};
use enum_models::{EntityLot, ExerciseEquipment, ExerciseMuscle, MediaLot, SeenState};
use futures::{TryStreamExt, try_join};
use hashbag::HashBag;
use itertools::Itertools;
use media_models::{
    AnimeSpecifics, AudioBookSpecifics, BookSpecifics, MangaSpecifics, MovieSpecifics,
    MusicSpecifics, PodcastSpecifics, SeenAnimeExtraInformation, SeenMangaExtraInformation,
    SeenPodcastExtraInformation, SeenShowExtraInformation, ShowSpecifics, VideoGameSpecifics,
    VisualNovelSpecifics,
};
use rust_decimal::{Decimal, prelude::ToPrimitive};
use rust_decimal_macros::dec;
use sea_orm::{
    ColumnTrait, EntityTrait, FromQueryResult, QueryFilter, QuerySelect, Select,
    prelude::DateTimeUtc,
};
use serde::{Deserialize, Serialize};
use supporting_service::SupportingService;

pub struct StatisticsService(pub Arc<SupportingService>);

#[derive(Clone, Default, Debug, PartialEq, Eq, Serialize, Deserialize)]
struct DailyUserActivityModel {
    pub user_id: String,
    pub date: Option<NaiveDate>,
    pub entity_ids: Vec<String>,
    pub collection_review_count: i32,
    pub total_metadata_count: i32,
    pub metadata_review_count: i32,
    pub metadata_collection_count: i32,
    pub total_metadata_group_count: i32,
    pub metadata_group_review_count: i32,
    pub metadata_group_collection_count: i32,
    pub total_person_count: i32,
    pub person_review_count: i32,
    pub person_collection_count: i32,
    pub exercise_review_count: i32,
    pub measurement_count: i32,
    pub workout_count: i32,
    pub workout_duration: i32,
    pub audio_book_count: i32,
    pub audio_book_duration: i32,
    pub anime_count: i32,
    pub book_count: i32,
    pub book_pages: i32,
    pub podcast_count: i32,
    pub podcast_duration: i32,
    pub manga_count: i32,
    pub movie_count: i32,
    pub movie_duration: i32,
    pub music_count: i32,
    pub music_duration: i32,
    pub show_count: i32,
    pub show_duration: i32,
    pub video_game_count: i32,
    pub video_game_duration: i32,
    pub visual_novel_count: i32,
    pub visual_novel_duration: i32,
    pub workout_personal_bests: i32,
    pub workout_weight: i32,
    pub workout_reps: i32,
    pub workout_distance: i32,
    pub workout_rest_time: i32,
    pub total_collection_count: i32,
    pub total_review_count: i32,
    pub total_count: i32,
    pub total_duration: i32,
    pub workout_calories_burnt: i32,
    pub hour_records: Vec<DailyUserActivityHourRecord>,
    pub workout_exercises: Vec<String>,
    pub workout_muscles: Vec<ExerciseMuscle>,
    pub workout_equipments: Vec<ExerciseEquipment>,
}

#[derive(Debug, Serialize, Deserialize, Clone, FromQueryResult)]
struct SeenItem {
    seen_id: String,
    metadata_id: String,
    metadata_lot: MediaLot,
    last_updated_on: DateTimeUtc,
    finished_on: Option<DateTimeUtc>,
    manual_time_spent: Option<Decimal>,
    book_specifics: Option<BookSpecifics>,
    show_specifics: Option<ShowSpecifics>,
    anime_specifics: Option<AnimeSpecifics>,
    manga_specifics: Option<MangaSpecifics>,
    movie_specifics: Option<MovieSpecifics>,
    music_specifics: Option<MusicSpecifics>,
    podcast_specifics: Option<PodcastSpecifics>,
    video_game_specifics: Option<VideoGameSpecifics>,
    audio_book_specifics: Option<AudioBookSpecifics>,
    visual_novel_specifics: Option<VisualNovelSpecifics>,
    show_extra_information: Option<SeenShowExtraInformation>,
    anime_extra_information: Option<SeenAnimeExtraInformation>,
    manga_extra_information: Option<SeenMangaExtraInformation>,
    podcast_extra_information: Option<SeenPodcastExtraInformation>,
}

fn get_activity_count<'a>(
    activities: &'a mut HashMap<Option<NaiveDate>, DailyUserActivityModel>,
    user_id: &'a String,
    dt: Option<DateTimeUtc>,
    entity_id: String,
    entity_lot: EntityLot,
    metadata_lot: Option<MediaLot>,
    timestamp: DateTimeUtc,
) -> &'a mut DailyUserActivityModel {
    let date = dt.map(|d| d.date_naive());
    let existing = activities.entry(date).or_insert(DailyUserActivityModel {
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

impl StatisticsService {
    fn apply_date_filters<E>(
        query: Select<E>,
        date_range: &ApplicationDateRange,
        start_column: impl ColumnTrait,
        end_column: Option<impl ColumnTrait>,
    ) -> Select<E>
    where
        E: EntityTrait,
    {
        let mut query = query;
        if let Some(start_date) = date_range.start_date {
            query = query.filter(start_column.gte(start_date));
        }
        if let Some(end_date) = date_range.end_date {
            if let Some(end_col) = end_column {
                query = query.filter(end_col.lte(end_date));
            } else {
                query = query.filter(start_column.lte(end_date));
            }
        }
        query
    }

    fn calculate_media_duration(&self, seen: &SeenItem, activity: &mut DailyUserActivityModel) {
        match seen.metadata_lot {
            MediaLot::Show => {
                if let (Some(show_seen), Some(show_extra)) =
                    (&seen.show_specifics, &seen.show_extra_information)
                {
                    if let Some(runtime) = get_show_episode_by_numbers(
                        show_seen,
                        show_extra.season,
                        show_extra.episode,
                    )
                    .and_then(|(_, e)| e.runtime)
                    {
                        activity.show_duration += runtime;
                    }
                }
            }
            MediaLot::Podcast => {
                if let (Some(podcast_seen), Some(podcast_extra)) =
                    (&seen.podcast_specifics, &seen.podcast_extra_information)
                {
                    if let Some(runtime) =
                        get_podcast_episode_by_number(podcast_seen, podcast_extra.episode)
                            .and_then(|e| e.runtime)
                    {
                        activity.podcast_duration += runtime;
                    }
                }
            }
            MediaLot::AudioBook => {
                if let Some(audio_book_extra) = &seen.audio_book_specifics {
                    if let Some(runtime) = audio_book_extra.runtime {
                        activity.audio_book_duration += runtime;
                    }
                }
            }
            MediaLot::Movie => {
                if let Some(movie_extra) = &seen.movie_specifics {
                    if let Some(runtime) = movie_extra.runtime {
                        activity.movie_duration += runtime;
                    }
                }
            }
            MediaLot::Music => {
                if let Some(music_extra) = &seen.music_specifics {
                    if let Some(runtime) = music_extra.duration {
                        activity.music_duration += runtime / 60;
                    }
                }
            }
            MediaLot::Book => {
                if let Some(book_extra) = &seen.book_specifics {
                    if let Some(pages) = book_extra.pages {
                        activity.book_pages += pages;
                    }
                }
            }
            MediaLot::VisualNovel => {
                if let Some(visual_novel_extra) = &seen.visual_novel_specifics {
                    if let Some(runtime) = visual_novel_extra.length {
                        activity.visual_novel_duration += runtime;
                    }
                }
            }
            MediaLot::VideoGame => {
                if let Some(manual_time_spent) = seen.manual_time_spent {
                    activity.video_game_duration +=
                        (manual_time_spent / dec!(60)).to_i32().unwrap_or_default();
                }
            }
            _ => {}
        }
    }

    fn convert_activity_to_item(mut activity: DailyUserActivityModel) -> DailyUserActivityItem {
        activity.hour_records.sort_by_key(|hr| hr.hour);

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

        DailyUserActivityItem {
            day: activity.date.unwrap_or_default(),
            audio_book_count: activity.audio_book_count as i64,
            total_audio_book_duration: activity.audio_book_duration as i64,
            anime_count: activity.anime_count as i64,
            book_count: activity.book_count as i64,
            total_book_pages: activity.book_pages as i64,
            podcast_count: activity.podcast_count as i64,
            total_podcast_duration: activity.podcast_duration as i64,
            manga_count: activity.manga_count as i64,
            movie_count: activity.movie_count as i64,
            total_movie_duration: activity.movie_duration as i64,
            music_count: activity.music_count as i64,
            total_music_duration: activity.music_duration as i64,
            show_count: activity.show_count as i64,
            total_show_duration: activity.show_duration as i64,
            total_video_game_duration: activity.video_game_duration as i64,
            video_game_count: activity.video_game_count as i64,
            visual_novel_count: activity.visual_novel_count as i64,
            total_visual_novel_duration: activity.visual_novel_duration as i64,
            total_workout_personal_bests: activity.workout_personal_bests as i64,
            total_workout_weight: activity.workout_weight as i64,
            total_workout_reps: activity.workout_reps as i64,
            total_workout_distance: activity.workout_distance as i64,
            total_workout_rest_time: activity.workout_rest_time as i64,
            workout_count: activity.workout_count as i64,
            total_workout_duration: activity.workout_duration as i64,
            total_metadata_review_count: activity.metadata_review_count as i64,
            total_collection_review_count: activity.collection_review_count as i64,
            total_metadata_group_review_count: activity.metadata_group_review_count as i64,
            total_person_review_count: activity.person_review_count as i64,
            user_measurement_count: activity.measurement_count as i64,
            total_metadata_count: total_metadata_count as i64,
            total_review_count: total_review_count as i64,
            total_count: total_count as i64,
            total_duration: total_duration as i64,
        }
    }

    pub async fn user_analytics_parameters(
        &self,
        user_id: &String,
    ) -> Result<CachedResponse<ApplicationDateRange>> {
        self.0
            .cache_service
            .get_or_set_with_callback(
                ApplicationCacheKey::UserAnalyticsParameters(UserLevelCacheKey {
                    input: (),
                    user_id: user_id.to_owned(),
                }),
                ApplicationCacheValue::UserAnalyticsParameters,
                || async {
                    let date_ranges = try_join!(
                        Seen::find()
                            .filter(seen::Column::UserId.eq(user_id))
                            .select_only()
                            .column_as(seen::Column::FinishedOn.min(), "min_date")
                            .column_as(seen::Column::FinishedOn.max(), "max_date")
                            .into_tuple::<(Option<DateTimeUtc>, Option<DateTimeUtc>)>()
                            .one(&self.0.db),
                        Workout::find()
                            .filter(workout::Column::UserId.eq(user_id))
                            .select_only()
                            .column_as(workout::Column::EndTime.min(), "min_date")
                            .column_as(workout::Column::EndTime.max(), "max_date")
                            .into_tuple::<(Option<DateTimeUtc>, Option<DateTimeUtc>)>()
                            .one(&self.0.db),
                        Review::find()
                            .filter(review::Column::UserId.eq(user_id))
                            .select_only()
                            .column_as(review::Column::PostedOn.min(), "min_date")
                            .column_as(review::Column::PostedOn.max(), "max_date")
                            .into_tuple::<(Option<DateTimeUtc>, Option<DateTimeUtc>)>()
                            .one(&self.0.db),
                        UserMeasurement::find()
                            .filter(user_measurement::Column::UserId.eq(user_id))
                            .select_only()
                            .column_as(user_measurement::Column::Timestamp.min(), "min_date")
                            .column_as(user_measurement::Column::Timestamp.max(), "max_date")
                            .into_tuple::<(Option<DateTimeUtc>, Option<DateTimeUtc>)>()
                            .one(&self.0.db)
                    )?;

                    let all_dates: Vec<_> =
                        [date_ranges.0, date_ranges.1, date_ranges.2, date_ranges.3]
                            .into_iter()
                            .flatten()
                            .flat_map(|(min, max)| [min, max])
                            .filter_map(|date| date.map(|d| d.date_naive()))
                            .collect();

                    let start_date = all_dates.iter().min().copied();
                    let end_date = all_dates.iter().max().copied();

                    Ok(ApplicationDateRange {
                        start_date,
                        end_date,
                    })
                },
            )
            .await
    }

    pub async fn user_analytics(
        &self,
        user_id: &String,
        input: UserAnalyticsInput,
    ) -> Result<CachedResponse<UserAnalytics>> {
        self.0
            .cache_service
            .get_or_set_with_callback(
                ApplicationCacheKey::UserAnalytics(UserLevelCacheKey {
                    input: input.clone(),
                    user_id: user_id.to_owned(),
                }),
                ApplicationCacheValue::UserAnalytics,
                || async {
                    let mut activities = HashMap::new();
                    let seen_query = Seen::find()
                        .filter(seen::Column::UserId.eq(user_id))
                        .filter(seen::Column::State.eq(SeenState::Completed));
                    let mut seen_stream = Self::apply_date_filters(
                        seen_query,
                        &input.date_range,
                        seen::Column::LastUpdatedOn,
                        None::<seen::Column>,
                    )
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
                    .stream(&self.0.db)
                    .await?;

                    while let Some(seen) = seen_stream.try_next().await? {
                        let activity = get_activity_count(
                            &mut activities,
                            user_id,
                            seen.finished_on,
                            seen.seen_id.clone(),
                            EntityLot::Metadata,
                            Some(seen.metadata_lot),
                            seen.last_updated_on,
                        );

                        self.calculate_media_duration(&seen, activity);

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
                        }
                    }
                    let (exercises, user_exercises) = try_join!(
                        Exercise::find().all(&self.0.db),
                        UserToEntity::find()
                            .filter(user_to_entity::Column::UserId.eq(user_id))
                            .filter(user_to_entity::Column::ExerciseId.is_not_null())
                            .all(&self.0.db)
                    )?;

                    let workout_query = Workout::find().filter(workout::Column::UserId.eq(user_id));
                    let mut workout_stream = Self::apply_date_filters(
                        workout_query,
                        &input.date_range,
                        workout::Column::EndTime,
                        None::<workout::Column>,
                    )
                    .stream(&self.0.db)
                    .await?;

                    while let Some(workout) = workout_stream.try_next().await? {
                        let activity = get_activity_count(
                            &mut activities,
                            user_id,
                            Some(workout.end_time),
                            workout.id.clone(),
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
                        activity.workout_personal_bests +=
                            workout_total.personal_bests_achieved as i32;
                        activity.workout_weight +=
                            workout_total.weight.to_i32().unwrap_or_default();
                        activity.workout_reps += workout_total.reps.to_i32().unwrap_or_default();
                        activity.workout_distance +=
                            workout_total.distance.to_i32().unwrap_or_default();
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
                    let measurement_query = UserMeasurement::find()
                        .filter(user_measurement::Column::UserId.eq(user_id));
                    let mut measurement_stream = Self::apply_date_filters(
                        measurement_query,
                        &input.date_range,
                        user_measurement::Column::Timestamp,
                        None::<user_measurement::Column>,
                    )
                    .stream(&self.0.db)
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
                    let review_query = Review::find().filter(review::Column::UserId.eq(user_id));
                    let mut review_stream = Self::apply_date_filters(
                        review_query,
                        &input.date_range,
                        review::Column::PostedOn,
                        None::<review::Column>,
                    )
                    .stream(&self.0.db)
                    .await?;

                    while let Some(review) = review_stream.try_next().await? {
                        let activity = get_activity_count(
                            &mut activities,
                            user_id,
                            Some(review.posted_on),
                            review.id.clone(),
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
                    let grouped_by = if let Some(group_by) = input.group_by {
                        group_by
                    } else if let (Some(start), Some(end)) =
                        (input.date_range.start_date, input.date_range.end_date)
                    {
                        let num_days = (end - start).num_days() + 1;
                        if num_days >= 500 {
                            DailyUserActivitiesResponseGroupedBy::Year
                        } else if num_days >= 200 {
                            DailyUserActivitiesResponseGroupedBy::Month
                        } else {
                            DailyUserActivitiesResponseGroupedBy::Day
                        }
                    } else {
                        DailyUserActivitiesResponseGroupedBy::Day
                    };

                    let mut items: Vec<DailyUserActivityItem> = if grouped_by
                        == DailyUserActivitiesResponseGroupedBy::AllTime
                    {
                        if activities.is_empty() {
                            vec![]
                        } else {
                            let mut aggregated_activity = DailyUserActivityModel {
                                date: None,
                                user_id: user_id.to_owned(),
                                ..Default::default()
                            };

                            for activity in activities.values() {
                                aggregated_activity.audio_book_count += activity.audio_book_count;
                                aggregated_activity.audio_book_duration +=
                                    activity.audio_book_duration;
                                aggregated_activity.anime_count += activity.anime_count;
                                aggregated_activity.book_count += activity.book_count;
                                aggregated_activity.book_pages += activity.book_pages;
                                aggregated_activity.podcast_count += activity.podcast_count;
                                aggregated_activity.podcast_duration += activity.podcast_duration;
                                aggregated_activity.manga_count += activity.manga_count;
                                aggregated_activity.movie_count += activity.movie_count;
                                aggregated_activity.movie_duration += activity.movie_duration;
                                aggregated_activity.music_count += activity.music_count;
                                aggregated_activity.music_duration += activity.music_duration;
                                aggregated_activity.show_count += activity.show_count;
                                aggregated_activity.show_duration += activity.show_duration;
                                aggregated_activity.video_game_count += activity.video_game_count;
                                aggregated_activity.video_game_duration +=
                                    activity.video_game_duration;
                                aggregated_activity.visual_novel_count +=
                                    activity.visual_novel_count;
                                aggregated_activity.visual_novel_duration +=
                                    activity.visual_novel_duration;
                                aggregated_activity.workout_count += activity.workout_count;
                                aggregated_activity.workout_duration += activity.workout_duration;
                                aggregated_activity.workout_personal_bests +=
                                    activity.workout_personal_bests;
                                aggregated_activity.workout_weight += activity.workout_weight;
                                aggregated_activity.workout_reps += activity.workout_reps;
                                aggregated_activity.workout_distance += activity.workout_distance;
                                aggregated_activity.workout_rest_time += activity.workout_rest_time;
                                aggregated_activity.workout_calories_burnt +=
                                    activity.workout_calories_burnt;
                                aggregated_activity.measurement_count += activity.measurement_count;
                                aggregated_activity.metadata_review_count +=
                                    activity.metadata_review_count;
                                aggregated_activity.collection_review_count +=
                                    activity.collection_review_count;
                                aggregated_activity.metadata_group_review_count +=
                                    activity.metadata_group_review_count;
                                aggregated_activity.person_review_count +=
                                    activity.person_review_count;
                                aggregated_activity.exercise_review_count +=
                                    activity.exercise_review_count;
                                aggregated_activity.person_collection_count +=
                                    activity.person_collection_count;
                                aggregated_activity.metadata_collection_count +=
                                    activity.metadata_collection_count;
                                aggregated_activity.metadata_group_collection_count +=
                                    activity.metadata_group_collection_count;

                                aggregated_activity
                                    .workout_exercises
                                    .extend(activity.workout_exercises.clone());
                                aggregated_activity
                                    .workout_equipments
                                    .extend(activity.workout_equipments.clone());
                                aggregated_activity
                                    .workout_muscles
                                    .extend(activity.workout_muscles.clone());
                                aggregated_activity
                                    .hour_records
                                    .extend(activity.hour_records.clone());
                                aggregated_activity
                                    .entity_ids
                                    .extend(activity.entity_ids.clone());
                            }

                            vec![Self::convert_activity_to_item(aggregated_activity)]
                        }
                    } else {
                        activities
                            .clone()
                            .into_values()
                            .map(Self::convert_activity_to_item)
                            .collect()
                    };

                    if grouped_by != DailyUserActivitiesResponseGroupedBy::AllTime {
                        items.sort_by_key(|item| item.day);
                    }

                    let total_count = items.iter().map(|i| i.total_count).sum();
                    let total_duration = items.iter().map(|i| i.total_duration).sum();
                    let item_count = items.len();

                    let activities_response = DailyUserActivitiesResponse {
                        items,
                        grouped_by,
                        item_count,
                        total_count,
                        total_duration,
                    };
                    let mut hours: Vec<DailyUserActivityHourRecord> = vec![];
                    for activity in activities.values() {
                        for hour in &activity.hour_records {
                            let index = hours.iter().position(|h| h.hour == hour.hour);
                            if let Some(index) = index {
                                hours
                                    .get_mut(index)
                                    .unwrap()
                                    .entities
                                    .extend(hour.entities.clone());
                            } else {
                                hours.push(hour.clone());
                            }
                        }
                    }
                    let workout_reps = activities.values().map(|a| a.workout_reps).sum();
                    let workout_count = activities.values().map(|a| a.workout_count).sum();
                    let workout_weight = activities.values().map(|a| a.workout_weight).sum();
                    let workout_distance = activities.values().map(|a| a.workout_distance).sum();
                    let workout_duration = activities.values().map(|a| a.workout_duration).sum();
                    let workout_rest_time = activities.values().map(|a| a.workout_rest_time).sum();
                    let measurement_count = activities.values().map(|a| a.measurement_count).sum();
                    let workout_calories_burnt =
                        activities.values().map(|a| a.workout_calories_burnt).sum();
                    let workout_personal_bests =
                        activities.values().map(|a| a.workout_personal_bests).sum();

                    let workout_muscles = activities
                        .values()
                        .flat_map(|a| a.workout_muscles.clone())
                        .collect::<HashBag<ExerciseMuscle>>()
                        .into_iter()
                        .map(|(muscle, count)| FitnessAnalyticsMuscle {
                            muscle,
                            count: count.try_into().unwrap(),
                        })
                        .sorted_by_key(|f| Reverse(f.count))
                        .collect_vec();

                    let workout_exercises = activities
                        .values()
                        .flat_map(|a| a.workout_exercises.clone())
                        .collect::<HashBag<String>>()
                        .into_iter()
                        .map(|(exercise, count)| FitnessAnalyticsExercise {
                            exercise,
                            count: count.try_into().unwrap(),
                        })
                        .sorted_by_key(|f| Reverse(f.count))
                        .collect_vec();

                    let workout_equipments = activities
                        .values()
                        .flat_map(|a| a.workout_equipments.clone())
                        .collect::<HashBag<ExerciseEquipment>>()
                        .into_iter()
                        .map(|(equipment, count)| FitnessAnalyticsEquipment {
                            equipment,
                            count: count.try_into().unwrap(),
                        })
                        .sorted_by_key(|f| Reverse(f.count))
                        .collect_vec();

                    let response = UserAnalytics {
                        hours,
                        activities: activities_response,
                        fitness: UserFitnessAnalytics {
                            workout_reps,
                            workout_count,
                            workout_weight,
                            workout_muscles,
                            workout_distance,
                            workout_duration,
                            workout_rest_time,
                            workout_exercises,
                            measurement_count,
                            workout_equipments,
                            workout_personal_bests,
                            workout_calories_burnt,
                        },
                    };
                    Ok(response)
                },
            )
            .await
    }
}
