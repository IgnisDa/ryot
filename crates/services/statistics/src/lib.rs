use std::{collections::HashMap, fmt::Write};

use async_graphql::Result;
use common_utils::ryot_log;
use database_models::{
    daily_user_activity, metadata,
    prelude::{DailyUserActivity, Metadata, Review, Seen, UserMeasurement, Workout},
    review, seen, user_measurement, workout,
};
use dependent_models::DailyUserActivitiesResponse;
use enums::{EntityLot, MediaLot, SeenState};
use futures::TryStreamExt;
use media_models::{
    AnimeSpecifics, AudioBookSpecifics, BookSpecifics, DailyUserActivitiesInput,
    DailyUserActivitiesResponseGroupedBy, DailyUserActivityItem, MangaSpecifics, MovieSpecifics,
    PodcastSpecifics, SeenAnimeExtraInformation, SeenMangaExtraInformation,
    SeenPodcastExtraInformation, SeenShowExtraInformation, ShowSpecifics, VideoGameSpecifics,
    VisualNovelSpecifics,
};
use rust_decimal::prelude::ToPrimitive;
use sea_orm::{
    prelude::{Date, DateTimeUtc, Expr},
    sea_query::{Alias, Func},
    ActiveModelTrait, ActiveValue, ColumnTrait, DatabaseConnection, EntityTrait, FromQueryResult,
    Iden, QueryFilter, QueryOrder, QuerySelect, QueryTrait,
};
use serde::{Deserialize, Serialize};

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

#[derive(Debug)]
pub struct StatisticsService {
    db: DatabaseConnection,
}

impl StatisticsService {
    pub fn new(db: &DatabaseConnection) -> Self {
        Self { db: db.clone() }
    }

