use std::{cmp::Reverse, collections::HashMap, sync::Arc};

use anyhow::Result;
use application_utils::{get_podcast_episode_by_number, get_show_episode_by_numbers};
use chrono::{NaiveDate, Timelike};
use common_models::{
    ApplicationDateRange, DailyUserActivitiesResponseGroupedBy, DailyUserActivityHourRecord,
    DailyUserActivityHourRecordEntity, UserAnalyticsInput, UserLevelCacheKey,
};
use database_models::{
    daily_user_activity, metadata,
    prelude::{
        DailyUserActivity, Exercise, Metadata, Review, Seen, UserMeasurement, UserToEntity, Workout,
    },
    review, seen, user_measurement, user_to_entity, workout,
};
use dependent_models::{
    ApplicationCacheKey, ApplicationCacheValue, CachedResponse, DailyUserActivitiesResponse,
    DailyUserActivityItem, FitnessAnalyticsEquipment, FitnessAnalyticsExercise,
    FitnessAnalyticsMuscle, UserAnalytics, UserFitnessAnalytics,
};
use dependent_utils::calculate_user_activities_and_summary;
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
    ColumnTrait, DerivePartialModel, EntityTrait, FromQueryResult, QueryFilter, QuerySelect,
    QueryTrait, Select, prelude::DateTimeUtc,
};
use serde::{Deserialize, Serialize};
use supporting_service::SupportingService;

pub struct StatisticsService(pub Arc<SupportingService>);

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
    activities: &'a mut HashMap<Option<NaiveDate>, daily_user_activity::Model>,
    user_id: &'a String,
    dt: Option<DateTimeUtc>,
    entity_id: String,
    entity_lot: EntityLot,
    metadata_lot: Option<MediaLot>,
    timestamp: DateTimeUtc,
) -> &'a mut daily_user_activity::Model {
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

    fn calculate_media_duration(&self, seen: &SeenItem, activity: &mut daily_user_activity::Model) {
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

    fn convert_activity_to_item(mut activity: daily_user_activity::Model) -> DailyUserActivityItem {
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

    pub async fn calculate_user_activities_and_summary(
        &self,
        user_id: &String,
        calculate_from_beginning: bool,
    ) -> Result<()> {
        calculate_user_activities_and_summary(user_id, &self.0, calculate_from_beginning).await
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

    async fn daily_user_activities(
        &self,
        user_id: &String,
        input: UserAnalyticsInput,
    ) -> Result<DailyUserActivitiesResponse> {
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

        let measurement_query =
            UserMeasurement::find().filter(user_measurement::Column::UserId.eq(user_id));
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

        let mut items: Vec<DailyUserActivityItem> = activities
            .into_values()
            .map(Self::convert_activity_to_item)
            .collect();

        items.sort_by_key(|item| item.day);

        let total_count = items.iter().map(|i| i.total_count).sum();
        let total_duration = items.iter().map(|i| i.total_duration).sum();
        let item_count = items.len();

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

        Ok(DailyUserActivitiesResponse {
            items,
            grouped_by,
            item_count,
            total_count,
            total_duration,
        })
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
                    #[derive(Debug, DerivePartialModel, FromQueryResult)]
                    #[sea_orm(entity = "DailyUserActivity")]
                    pub struct CustomFitnessAnalytics {
                        pub workout_reps: i32,
                        pub workout_count: i32,
                        pub workout_weight: i32,
                        pub workout_duration: i32,
                        pub workout_distance: i32,
                        pub workout_rest_time: i32,
                        pub measurement_count: i32,
                        pub workout_personal_bests: i32,
                        pub workout_calories_burnt: i32,
                        pub workout_exercises: Vec<String>,
                        pub workout_muscles: Vec<ExerciseMuscle>,
                        pub workout_equipments: Vec<ExerciseEquipment>,
                        pub hour_records: Vec<DailyUserActivityHourRecord>,
                    }
                    let items = DailyUserActivity::find()
                        .filter(daily_user_activity::Column::UserId.eq(user_id))
                        .apply_if(input.date_range.start_date, |query, v| {
                            query.filter(daily_user_activity::Column::Date.gte(v))
                        })
                        .apply_if(input.date_range.end_date, |query, v| {
                            query.filter(daily_user_activity::Column::Date.lte(v))
                        })
                        .into_partial_model::<CustomFitnessAnalytics>()
                        .all(&self.0.db)
                        .await?;
                    let mut hours: Vec<DailyUserActivityHourRecord> = vec![];
                    items.iter().for_each(|item| {
                        for hour in item.hour_records.clone() {
                            let index = hours.iter().position(|h| h.hour == hour.hour);
                            if let Some(index) = index {
                                hours.get_mut(index).unwrap().entities.extend(hour.entities);
                            } else {
                                hours.push(hour);
                            }
                        }
                    });
                    let workout_reps = items.iter().map(|i| i.workout_reps).sum();
                    let workout_count = items.iter().map(|i| i.workout_count).sum();
                    let workout_weight = items.iter().map(|i| i.workout_weight).sum();
                    let workout_distance = items.iter().map(|i| i.workout_distance).sum();
                    let workout_duration = items.iter().map(|i| i.workout_duration).sum();
                    let workout_rest_time = items.iter().map(|i| i.workout_rest_time).sum();
                    let measurement_count = items.iter().map(|i| i.measurement_count).sum();
                    let workout_calories_burnt =
                        items.iter().map(|i| i.workout_calories_burnt).sum();
                    let workout_personal_bests =
                        items.iter().map(|i| i.workout_personal_bests).sum();
                    let workout_muscles = items
                        .iter()
                        .flat_map(|i| i.workout_muscles.clone())
                        .collect::<HashBag<ExerciseMuscle>>()
                        .into_iter()
                        .map(|(muscle, count)| FitnessAnalyticsMuscle {
                            muscle,
                            count: count.try_into().unwrap(),
                        })
                        .sorted_by_key(|f| Reverse(f.count))
                        .collect_vec();
                    let workout_exercises = items
                        .iter()
                        .flat_map(|i| i.workout_exercises.clone())
                        .collect::<HashBag<String>>()
                        .into_iter()
                        .map(|(exercise_id, count)| FitnessAnalyticsExercise {
                            exercise: exercise_id,
                            count: count.try_into().unwrap(),
                        })
                        .sorted_by_key(|f| Reverse(f.count))
                        .collect_vec();
                    let workout_equipments = items
                        .iter()
                        .flat_map(|i| i.workout_equipments.clone())
                        .collect::<HashBag<ExerciseEquipment>>()
                        .into_iter()
                        .map(|(equipment, count)| FitnessAnalyticsEquipment {
                            equipment,
                            count: count.try_into().unwrap(),
                        })
                        .sorted_by_key(|f| Reverse(f.count))
                        .collect_vec();
                    let activities = self.daily_user_activities(user_id, input).await?;
                    let response = UserAnalytics {
                        hours,
                        activities,
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
