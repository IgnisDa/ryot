use std::sync::Arc;

use apalis::prelude::MessageQueue;
use async_graphql::{Context, Enum, InputObject, Object, Result, SimpleObject};
use chrono::{DateTime, Duration, NaiveDateTime, Offset, TimeZone, Utc};
use database::{ImportSource, MediaLot};
use rust_decimal::Decimal;
use rust_decimal_macros::dec;
use sea_orm::{
    ActiveModelTrait, ActiveValue, ColumnTrait, EntityTrait, FromJsonQueryResult, QueryFilter,
    QueryOrder,
};
use serde::{Deserialize, Serialize};

use crate::{
    background::ApplicationJob,
    entities::{
        import_report, prelude::ImportReport, user::UserWithOnlyPreferences, user_measurement,
    },
    fitness::resolver::ExerciseService,
    miscellaneous::resolver::MiscellaneousService,
    models::{
        fitness::UserWorkoutInput,
        media::{
            CommitMediaInput, CommitPersonInput, CreateOrUpdateCollectionInput,
            ImportOrExportItemIdentifier, ImportOrExportItemRating, ImportOrExportMediaGroupItem,
            ImportOrExportMediaItem, ImportOrExportPersonItem, PostReviewInput,
            ProgressUpdateInput,
        },
        BackgroundJob, ChangeCollectionToEntityInput, StringIdObject,
    },
    traits::AuthProvider,
    users::{UserPreferences, UserReviewScale},
    utils::partial_user_by_id,
};

mod audiobookshelf;
mod generic_json;
mod goodreads;
mod imdb;
mod jellyfin;
mod mal;
mod media_tracker;
mod movary;
mod open_scale;
mod story_graph;
mod strong_app;
mod trakt;

#[derive(Debug, InputObject, Serialize, Deserialize, Clone)]
pub struct DeployGenericCsvImportInput {
    // The file path of the uploaded CSV export file.
    csv_path: String,
}

#[derive(Debug, InputObject, Serialize, Deserialize, Clone)]
pub struct DeployTraktImportInput {
    // The public username in Trakt.
    username: String,
}

#[derive(Debug, InputObject, Serialize, Deserialize, Clone)]
pub struct DeployMovaryImportInput {
    // The file path of the uploaded CSV history file.
    history: String,
    // The file path of the uploaded CSV ratings file.
    ratings: String,
    // The file path of the uploaded CSV watchlist file.
    watchlist: String,
}

#[derive(Debug, InputObject, Serialize, Deserialize, Clone)]
pub struct DeployMalImportInput {
    /// The anime export file path (uploaded via temporary upload).
    anime_path: Option<String>,
    /// The manga export file path (uploaded via temporary upload).
    manga_path: Option<String>,
}

#[derive(Debug, InputObject, Serialize, Deserialize, Clone)]
pub struct StrongAppImportMapping {
    source_name: String,
    target_name: String,
    multiplier: Option<Decimal>,
}

#[derive(Debug, InputObject, Serialize, Deserialize, Clone)]
pub struct DeployStrongAppImportInput {
    // The path to the CSV file in the local file system.
    export_path: String,
    mapping: Vec<StrongAppImportMapping>,
}

#[derive(Debug, InputObject, Serialize, Deserialize, Clone)]
pub struct DeployJsonImportInput {
    // The file path of the uploaded JSON export.
    export: String,
}

#[derive(Debug, InputObject, Serialize, Deserialize, Clone)]
pub struct DeployUrlAndKeyImportInput {
    api_url: String,
    api_key: String,
}

#[derive(Debug, InputObject, Serialize, Deserialize, Clone)]
pub struct DeployUrlAndKeyAndUsernameImportInput {
    api_url: String,
    username: String,
    password: String,
}

#[derive(Debug, InputObject, Serialize, Deserialize, Clone)]
pub struct DeployImportJobInput {
    pub source: ImportSource,
    pub generic_csv: Option<DeployGenericCsvImportInput>,
    pub trakt: Option<DeployTraktImportInput>,
    pub movary: Option<DeployMovaryImportInput>,
    pub mal: Option<DeployMalImportInput>,
    pub strong_app: Option<DeployStrongAppImportInput>,
    pub generic_json: Option<DeployJsonImportInput>,
    pub url_and_key: Option<DeployUrlAndKeyImportInput>,
    pub jellyfin: Option<DeployUrlAndKeyAndUsernameImportInput>,
}