    pub async fn daily_user_activities(
        &self,
        user_id: &String,
        input: DailyUserActivitiesInput,
    ) -> Result<DailyUserActivitiesResponse> {
        struct DateTrunc;
        impl Iden for DateTrunc {
            fn unquoted(&self, s: &mut dyn Write) {
                write!(s, "DATE_TRUNC").unwrap();
            }
        }
        let precondition = DailyUserActivity::find()
            .filter(daily_user_activity::Column::UserId.eq(user_id))
            .apply_if(input.end_date, |query, v| {
                query.filter(daily_user_activity::Column::Date.lte(v))
            })
            .apply_if(input.start_date, |query, v| {
                query.filter(daily_user_activity::Column::Date.gte(v))
            })
            .select_only();
        let grouped_by = if let Some(group_by) = input.group_by {
            group_by
        } else {
            let total = precondition
                .clone()
                .expr_as(
                    daily_user_activity::Column::Date
                        .max()
                        .sub(daily_user_activity::Column::Date.min())
                        .add(1),
                    "num_days",
                )
                .into_tuple::<Option<i32>>()
                .one(&self.db)
                .await?;
            if let Some(Some(num_days)) = total {
                if num_days >= 500 {
                    DailyUserActivitiesResponseGroupedBy::Year
                } else if num_days >= 200 {
                    DailyUserActivitiesResponseGroupedBy::Month
                } else {
                    DailyUserActivitiesResponseGroupedBy::Day
                }
            } else {
                DailyUserActivitiesResponseGroupedBy::Day
            }
        };
        let day_alias = Expr::col(Alias::new("day"));
        let items = precondition
            .column_as(
                Expr::expr(Func::cast_as(
                    Func::cust(DateTrunc)
                        .arg(Expr::val(grouped_by.to_string()))
                        .arg(daily_user_activity::Column::Date.into_expr()),
                    Alias::new("DATE"),
                )),
                "day",
            )
            .column_as(
                daily_user_activity::Column::MetadataReviewCount.sum(),
                "total_metadata_review_count",
            )
            .column_as(
                daily_user_activity::Column::CollectionReviewCount.sum(),
                "total_collection_review_count",
            )
            .column_as(
                daily_user_activity::Column::MetadataGroupReviewCount.sum(),
                "total_metadata_group_review_count",
            )
            .column_as(
                daily_user_activity::Column::PersonReviewCount.sum(),
                "total_person_review_count",
            )
            .column_as(
                daily_user_activity::Column::MeasurementCount.sum(),
                "measurement_count",
            )
            .column_as(
                daily_user_activity::Column::WorkoutCount.sum(),
                "workout_count",
            )
            .column_as(
                daily_user_activity::Column::WorkoutDuration.sum(),
                "total_workout_duration",
            )
            .column_as(
                daily_user_activity::Column::AudioBookCount.sum(),
                "audio_book_count",
            )
            .column_as(
                daily_user_activity::Column::AudioBookDuration.sum(),
                "total_audio_book_duration",
            )
            .column_as(daily_user_activity::Column::AnimeCount.sum(), "anime_count")
            .column_as(daily_user_activity::Column::BookCount.sum(), "book_count")
            .column_as(
                daily_user_activity::Column::BookPages.sum(),
                "total_book_pages",
            )
            .column_as(
                daily_user_activity::Column::PodcastCount.sum(),
                "podcast_count",
            )
            .column_as(
                daily_user_activity::Column::PodcastDuration.sum(),
                "total_podcast_duration",
            )
            .column_as(daily_user_activity::Column::MangaCount.sum(), "manga_count")
            .column_as(daily_user_activity::Column::MovieCount.sum(), "movie_count")
            .column_as(
                daily_user_activity::Column::MovieDuration.sum(),
                "total_movie_duration",
            )
            .column_as(daily_user_activity::Column::ShowCount.sum(), "show_count")
            .column_as(
                daily_user_activity::Column::ShowDuration.sum(),
                "total_show_duration",
            )
            .column_as(
                daily_user_activity::Column::VideoGameCount.sum(),
                "video_game_count",
            )
            .column_as(
                daily_user_activity::Column::VisualNovelCount.sum(),
                "visual_novel_count",
            )
            .column_as(
                daily_user_activity::Column::VisualNovelDuration.sum(),
                "total_visual_novel_duration",
            )
            .column_as(
                daily_user_activity::Column::WorkoutPersonalBests.sum(),
                "total_workout_personal_bests",
            )
            .column_as(
                daily_user_activity::Column::WorkoutWeight.sum(),
                "total_workout_weight",
            )
            .column_as(
                daily_user_activity::Column::WorkoutReps.sum(),
                "total_workout_reps",
            )
            .column_as(
                daily_user_activity::Column::WorkoutDistance.sum(),
                "total_workout_distance",
            )
            .column_as(
                daily_user_activity::Column::WorkoutRestTime.sum(),
                "total_workout_rest_time",
            )
            .column_as(
                daily_user_activity::Column::TotalMetadataCount.sum(),
                "total_metadata_count",
            )
            .column_as(
                daily_user_activity::Column::TotalReviewCount.sum(),
                "total_review_count",
            )
            .column_as(daily_user_activity::Column::TotalCount.sum(), "total_count")
            .column_as(
                daily_user_activity::Column::TotalDuration.sum(),
                "total_duration",
            )
            .group_by(day_alias.clone())
            .order_by_asc(day_alias)
            .into_model::<DailyUserActivityItem>()
            .all(&self.db)
            .await
            .unwrap();
        let total_count = items.iter().map(|i| i.total_count).sum();
        let total_duration = items.iter().map(|i| i.total_duration).sum();
        let item_count = items.len();
        Ok(DailyUserActivitiesResponse {
            items,
            grouped_by,
            item_count,
            total_count,
            total_duration,
        })
    }

    pub async fn latest_user_summary(&self, user_id: &String) -> Result<DailyUserActivityItem> {
        let ls = self
            .daily_user_activities(
                user_id,
                DailyUserActivitiesInput {
                    group_by: Some(DailyUserActivitiesResponseGroupedBy::Millennium),
                    ..Default::default()
                },
            )
            .await?;
        Ok(ls.items.last().cloned().unwrap_or_default())
    }

