use std::sync::Arc;

use apalis::prelude::{MemoryStorage, MessageQueue};
use async_graphql::Result;
use background::{ApplicationJob, CoreApplicationJob};
use chrono::{DateTime, Duration, NaiveDateTime, Offset, TimeZone, Utc};
use common_models::{BackgroundJob, ChangeCollectionToEntityInput};
use common_utils::ryot_log;
use database_models::{import_report, prelude::ImportReport};
use database_utils::{add_entity_to_collection, create_or_update_collection, user_by_id};
use enums::{EntityLot, ImportSource};
use fitness_service::ExerciseService;
use importer_models::{ImportDetails, ImportFailStep, ImportFailedItem, ImportResultResponse};
use media_models::{
    CommitMediaInput, CommitPersonInput, CreateOrUpdateCollectionInput, DeployImportJobInput,
    ImportOrExportItemRating, ImportOrExportMediaItem, PostReviewInput, ProgressUpdateInput,
};
use miscellaneous_service::MiscellaneousService;
use rust_decimal_macros::dec;
use sea_orm::{
    ActiveModelTrait, ActiveValue, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter,
    QueryOrder,
};
use traits::TraceOk;
use user_models::{UserPreferences, UserReviewScale};

mod audiobookshelf;
mod generic_json;
mod goodreads;
mod igdb;
mod imdb;
mod jellyfin;
mod mal;
mod media_tracker;
mod movary;
mod open_scale;
mod story_graph;
mod strong_app;
mod trakt;

pub struct ImporterService {
    db: DatabaseConnection,
    perform_application_job: MemoryStorage<ApplicationJob>,
    perform_core_application_job: MemoryStorage<CoreApplicationJob>,
    media_service: Arc<MiscellaneousService>,
    exercise_service: Arc<ExerciseService>,
    timezone: Arc<chrono_tz::Tz>,
}

impl ImporterService {
    pub fn new(
        db: &DatabaseConnection,
        perform_application_job: &MemoryStorage<ApplicationJob>,
        perform_core_application_job: &MemoryStorage<CoreApplicationJob>,
        media_service: Arc<MiscellaneousService>,
        exercise_service: Arc<ExerciseService>,
        timezone: Arc<chrono_tz::Tz>,
    ) -> Self {
        Self {
            media_service,
            exercise_service,
            timezone,
            db: db.clone(),
            perform_application_job: perform_application_job.clone(),
            perform_core_application_job: perform_core_application_job.clone(),
        }
    }

    pub async fn deploy_import_job(
        &self,
        user_id: String,
        input: DeployImportJobInput,
    ) -> Result<bool> {
        let job = ApplicationJob::ImportFromExternalSource(user_id, Box::new(input));
        self.perform_application_job
            .clone()
            .enqueue(job)
            .await
            .unwrap();
        ryot_log!(debug, "Deployed import job");
        Ok(true)
    }

    pub async fn import_reports(&self, user_id: String) -> Result<Vec<import_report::Model>> {
        let reports = ImportReport::find()
            .filter(import_report::Column::UserId.eq(user_id))
            .order_by_desc(import_report::Column::StartedOn)
            .all(&self.db)
            .await
            .unwrap();
        Ok(reports)
    }

