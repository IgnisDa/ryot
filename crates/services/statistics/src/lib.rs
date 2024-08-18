use std::collections::HashMap;

use async_graphql::Result;
use chrono::{Datelike, Utc};
use common_models::UserSummaryData;
use database_models::{
    daily_user_activity, metadata,
    prelude::{
        DailyUserActivity, Metadata, Review, Seen, UserMeasurement, UserSummary, UserToEntity,
        Workout,
    },
    review, seen, user_measurement, user_summary, user_to_entity, workout,
};
use database_utils::consolidate_activities;
use dependent_models::{DailyUserActivitiesResponse, DailyUserActivitiesResponseGroupedBy};
use futures::TryStreamExt;
use media_models::{
    AnimeSpecifics, AudioBookSpecifics, BookSpecifics, DailyUserActivitiesInput, MangaSpecifics,
    MovieSpecifics, PodcastSpecifics, SeenAnimeExtraInformation, SeenMangaExtraInformation,
    SeenPodcastExtraInformation, SeenShowExtraInformation, ShowSpecifics, VideoGameSpecifics,
    VisualNovelSpecifics,
};
use rust_decimal::Decimal;
use sea_orm::{
    prelude::{Date, Expr},
    sea_query::{Func, OnConflict},
    ActiveValue, ColumnTrait, DatabaseConnection, EntityTrait, FromQueryResult, PaginatorTrait,
    QueryFilter, QuerySelect, QueryTrait,
};
use serde::{Deserialize, Serialize};

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
        static MAX_DAILY_USER_ACTIVITIES: usize = 30;
        let items = DailyUserActivity::find()
            .filter(daily_user_activity::Column::UserId.eq(&user_id))
            .apply_if(input.end_date, |query, v| {
                query.filter(daily_user_activity::Column::Date.lte(v))
            })
            .apply_if(input.start_date, |query, v| {
                query.filter(daily_user_activity::Column::Date.gte(v))
            })
            .all(&self.db)
            .await?;
        let grouped_by = match items.len() > MAX_DAILY_USER_ACTIVITIES {
            true => DailyUserActivitiesResponseGroupedBy::Month,
            false => DailyUserActivitiesResponseGroupedBy::Day,
        };
        let items = match grouped_by {
            DailyUserActivitiesResponseGroupedBy::Day => items,
            DailyUserActivitiesResponseGroupedBy::Month => {
                let mut grouped_activities: HashMap<Date, Vec<_>> = HashMap::new();
                for item in items {
                    let start_of_month = item.date.with_day(1).unwrap();
                    grouped_activities
                        .entry(start_of_month)
                        .and_modify(|e| e.push(item.clone()))
                        .or_insert(vec![item.clone()]);
                }
                let mut items = vec![];
                for (date, activities) in grouped_activities.into_iter() {
                    let consolidated_activity = consolidate_activities(activities);
                    items.push(daily_user_activity::Model {
                        date,
                        ..consolidated_activity
                    });
                }
                items.sort_by_key(|i| i.date);
                items
            }
        };
        let hours = items.iter().flat_map(|i| i.hour_counts.clone());
        let hours = hours.fold(HashMap::new(), |mut acc, i| {
            acc.entry(i.hour)
                .and_modify(|e| *e += i.count)
                .or_insert(i.count);
            acc
        });
        let most_active_hour = hours.iter().max_by_key(|(_, v)| *v).map(|(k, _)| *k);
        let total_count = items.iter().map(|i| i.total_counts).sum();
        Ok(DailyUserActivitiesResponse {
            items,
            grouped_by,
            total_count,
            most_active_hour,
        })
    }

    pub async fn latest_user_summary(&self, user_id: &String) -> Result<user_summary::Model> {
        let ls = UserSummary::find_by_id(user_id)
            .one(&self.db)
            .await?
            .unwrap();
        Ok(ls)
    }

    #[tracing::instrument(skip(self))]
    pub async fn calculate_user_activities_and_summary(
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

        tracing::debug!("Calculating numbers summary for user: {:?}", ls);

        let metadata_num_reviews = Review::find()
            .filter(review::Column::UserId.eq(user_id))
            .filter(review::Column::MetadataId.is_not_null())
            .apply_if(start_from, |query, v| {
                query.filter(review::Column::PostedOn.gt(v))
            })
            .count(&self.db)
            .await?;

        tracing::debug!(
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

        tracing::debug!(
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

        tracing::debug!(
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

        tracing::debug!("Calculated number workouts for user: {:?}", num_workouts);

        let num_metadata_interacted_with = UserToEntity::find()
            .filter(user_to_entity::Column::UserId.eq(user_id))
            .filter(user_to_entity::Column::MetadataId.is_not_null())
            .apply_if(start_from, |query, v| {
                query.filter(user_to_entity::Column::LastUpdatedOn.gt(v))
            })
            .count(&self.db)
            .await?;

        tracing::debug!(
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

        tracing::debug!(
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

        tracing::debug!(
            "Calculated number exercises interacted with for user: {:?}",
            num_exercises_interacted_with
        );

        let (total_workout_time, total_workout_weight) = Workout::find()
            .filter(workout::Column::UserId.eq(user_id))
            .select_only()
            .column_as(
                Expr::cust("coalesce(extract(epoch from sum(end_time - start_time)) / 60, 0)"),
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

        tracing::debug!(
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
        ls.fitness.workouts.weight += total_workout_weight;
        ls.fitness.workouts.duration += total_workout_time;

        tracing::debug!("Calculated numbers summary for user: {:?}", ls);

        #[derive(Debug, Serialize, Deserialize, Clone, FromQueryResult)]
        struct SeenItem {
            show_extra_information: Option<SeenShowExtraInformation>,
            podcast_extra_information: Option<SeenPodcastExtraInformation>,
            anime_extra_information: Option<SeenAnimeExtraInformation>,
            manga_extra_information: Option<SeenMangaExtraInformation>,
            metadata_id: String,
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

        let mut seen_items = Seen::find()
            .filter(seen::Column::UserId.eq(user_id))
            .filter(seen::Column::Progress.eq(100))
            .apply_if(start_from, |query, v| {
                query.filter(seen::Column::LastUpdatedOn.gt(v))
            })
            .left_join(Metadata)
            .select_only()
            .columns([
                seen::Column::ShowExtraInformation,
                seen::Column::PodcastExtraInformation,
                seen::Column::AnimeExtraInformation,
                seen::Column::MangaExtraInformation,
                seen::Column::MetadataId,
            ])
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

        while let Some(seen) = seen_items.try_next().await.unwrap() {
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
        tracing::debug!("Calculated summary for user: {:?}", usr.user_id);
        Ok(())
    }
}