/// The various steps in which media importing can fail
#[derive(Debug, Enum, PartialEq, Eq, Copy, Clone, Serialize, Deserialize)]
pub enum ImportFailStep {
    /// Failed to get details from the source itself (for eg: MediaTracker, Goodreads etc.)
    ItemDetailsFromSource,
    /// Failed to get metadata from the provider (for eg: Openlibrary, IGDB etc.)
    MediaDetailsFromProvider,
    /// Failed to transform the data into the required format
    InputTransformation,
    /// Failed to save a seen history item
    SeenHistoryConversion,
    /// Failed to save a review/rating item
    ReviewConversion,
}

#[derive(
    Debug, SimpleObject, FromJsonQueryResult, Serialize, Deserialize, Eq, PartialEq, Clone,
)]
pub struct ImportFailedItem {
    lot: Option<MediaLot>,
    step: ImportFailStep,
    identifier: String,
    error: Option<String>,
}

#[derive(Debug, SimpleObject, Serialize, Deserialize, Eq, PartialEq, Clone)]
pub struct ImportDetails {
    pub total: usize,
}

#[derive(Debug, Default)]
pub struct ImportResult {
    collections: Vec<CreateOrUpdateCollectionInput>,
    media: Vec<ImportOrExportMediaItem>,
    media_groups: Vec<ImportOrExportMediaGroupItem>,
    people: Vec<ImportOrExportPersonItem>,
    measurements: Vec<user_measurement::Model>,
    workouts: Vec<UserWorkoutInput>,
    failed_items: Vec<ImportFailedItem>,
}

#[derive(
    Debug, SimpleObject, Serialize, Deserialize, FromJsonQueryResult, Eq, PartialEq, Clone,
)]
pub struct ImportResultResponse {
    pub import: ImportDetails,
    pub failed_items: Vec<ImportFailedItem>,
}

#[derive(Default)]
pub struct ImporterQuery;

#[Object]
impl ImporterQuery {
    /// Get all the import jobs deployed by the user.
    async fn import_reports(&self, gql_ctx: &Context<'_>) -> Result<Vec<import_report::Model>> {
        let service = gql_ctx.data_unchecked::<Arc<ImporterService>>();
        let user_id = service.user_id_from_ctx(gql_ctx).await?;
        service.import_reports(user_id).await
    }
}

#[derive(Default)]
pub struct ImporterMutation;

#[Object]
impl ImporterMutation {
    /// Add job to import data from various sources.
    async fn deploy_import_job(
        &self,
        gql_ctx: &Context<'_>,
        input: DeployImportJobInput,
    ) -> Result<bool> {
        let service = gql_ctx.data_unchecked::<Arc<ImporterService>>();
        let user_id = service.user_id_from_ctx(gql_ctx).await?;
        service.deploy_import_job(user_id, input).await
    }
}

pub struct ImporterService {
    media_service: Arc<MiscellaneousService>,
    exercise_service: Arc<ExerciseService>,
    timezone: Arc<chrono_tz::Tz>,
}

impl AuthProvider for ImporterService {}

impl ImporterService {
    pub fn new(
        media_service: Arc<MiscellaneousService>,
        exercise_service: Arc<ExerciseService>,
        timezone: Arc<chrono_tz::Tz>,
    ) -> Self {
        Self {
            media_service,
            exercise_service,
            timezone,
        }
    }

    pub async fn deploy_import_job(
        &self,
        user_id: String,
        input: DeployImportJobInput,
    ) -> Result<bool> {
        let job = ApplicationJob::ImportFromExternalSource(user_id, Box::new(input));
        self.media_service
            .perform_application_job
            .clone()
            .enqueue(job)
            .await
            .unwrap();
        tracing::debug!("Deployed import job");
        Ok(true)
    }

    pub async fn import_reports(&self, user_id: String) -> Result<Vec<import_report::Model>> {
        let reports = ImportReport::find()
            .filter(import_report::Column::UserId.eq(user_id))
            .order_by_desc(import_report::Column::StartedOn)
            .all(&self.media_service.db)
            .await
            .unwrap();
        Ok(reports)
    }