    pub async fn start_importing(
        &self,
        user_id: String,
        input: Box<DeployImportJobInput>,
    ) -> Result<()> {
        let db_import_job = self.start_import_job(&user_id, input.source).await?;
        let preferences = user_by_id(&self.db, &user_id).await?.preferences;
        let mut import = match input.source {
            ImportSource::StrongApp => {
                strong_app::import(input.strong_app.unwrap(), self.timezone.clone())
                    .await
                    .unwrap()
            }
            ImportSource::MediaTracker => media_tracker::import(input.url_and_key.unwrap())
                .await
                .unwrap(),
            ImportSource::Mal => mal::import(input.mal.unwrap()).await.unwrap(),
            ImportSource::Goodreads => goodreads::import(
                input.generic_csv.unwrap(),
                &self.media_service.get_isbn_service().await.unwrap(),
            )
            .await
            .unwrap(),
            ImportSource::Trakt => trakt::import(input.trakt.unwrap()).await.unwrap(),
            ImportSource::Movary => movary::import(input.movary.unwrap()).await.unwrap(),
            ImportSource::StoryGraph => story_graph::import(
                input.generic_csv.unwrap(),
                &self.media_service.get_isbn_service().await.unwrap(),
            )
            .await
            .unwrap(),
            ImportSource::Audiobookshelf => audiobookshelf::import(
                input.url_and_key.unwrap(),
                &self.media_service.get_isbn_service().await.unwrap(),
                |input| self.media_service.commit_metadata(input),
            )
            .await
            .unwrap(),
            ImportSource::Igdb => igdb::import(input.igdb.unwrap()).await.unwrap(),
            ImportSource::Imdb => imdb::import(
                input.generic_csv.unwrap(),
                &self
                    .media_service
                    .get_tmdb_non_media_service()
                    .await
                    .unwrap(),
            )
            .await
            .unwrap(),
            ImportSource::GenericJson => {
                generic_json::import(input.generic_json.unwrap(), &self.exercise_service)
                    .await
                    .unwrap()
            }
            ImportSource::OpenScale => {
                open_scale::import(input.generic_csv.unwrap(), self.timezone.clone())
                    .await
                    .unwrap()
            }
            ImportSource::Jellyfin => jellyfin::import(input.jellyfin.unwrap()).await.unwrap(),
        };
        for m in import.media.iter_mut() {
            m.seen_history.sort_by(|a, b| {
                a.ended_on
                    .unwrap_or_default()
                    .cmp(&b.ended_on.unwrap_or_default())
            });
        }
        for col_details in import.collections.clone() {
            create_or_update_collection(&self.db, &user_id, col_details).await?;
        }
        for (idx, item) in import.media.iter().enumerate() {
            ryot_log!(
                debug,
                "Importing media with identifier = {iden}",
                iden = &item.source_id
            );
            let rev_length = item.reviews.len();
            let identifier = item.identifier.clone();
            let data = self
                .media_service
                .commit_metadata(CommitMediaInput {
                    identifier,
                    lot: item.lot,
                    source: item.source,
                    force_update: Some(true),
                })
                .await;
            let metadata = match data {
                Ok(r) => r,
                Err(e) => {
                    ryot_log!(error, "{e:?}");
                    import.failed_items.push(ImportFailedItem {
                        lot: Some(item.lot),
                        step: ImportFailStep::MediaDetailsFromProvider,
                        identifier: item.source_id.to_owned(),
                        error: Some(e.message),
                    });
                    continue;
                }
            };
            for seen in item.seen_history.iter() {
                let progress = if seen.progress.is_some() {
                    seen.progress
                } else {
                    Some(dec!(100))
                };
                if let Err(e) = self
                    .media_service
                    .progress_update(
                        ProgressUpdateInput {
                            metadata_id: metadata.id.clone(),
                            progress,
                            date: seen.ended_on,
                            show_season_number: seen.show_season_number,
                            show_episode_number: seen.show_episode_number,
                            podcast_episode_number: seen.podcast_episode_number,
                            anime_episode_number: seen.anime_episode_number,
                            manga_chapter_number: seen.manga_chapter_number,
                            manga_volume_number: seen.manga_volume_number,
                            provider_watched_on: seen.provider_watched_on.clone(),
                            change_state: None,
                        },
                        &user_id,
                        false,
                    )
                    .await
                {
                    import.failed_items.push(ImportFailedItem {
                        lot: Some(item.lot),
                        step: ImportFailStep::SeenHistoryConversion,
                        identifier: item.source_id.to_owned(),
                        error: Some(e.message),
                    });
                };
            }
            for review in item.reviews.iter() {
                if let Some(input) = convert_review_into_input(
                    review,
                    &preferences,
                    metadata.id.clone(),
                    EntityLot::Metadata,
                ) {
                    if let Err(e) = self.media_service.post_review(&user_id, input).await {
                        import.failed_items.push(ImportFailedItem {
                            lot: Some(item.lot),
                            step: ImportFailStep::ReviewConversion,
                            identifier: item.source_id.to_owned(),
                            error: Some(e.message),
                        });
                    };
                }
            }
            for col in item.collections.iter() {
                create_or_update_collection(
                    &self.db,
                    &user_id,
                    CreateOrUpdateCollectionInput {
                        name: col.to_string(),
                        ..Default::default()
                    },
                )
                .await?;
                add_entity_to_collection(
                    &self.db,
                    &user_id,
                    ChangeCollectionToEntityInput {
                        creator_user_id: user_id.clone(),
                        collection_name: col.to_string(),
                        entity_id: metadata.id.clone(),
                        entity_lot: EntityLot::Metadata,
                        ..Default::default()
                    },
                    &self.perform_core_application_job,
                )
                .await
                .ok();
            }
            ryot_log!(
                debug,
                "Imported item: {idx}/{total}, lot: {lot}, history count: {hist}, review count: {rev}, collection count: {col}",
                idx = idx + 1,
                total = import.media.len(),
                lot = item.lot,
                hist = item.seen_history.len(),
                rev = rev_length,
                col = item.collections.len(),
            );
        }
        for (idx, item) in import.media_groups.iter().enumerate() {
            ryot_log!(
                debug,
                "Importing media group with identifier = {iden}",
                iden = &item.title
            );
            let rev_length = item.reviews.len();
            let data = self
                .media_service
                .commit_metadata_group_internal(&item.identifier, item.lot, item.source)
                .await;
            let metadata_group_id = match data {
                Ok(r) => r.0,
                Err(e) => {
                    ryot_log!(error, "{e:?}");
                    import.failed_items.push(ImportFailedItem {
                        lot: Some(item.lot),
                        step: ImportFailStep::MediaDetailsFromProvider,
                        identifier: item.title.to_owned(),
                        error: Some(e.message),
                    });
                    continue;
                }
            };
            for review in item.reviews.iter() {
                if let Some(input) = convert_review_into_input(
                    review,
                    &preferences,
                    metadata_group_id.clone(),
                    EntityLot::MetadataGroup,
                ) {
                    if let Err(e) = self.media_service.post_review(&user_id, input).await {
                        import.failed_items.push(ImportFailedItem {
                            lot: Some(item.lot),
                            step: ImportFailStep::ReviewConversion,
                            identifier: item.title.to_owned(),
                            error: Some(e.message),
                        });
                    };
                }
            }
            for col in item.collections.iter() {
                create_or_update_collection(
                    &self.db,
                    &user_id,
                    CreateOrUpdateCollectionInput {
                        name: col.to_string(),
                        ..Default::default()
                    },
                )
                .await?;
                add_entity_to_collection(
                    &self.db,
                    &user_id,
                    ChangeCollectionToEntityInput {
                        creator_user_id: user_id.clone(),
                        collection_name: col.to_string(),
                        entity_id: metadata_group_id.clone(),
                        entity_lot: EntityLot::MetadataGroup,
                        ..Default::default()
                    },
                    &self.perform_core_application_job,
                )
                .await
                .ok();
            }
            ryot_log!(
                debug,
                "Imported item: {idx}/{total}, lot: {lot}, review count: {rev}, collection count: {col}",
                idx = idx + 1,
                total = import.media.len(),
                lot = item.lot,
                rev = rev_length,
                col = item.collections.len(),
            );
        }
        for (idx, item) in import.people.iter().enumerate() {
            let person = self
                .media_service
                .commit_person(CommitPersonInput {
                    identifier: item.identifier.clone(),
                    name: item.name.clone(),
                    source: item.source,
                    source_specifics: item.source_specifics.clone(),
                })
                .await?;
            for review in item.reviews.iter() {
                if let Some(input) = convert_review_into_input(
                    review,
                    &preferences,
                    person.id.clone(),
                    EntityLot::Person,
                ) {
                    if let Err(e) = self.media_service.post_review(&user_id, input).await {
                        import.failed_items.push(ImportFailedItem {
                            lot: None,
                            step: ImportFailStep::ReviewConversion,
                            identifier: item.name.to_owned(),
                            error: Some(e.message),
                        });
                    };
                }
            }
            for col in item.collections.iter() {
                create_or_update_collection(
                    &self.db,
                    &user_id,
                    CreateOrUpdateCollectionInput {
                        name: col.to_string(),
                        ..Default::default()
                    },
                )
                .await?;
                add_entity_to_collection(
                    &self.db,
                    &user_id,
                    ChangeCollectionToEntityInput {
                        creator_user_id: user_id.clone(),
                        collection_name: col.to_string(),
                        entity_id: person.id.clone(),
                        entity_lot: EntityLot::Person,
                        ..Default::default()
                    },
                    &self.perform_core_application_job,
                )
                .await
                .ok();
            }
            ryot_log!(
                debug,
                "Imported person: {idx}/{total}, name: {name}",
                idx = idx + 1,
                total = import.people.len(),
                name = item.name,
            );
        }
        for workout in import.workouts.clone() {
            if let Err(err) = self
                .exercise_service
                .create_user_workout(&user_id, workout)
                .await
            {
                import.failed_items.push(ImportFailedItem {
                    lot: None,
                    step: ImportFailStep::InputTransformation,
                    identifier: "Exercise".to_string(),
                    error: Some(err.message),
                });
            }
        }
        for measurement in import.measurements.clone() {
            if let Err(err) = self
                .exercise_service
                .create_user_measurement(&user_id, measurement)
                .await
            {
                import.failed_items.push(ImportFailedItem {
                    lot: None,
                    step: ImportFailStep::InputTransformation,
                    identifier: "Measurement".to_string(),
                    error: Some(err.message),
                });
            }
        }

        let details = ImportResultResponse {
            import: ImportDetails {
                total: import.collections.len()
                    + import.media.len()
                    + import.media_groups.len()
                    + import.people.len()
                    + import.workouts.len()
                    + import.measurements.len(),
            },
            failed_items: import.failed_items,
        };
        self.finish_import_job(db_import_job, details).await?;
        self.media_service
            .deploy_background_job(&user_id, BackgroundJob::CalculateUserActivitiesAndSummary)
            .await
            .trace_ok();
        Ok(())
    }

