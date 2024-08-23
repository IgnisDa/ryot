use std::{collections::HashMap, fmt::Write, pin::Pin};

use async_graphql::Result;
use chrono::Utc;
use common_models::UserSummaryData;
use common_utils::{convert_naive_to_utc, ryot_log};
use database_models::{
    daily_user_activity, metadata,
    prelude::{
        DailyUserActivity, Metadata, Review, Seen, UserMeasurement, UserSummary, UserToEntity,
        Workout,
    },
    review, seen, user_measurement, user_summary, user_to_entity, workout,
};
use dependent_models::DailyUserActivitiesResponse;
use enums::{EntityLot, MediaLot, SeenState};
use futures::{Stream, TryStreamExt};
use media_models::{
    AnimeSpecifics, AudioBookSpecifics, BookSpecifics, DailyUserActivitiesInput,
    DailyUserActivitiesResponseGroupedBy, DailyUserActivityItem, MangaSpecifics, MovieSpecifics,
    PodcastSpecifics, SeenAnimeExtraInformation, SeenMangaExtraInformation,
    SeenPodcastExtraInformation, SeenShowExtraInformation, ShowSpecifics, VideoGameSpecifics,
    VisualNovelSpecifics,
};
use rust_decimal::{prelude::ToPrimitive, Decimal};
use sea_orm::{
    prelude::{Date, DateTimeUtc, Expr},
    sea_query::{Alias, Func, OnConflict},
    ActiveModelTrait, ActiveValue, ColumnTrait, DatabaseConnection, DbErr, EntityTrait,
    FromQueryResult, Iden, PaginatorTrait, QueryFilter, QueryOrder, QuerySelect, QueryTrait,
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

async fn get_seen_items_stream<'a>(
    db: &'a DatabaseConnection,
    user_id: &String,
    start_from: Option<DateTimeUtc>,
    is_finished_not_null: bool,
) -> Result<Pin<Box<dyn Stream<Item = Result<SeenItem, DbErr>> + Send + 'a>>> {
    let mut initial_filter = Seen::find()
        .filter(seen::Column::UserId.eq(user_id))
        .filter(seen::Column::State.eq(SeenState::Completed))
        .apply_if(start_from, |query, v| {
            query.filter(seen::Column::LastUpdatedOn.gt(v))
        });
    if is_finished_not_null {
        initial_filter = initial_filter.filter(seen::Column::FinishedOn.is_not_null());
    }
    let seen_items_stream = initial_filter
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

    Ok(seen_items_stream)
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
        user_id: String,
        input: DailyUserActivitiesInput,
    ) -> Result<DailyUserActivitiesResponse> {
        struct DateTrunc;
        impl Iden for DateTrunc {
            fn unquoted(&self, s: &mut dyn Write) {
                write!(s, "DATE_TRUNC").unwrap();
            }
        }
        let precondition = DailyUserActivity::find()
            .filter(daily_user_activity::Column::UserId.eq(&user_id))
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
                daily_user_activity::Column::TotalReviewCount.sum(),
                "total_review_count",
            )
            .column_as(
                daily_user_activity::Column::WorkoutCount.sum(),
                "workout_count",
            )
            .column_as(
                daily_user_activity::Column::MeasurementCount.sum(),
                "measurement_count",
            )
            .column_as(
                daily_user_activity::Column::AudioBookCount.sum(),
                "audio_book_count",
            )
            .column_as(daily_user_activity::Column::AnimeCount.sum(), "anime_count")
            .column_as(daily_user_activity::Column::BookCount.sum(), "book_count")
            .column_as(
                daily_user_activity::Column::PodcastCount.sum(),
                "podcast_count",
            )
            .column_as(daily_user_activity::Column::MangaCount.sum(), "manga_count")
            .column_as(daily_user_activity::Column::MovieCount.sum(), "movie_count")
            .column_as(daily_user_activity::Column::ShowCount.sum(), "show_count")
            .column_as(
                daily_user_activity::Column::VideoGameCount.sum(),
                "video_game_count",
            )
            .column_as(
                daily_user_activity::Column::VisualNovelCount.sum(),
                "visual_novel_count",
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

    pub async fn latest_user_summary(&self, user_id: &String) -> Result<user_summary::Model> {
        let ls = UserSummary::find_by_id(user_id)
            .one(&self.db)
            .await?
            .unwrap_or_default();
        Ok(ls)
    }

    #[tracing::instrument(skip(self))]
    async fn calculate_user_summary(
        &self,
        user_id: &String,
        calculate_from_beginning: bool,
    ) -> Result<()> {
        let (mut ls, start_from) = match calculate_from_beginning {
            true => {
                UserToEntity::update_many()
                    .filter(user_to_entity::Column::UserId.eq(user_id))
                    .col_expr(
                        user_to_entity::Column::MetadataUnitsConsumed,
                        Expr::value(Some(0)),
                    )
                    .exec(&self.db)
                    .await?;
                (UserSummaryData::default(), None)
            }
            false => {
                let here = self.latest_user_summary(user_id).await?;
                let time = here.calculated_on;
                (here.data, Some(time))
            }
        };

        ryot_log!(debug, "Calculating numbers summary for user: {:?}", ls);

        let metadata_num_reviews = Review::find()
            .filter(review::Column::UserId.eq(user_id))
            .filter(review::Column::MetadataId.is_not_null())
            .apply_if(start_from, |query, v| {
                query.filter(review::Column::PostedOn.gt(v))
            })
            .count(&self.db)
            .await?;

        ryot_log!(
            debug,
            "Calculated number of metadata reviews for user: {:?}",
            metadata_num_reviews
        );

        let person_num_reviews = Review::find()
            .filter(review::Column::UserId.eq(user_id))
            .filter(review::Column::PersonId.is_not_null())
            .apply_if(start_from, |query, v| {
                query.filter(review::Column::PostedOn.gt(v))
            })
            .count(&self.db)
            .await?;

        ryot_log!(
            debug,
            "Calculated number of person reviews for user: {:?}",
            person_num_reviews
        );

        let num_measurements = UserMeasurement::find()
            .filter(user_measurement::Column::UserId.eq(user_id))
            .apply_if(start_from, |query, v| {
                query.filter(user_measurement::Column::Timestamp.gt(v))
            })
            .count(&self.db)
            .await?;

        ryot_log!(
            debug,
            "Calculated number measurements for user: {:?}",
            num_measurements
        );

        let num_workouts = Workout::find()
            .filter(workout::Column::UserId.eq(user_id))
            .apply_if(start_from, |query, v| {
                query.filter(workout::Column::EndTime.gt(v))
            })
            .count(&self.db)
            .await?;

        ryot_log!(
            debug,
            "Calculated number workouts for user: {:?}",
            num_workouts
        );

        let num_metadata_interacted_with = UserToEntity::find()
            .filter(user_to_entity::Column::UserId.eq(user_id))
            .filter(user_to_entity::Column::MetadataId.is_not_null())
            .apply_if(start_from, |query, v| {
                query.filter(user_to_entity::Column::LastUpdatedOn.gt(v))
            })
            .count(&self.db)
            .await?;

        ryot_log!(
            debug,
            "Calculated number metadata interacted with for user: {:?}",
            num_metadata_interacted_with
        );

        let num_people_interacted_with = UserToEntity::find()
            .filter(user_to_entity::Column::UserId.eq(user_id))
            .filter(user_to_entity::Column::PersonId.is_not_null())
            .apply_if(start_from, |query, v| {
                query.filter(user_to_entity::Column::LastUpdatedOn.gt(v))
            })
            .count(&self.db)
            .await?;

        ryot_log!(
            debug,
            "Calculated number people interacted with for user: {:?}",
            num_people_interacted_with
        );

        let num_exercises_interacted_with = UserToEntity::find()
            .filter(user_to_entity::Column::UserId.eq(user_id))
            .filter(user_to_entity::Column::ExerciseId.is_not_null())
            .apply_if(start_from, |query, v| {
                query.filter(user_to_entity::Column::LastUpdatedOn.gt(v))
            })
            .count(&self.db)
            .await?;

        ryot_log!(
            debug,
            "Calculated number exercises interacted with for user: {:?}",
            num_exercises_interacted_with
        );

        let (total_workout_time, total_workout_weight) = Workout::find()
            .filter(workout::Column::UserId.eq(user_id))
            .select_only()
            .column_as(
                Expr::cust("coalesce((sum(duration) / 60)::numeric, 0)"),
                "minutes",
            )
            .column_as(
                Expr::cust("coalesce(sum((summary -> 'total' ->> 'weight')::numeric), 0)"),
                "weight",
            )
            .apply_if(start_from, |query, v| {
                query.filter(workout::Column::EndTime.gt(v))
            })
            .into_tuple::<(Decimal, Decimal)>()
            .one(&self.db)
            .await?
            .unwrap();

        ryot_log!(
            debug,
            "Calculated total workout time for user: {:?}",
            total_workout_time
        );

        ls.media.metadata_overall.reviewed += metadata_num_reviews;
        ls.media.metadata_overall.interacted_with += num_metadata_interacted_with;
        ls.media.people_overall.reviewed += person_num_reviews;
        ls.media.people_overall.interacted_with += num_people_interacted_with;
        ls.fitness.measurements_recorded += num_measurements;
        ls.fitness.exercises_interacted_with += num_exercises_interacted_with;
        ls.fitness.workouts.recorded += num_workouts;
        ls.fitness.workouts.duration += total_workout_time;
        ls.fitness.workouts.weight += total_workout_weight;

        ryot_log!(debug, "Calculated numbers summary for user: {:?}", ls);

        let mut seen_items = get_seen_items_stream(&self.db, user_id, start_from, false).await?;

        while let Some(seen) = seen_items.try_next().await.unwrap() {
            ryot_log!(debug, "Processing seen id {:?}", seen.seen_id);
            let mut units_consumed = None;
            if let Some(item) = seen.audio_book_specifics {
                ls.unique_items.audio_books.insert(seen.metadata_id.clone());
                if let Some(r) = item.runtime {
                    ls.media.audio_books.runtime += r;
                    units_consumed = Some(r);
                }
            } else if let Some(item) = seen.book_specifics {
                ls.unique_items.books.insert(seen.metadata_id.clone());
                if let Some(pg) = item.pages {
                    ls.media.books.pages += pg;
                    units_consumed = Some(pg);
                }
            } else if let Some(item) = seen.movie_specifics {
                ls.unique_items.movies.insert(seen.metadata_id.clone());
                if let Some(r) = item.runtime {
                    ls.media.movies.runtime += r;
                    units_consumed = Some(r);
                }
            } else if let Some(_item) = seen.anime_specifics {
                ls.unique_items.anime.insert(seen.metadata_id.clone());
                if let Some(s) = seen.anime_extra_information.to_owned() {
                    if let Some(episode) = s.episode {
                        ls.unique_items
                            .anime_episodes
                            .insert((seen.metadata_id.clone(), episode));
                        units_consumed = Some(1);
                    }
                }
            } else if let Some(_item) = seen.manga_specifics {
                ls.unique_items.manga.insert(seen.metadata_id.clone());
                if let Some(s) = seen.manga_extra_information.to_owned() {
                    units_consumed = Some(1);
                    if let Some(chapter) = s.chapter {
                        ls.unique_items
                            .manga_chapters
                            .insert((seen.metadata_id.clone(), chapter));
                    }
                    if let Some(volume) = s.volume {
                        ls.unique_items
                            .manga_volumes
                            .insert((seen.metadata_id.clone(), volume));
                    }
                }
            } else if let Some(item) = seen.show_specifics {
                ls.unique_items.shows.insert(seen.metadata_id.clone());
                if let Some(s) = seen.show_extra_information.to_owned() {
                    if let Some((season, episode)) = item.get_episode(s.season, s.episode) {
                        if let Some(r) = episode.runtime {
                            ls.media.shows.runtime += r;
                            units_consumed = Some(r);
                        }
                        ls.unique_items.show_episodes.insert((
                            seen.metadata_id.clone(),
                            season.season_number,
                            episode.episode_number,
                        ));
                        ls.unique_items
                            .show_seasons
                            .insert((seen.metadata_id.clone(), season.season_number));
                    }
                };
            } else if let Some(item) = seen.podcast_specifics {
                ls.unique_items.podcasts.insert(seen.metadata_id.clone());
                if let Some(s) = seen.podcast_extra_information.to_owned() {
                    if let Some(episode) = item.episode_by_number(s.episode) {
                        if let Some(r) = episode.runtime {
                            ls.media.podcasts.runtime += r;
                            units_consumed = Some(r);
                        }
                        ls.unique_items
                            .podcast_episodes
                            .insert((seen.metadata_id.clone(), s.episode));
                    }
                }
            } else if let Some(_item) = seen.video_game_specifics {
                ls.unique_items.video_games.insert(seen.metadata_id.clone());
            } else if let Some(item) = seen.visual_novel_specifics {
                ls.unique_items
                    .visual_novels
                    .insert(seen.metadata_id.clone());
                if let Some(r) = item.length {
                    ls.media.visual_novels.runtime += r;
                    units_consumed = Some(r);
                }
            };

            if let Some(consumed_update) = units_consumed {
                UserToEntity::update_many()
                    .filter(user_to_entity::Column::UserId.eq(user_id))
                    .filter(user_to_entity::Column::MetadataId.eq(&seen.metadata_id))
                    .col_expr(
                        user_to_entity::Column::MetadataUnitsConsumed,
                        Expr::expr(Func::coalesce([
                            Expr::col(user_to_entity::Column::MetadataUnitsConsumed).into(),
                            Expr::val(0).into(),
                        ]))
                        .add(consumed_update),
                    )
                    .exec(&self.db)
                    .await?;
            }
        }

        ls.media.podcasts.played_episodes = ls.unique_items.podcast_episodes.len();
        ls.media.podcasts.played = ls.unique_items.podcasts.len();

        ls.media.shows.watched_episodes = ls.unique_items.show_episodes.len();
        ls.media.shows.watched_seasons = ls.unique_items.show_seasons.len();
        ls.media.shows.watched = ls.unique_items.shows.len();

        ls.media.anime.episodes = ls.unique_items.anime_episodes.len();
        ls.media.anime.watched = ls.unique_items.anime.len();

        ls.media.manga.read = ls.unique_items.manga.len();
        ls.media.manga.chapters = ls.unique_items.manga_chapters.len();

        ls.media.video_games.played = ls.unique_items.video_games.len();
        ls.media.audio_books.played = ls.unique_items.audio_books.len();
        ls.media.books.read = ls.unique_items.books.len();
        ls.media.movies.watched = ls.unique_items.movies.len();
        ls.media.visual_novels.played = ls.unique_items.visual_novels.len();

        let usr = UserSummary::insert(user_summary::ActiveModel {
            data: ActiveValue::Set(ls),
            calculated_on: ActiveValue::Set(Utc::now()),
            user_id: ActiveValue::Set(user_id.to_owned()),
            is_fresh: ActiveValue::Set(calculate_from_beginning),
        })
        .on_conflict(
            OnConflict::column(user_summary::Column::UserId)
                .update_columns([
                    user_summary::Column::Data,
                    user_summary::Column::IsFresh,
                    user_summary::Column::CalculatedOn,
                ])
                .to_owned(),
        )
        .exec_with_returning(&self.db)
        .await?;
        ryot_log!(debug, "Calculated summary for user: {:?}", usr.user_id);
        Ok(())
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

        let mut seen_stream = get_seen_items_stream(
            &self.db,
            user_id,
            Some(convert_naive_to_utc(start_from)),
            true,
        )
        .await?;
        while let Some(seen) = seen_stream.try_next().await? {
            let date = seen.finished_on.unwrap();
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
            activity.workout_personal_best += workout_total.personal_bests_achieved as i32;
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
        self.calculate_user_summary(user_id, calculate_from_beginning)
            .await?;
        Ok(())
    }
}