    #[tracing::instrument(skip(self, input))]
    pub async fn start_importing(
        &self,
        user_id: String,
        input: Box<DeployImportJobInput>,
    ) -> Result<()> {
        let db_import_job = self.start_import_job(&user_id, input.source).await?;
        let preferences =
            partial_user_by_id::<UserWithOnlyPreferences>(&self.media_service.db, &user_id)
                .await?
                .preferences;
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
                &self.media_service.db,
                |input| self.media_service.commit_metadata(input),
            )
            .await
            .unwrap(),
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
            self.media_service
                .create_or_update_collection(&user_id, col_details)
                .await?;
        }
        for (idx, item) in import.media.iter().enumerate() {
            tracing::debug!(
                "Importing media with identifier = {iden}",
                iden = &item.source_id
            );
            let rev_length = item.reviews.len();
            let identifier = item.internal_identifier.clone().unwrap();
            let data = match identifier {
                ImportOrExportItemIdentifier::NeedsDetails(identifier) => {
                    let resp = self
                        .media_service
                        .commit_metadata(CommitMediaInput {
                            identifier,
                            lot: item.lot,
                            source: item.source,
                            force_update: Some(true),
                        })
                        .await;
                    resp.map(|r| StringIdObject { id: r.id })
                }
                ImportOrExportItemIdentifier::AlreadyFilled(a) => {
                    self.media_service
                        .commit_metadata_internal(*a.clone(), None)
                        .await
                }
            };
            let metadata = match data {
                Ok(r) => r,
                Err(e) => {
                    tracing::error!("{e:?}");
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
                    Some(metadata.id.clone()),
                    None,
                    None,
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
                self.media_service
                    .create_or_update_collection(
                        &user_id,
                        CreateOrUpdateCollectionInput {
                            name: col.to_string(),
                            ..Default::default()
                        },
                    )
                    .await?;
                self.media_service
                    .add_entity_to_collection(
                        &user_id,
                        ChangeCollectionToEntityInput {
                            creator_user_id: user_id.clone(),
                            collection_name: col.to_string(),
                            metadata_id: Some(metadata.id.clone()),
                            ..Default::default()
                        },
                    )
                    .await
                    .ok();
            }
            tracing::debug!(
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
            tracing::debug!(
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
                    tracing::error!("{e:?}");
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
                    None,
                    None,
                    Some(metadata_group_id.clone()),
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
                self.media_service
                    .create_or_update_collection(
                        &user_id,
                        CreateOrUpdateCollectionInput {
                            name: col.to_string(),
                            ..Default::default()
                        },
                    )
                    .await?;
                self.media_service
                    .add_entity_to_collection(
                        &user_id,
                        ChangeCollectionToEntityInput {
                            creator_user_id: user_id.clone(),
                            collection_name: col.to_string(),
                            metadata_group_id: Some(metadata_group_id.clone()),
                            ..Default::default()
                        },
                    )
                    .await
                    .ok();
            }
            tracing::debug!(
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
                    None,
                    Some(person.id.clone()),
                    None,
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
                self.media_service
                    .create_or_update_collection(
                        &user_id,
                        CreateOrUpdateCollectionInput {
                            name: col.to_string(),
                            ..Default::default()
                        },
                    )
                    .await?;
                self.media_service
                    .add_entity_to_collection(
                        &user_id,
                        ChangeCollectionToEntityInput {
                            creator_user_id: user_id.clone(),
                            collection_name: col.to_string(),
                            person_id: Some(person.id.clone()),
                            ..Default::default()
                        },
                    )
                    .await
                    .ok();
            }
            tracing::debug!(
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
            .deploy_background_job(&user_id, BackgroundJob::CalculateSummary)
            .await
            .ok();
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
        let model = model.insert(&self.media_service.db).await.unwrap();
        tracing::debug!("Started import job with id = {id}", id = model.id);
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
        let model = model.update(&self.media_service.db).await.unwrap();
        Ok(model)
    }
}

fn convert_review_into_input(
    review: &ImportOrExportItemRating,
    preferences: &UserPreferences,
    metadata_id: Option<String>,
    person_id: Option<String>,
    metadata_group_id: Option<String>,
) -> Option<PostReviewInput> {
    if review.review.is_none() && review.rating.is_none() {
        tracing::debug!("Skipping review since it has no content");
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
        metadata_id,
        person_id,
        metadata_group_id,
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
