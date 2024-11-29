use std::sync::Arc;

use async_graphql::Result;
use background::ApplicationJob;
use chrono::{DateTime, Duration, NaiveDateTime, Offset, TimeZone, Utc};
use common_models::BackgroundJob;
use common_utils::ryot_log;
use database_models::{import_report, prelude::ImportReport};
use dependent_utils::{
    commit_metadata, deploy_background_job, get_google_books_service, get_openlibrary_service,
    get_tmdb_non_media_service, process_import,
};
use enums::{ImportSource, MediaSource};
use importer_models::{ImportFailStep, ImportFailedItem, ImportResultResponse};
use media_models::{DeployImportJobInput, ImportOrExportMediaItem};
use providers::{google_books::GoogleBooksService, openlibrary::OpenlibraryService};
use sea_orm::{ActiveModelTrait, ActiveValue, ColumnTrait, EntityTrait, QueryFilter, QueryOrder};
use supporting_service::SupportingService;
use traits::TraceOk;

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
mod plex;
mod story_graph;
mod strong_app;
mod trakt;

pub struct ImporterService(pub Arc<SupportingService>);

impl ImporterService {
    pub async fn deploy_import_job(
        &self,
        user_id: String,
        input: DeployImportJobInput,
    ) -> Result<bool> {
        let job = ApplicationJob::ImportFromExternalSource(user_id, Box::new(input));
        self.0.perform_application_job(job).await?;
        ryot_log!(debug, "Deployed import job");
        Ok(true)
    }

    pub async fn import_reports(&self, user_id: String) -> Result<Vec<import_report::Model>> {
        let reports = ImportReport::find()
            .filter(import_report::Column::UserId.eq(user_id))
            .order_by_desc(import_report::Column::StartedOn)
            .all(&self.0.db)
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
        let import = match input.source {
            ImportSource::StrongApp => {
                strong_app::import(input.strong_app.unwrap(), &self.0.timezone)
                    .await
                    .unwrap()
            }
            ImportSource::MediaTracker => media_tracker::import(input.url_and_key.unwrap())
                .await
                .unwrap(),
            ImportSource::Mal => mal::import(input.mal.unwrap()).await.unwrap(),
            ImportSource::Goodreads => goodreads::import(
                input.generic_csv.unwrap(),
                &get_google_books_service(&self.0.config).await.unwrap(),
                &get_openlibrary_service(&self.0.config).await.unwrap(),
            )
            .await
            .unwrap(),
            ImportSource::Trakt => trakt::import(input.trakt.unwrap()).await.unwrap(),
            ImportSource::Movary => movary::import(input.movary.unwrap()).await.unwrap(),
            ImportSource::StoryGraph => story_graph::import(
                input.generic_csv.unwrap(),
                &get_google_books_service(&self.0.config).await.unwrap(),
                &get_openlibrary_service(&self.0.config).await.unwrap(),
            )
            .await
            .unwrap(),
            ImportSource::Audiobookshelf => audiobookshelf::import(
                input.url_and_key.unwrap(),
                &get_google_books_service(&self.0.config).await.unwrap(),
                &get_openlibrary_service(&self.0.config).await.unwrap(),
                |input| commit_metadata(input, &self.0),
            )
            .await
            .unwrap(),
            ImportSource::Igdb => igdb::import(input.igdb.unwrap()).await.unwrap(),
            ImportSource::Imdb => imdb::import(
                input.generic_csv.unwrap(),
                &get_tmdb_non_media_service(&self.0).await.unwrap(),
            )
            .await
            .unwrap(),
            ImportSource::GenericJson => generic_json::import(input.generic_json.unwrap())
                .await
                .unwrap(),
            ImportSource::OpenScale => {
                open_scale::import(input.generic_csv.unwrap(), &self.0.timezone)
                    .await
                    .unwrap()
            }
            ImportSource::Jellyfin => jellyfin::import(input.jellyfin.unwrap()).await.unwrap(),
            ImportSource::Plex => plex::import(input.url_and_key.unwrap()).await.unwrap(),
        };
        let details = process_import(&user_id, false, import, &self.0).await?;
        self.finish_import_job(db_import_job, details).await?;
        deploy_background_job(
            &user_id,
            BackgroundJob::CalculateUserActivitiesAndSummary,
            &self.0,
        )
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
        let model = model.insert(&self.0.db).await.unwrap();
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
        let model = model.update(&self.0.db).await.unwrap();
        Ok(model)
    }
}

pub mod utils {
    use super::*;

    pub fn get_date_time_with_offset(
        date_time: NaiveDateTime,
        timezone: &chrono_tz::Tz,
    ) -> DateTime<Utc> {
        let offset = timezone
            .offset_from_utc_datetime(&Utc::now().naive_utc())
            .fix()
            .local_minus_utc();
        let offset = Duration::try_seconds(offset.into()).unwrap();
        DateTime::<Utc>::from_naive_utc_and_offset(date_time, Utc) - offset
    }

    pub async fn get_identifier_from_book_isbn(
        isbn: &str,
        google_books_service: &GoogleBooksService,
        open_library_service: &OpenlibraryService,
    ) -> Option<(String, MediaSource)> {
        let mut identifier = None;
        let mut source = MediaSource::GoogleBooks;
        if let Some(id) = google_books_service.id_from_isbn(isbn).await {
            identifier = Some(id);
        } else if let Some(id) = open_library_service.id_from_isbn(isbn).await {
            identifier = Some(id);
            source = MediaSource::Openlibrary;
        }
        identifier.map(|id| (id, source))
    }
}