    #[tracing::instrument(skip(self))]
    async fn calculate_user_activities(
        &self,
        user_id: &String,
        calculate_from_beginning: bool,
    ) -> Result<()> {
        type Tracker = HashMap<Date, daily_user_activity::Model>;

        let start_from = match calculate_from_beginning {
            true => {
                DailyUserActivity::delete_many()
                    .filter(daily_user_activity::Column::UserId.eq(user_id))
                    .exec(&self.db)
                    .await?;
                Date::default()
            }
            false => DailyUserActivity::find()
                .filter(daily_user_activity::Column::UserId.eq(user_id))
                .order_by_desc(daily_user_activity::Column::Date)
                .one(&self.db)
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
        ) -> &'a mut daily_user_activity::Model {
            ryot_log!(debug, "Updating activity counts for id: {:?}", entity_id);
            let existing = activities
                .entry(date)
                .or_insert(daily_user_activity::Model {
                    date,
                    user_id: user_id.to_owned(),
                    ..Default::default()
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
            .stream(&self.db)
            .await?;

        while let Some(seen) = seen_stream.try_next().await? {
            let default_date = Date::from_ymd_opt(2023, 4, 3).unwrap(); // DEV: The first commit of Ryot
            let date = seen.finished_on.unwrap_or(default_date);
            let activity = get_activity_count(seen.seen_id, &mut activities, user_id, date);
            if let (Some(show_seen), Some(show_extra)) =
                (seen.show_specifics, seen.show_extra_information)
            {
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
                MediaLot::Show => activity.show_count += 1,
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
            .stream(&self.db)
            .await?;
        while let Some(item) = workout_stream.try_next().await? {
            let date = item.end_time.date_naive();
            let activity = get_activity_count(item.id, &mut activities, user_id, date);
            activity.workout_count += 1;
            activity.workout_duration += item.duration / 60;
            let workout_total = item.summary.total;
            activity.workout_personal_bests += workout_total.personal_bests_achieved as i32;
            activity.workout_weight += workout_total.weight.to_i32().unwrap_or_default();
            activity.workout_reps += workout_total.reps.to_i32().unwrap_or_default();
            activity.workout_distance += workout_total.distance.to_i32().unwrap_or_default();
            activity.workout_rest_time += workout_total.rest_time as i32;
        }

        let mut measurement_stream = UserMeasurement::find()
            .filter(user_measurement::Column::UserId.eq(user_id))
            .filter(user_measurement::Column::Timestamp.gte(start_from))
            .stream(&self.db)
            .await?;
        while let Some(item) = measurement_stream.try_next().await? {
            let date = item.timestamp.date_naive();
            let activity =
                get_activity_count(item.timestamp.to_string(), &mut activities, user_id, date);
            activity.measurement_count += 1;
        }

        let mut review_stream = Review::find()
            .filter(review::Column::UserId.eq(user_id))
            .filter(review::Column::PostedOn.gte(start_from))
            .stream(&self.db)
            .await?;
        while let Some(item) = review_stream.try_next().await? {
            let date = item.posted_on.date_naive();
            let activity = get_activity_count(item.id, &mut activities, user_id, date);
            match item.entity_lot {
                EntityLot::Metadata => activity.metadata_review_count += 1,
                EntityLot::Person => activity.person_review_count += 1,
                EntityLot::MetadataGroup => activity.metadata_group_review_count += 1,
                EntityLot::Collection => activity.collection_review_count += 1,
                _ => {}
            }
        }

        for (_, activity) in activities.into_iter() {
            let total_review_count = activity.metadata_review_count
                + activity.collection_review_count
                + activity.metadata_group_review_count
                + activity.person_review_count;
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
            let mut model: daily_user_activity::ActiveModel = activity.into();
            model.total_review_count = ActiveValue::Set(total_review_count);
            model.total_metadata_count = ActiveValue::Set(total_metadata_count);
            model.total_count = ActiveValue::Set(total_count);
            model.total_duration = ActiveValue::Set(total_duration);
            model.insert(&self.db).await.ok();
        }

        Ok(())
    }

    pub async fn calculate_user_activities_and_summary(
        &self,
        user_id: &String,
        calculate_from_beginning: bool,
    ) -> Result<()> {
        self.calculate_user_activities(user_id, calculate_from_beginning)
            .await?;
        Ok(())
    }
}