    async fn start_import_job(
        &self,
        user_id: &String,
        source: ImportSource,
    ) -> Result<import_report::Model> {
        let model = import_report::ActiveModel {
            user_id: ActiveValue::Set(user_id.to_owned()),
            source: ActiveValue::Set(source),
            ..Default::default()
        };
        let model = model.insert(&self.db).await.unwrap();
        ryot_log!(debug, "Started import job with id = {id}", id = model.id);
        Ok(model)
    }

    async fn finish_import_job(
        &self,
        job: import_report::Model,
        details: ImportResultResponse,
    ) -> Result<import_report::Model> {
        let mut model: import_report::ActiveModel = job.into();
        model.finished_on = ActiveValue::Set(Some(Utc::now()));
        model.details = ActiveValue::Set(Some(details));
        model.was_success = ActiveValue::Set(Some(true));
        let model = model.update(&self.db).await.unwrap();
        Ok(model)
    }
}

fn convert_review_into_input(
    review: &ImportOrExportItemRating,
    preferences: &UserPreferences,
    entity_id: String,
    entity_lot: EntityLot,
) -> Option<PostReviewInput> {
    if review.review.is_none() && review.rating.is_none() {
        ryot_log!(debug, "Skipping review since it has no content");
        return None;
    }
    let rating = match preferences.general.review_scale {
        UserReviewScale::OutOfFive => review.rating.map(|rating| rating / dec!(20)),
        UserReviewScale::OutOfHundred => review.rating,
    };
    let text = review.review.clone().and_then(|r| r.text);
    let is_spoiler = review.review.clone().map(|r| r.spoiler.unwrap_or(false));
    let date = review.review.clone().map(|r| r.date);
    Some(PostReviewInput {
        rating,
        text,
        is_spoiler,
        visibility: review.review.clone().and_then(|r| r.visibility),
        date: date.flatten(),
        entity_id,
        entity_lot,
        show_season_number: review.show_season_number,
        show_episode_number: review.show_episode_number,
        podcast_episode_number: review.podcast_episode_number,
        manga_chapter_number: review.manga_chapter_number,
        ..Default::default()
    })
}

pub mod utils {
    use super::*;

    pub fn get_date_time_with_offset(
        date_time: NaiveDateTime,
        timezone: Arc<chrono_tz::Tz>,
    ) -> DateTime<Utc> {
        let offset = timezone
            .offset_from_utc_datetime(&Utc::now().naive_utc())
            .fix()
            .local_minus_utc();
        let offset = Duration::try_seconds(offset.into()).unwrap();
        DateTime::<Utc>::from_naive_utc_and_offset(date_time, Utc) - offset
    }
}
