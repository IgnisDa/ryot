use std::{collections::HashMap, sync::Arc};

use anyhow::Result;
use background_models::{ApplicationJob, MpApplicationJob};
use chrono::{Duration, NaiveDateTime, Offset, TimeZone, Utc};
use common_models::BackgroundJob;
use common_utils::{MAX_IMPORT_RETRIES_FOR_PARTIAL_STATE, ryot_log};
use database_models::{
    exercise, import_report,
    prelude::{Exercise, ImportReport},
};
use dependent_fitness_utils::generate_exercise_id;
use dependent_import_utils::process_import;
use dependent_jobs_utils::deploy_background_job;
use dependent_models::ImportOrExportMetadataItem;
use dependent_provider_utils::{
    get_google_books_service, get_hardcover_service, get_openlibrary_service,
    get_tmdb_non_media_service,
};
use enum_models::{ExerciseLot, ExerciseSource, ImportSource};
use importer_models::{ImportFailStep, ImportFailedItem};
use media_models::DeployImportJobInput;
use rust_decimal::dec;
use sea_orm::{
    ActiveModelTrait, ActiveValue, ColumnTrait, EntityTrait, IntoActiveModel, QueryFilter,
    QueryOrder, prelude::DateTimeUtc, prelude::Expr,
};
use supporting_service::SupportingService;
use traits::TraceOk;

mod anilist;
mod audiobookshelf;
mod generic_json;
mod goodreads;
mod grouvee;
mod hardcover;
mod hevy;
mod igdb;
mod imdb;
mod jellyfin;
mod mediatracker;
mod movary;
mod myanimelist;
mod netflix;
mod open_scale;
mod plex;
mod storygraph;
mod strong_app;
mod trakt;
mod watcharr;

pub struct ImporterService(pub Arc<SupportingService>);

impl ImporterService {
    pub async fn deploy_import_job(
        &self,
        user_id: String,
        input: DeployImportJobInput,
    ) -> Result<bool> {
        let job = MpApplicationJob::ImportFromExternalSource(user_id, Box::new(input));
        self.0
            .perform_application_job(ApplicationJob::Mp(job))
            .await?;
        ryot_log!(debug, "Deployed import job");
        Ok(true)
    }

    pub async fn user_import_reports(&self, user_id: String) -> Result<Vec<import_report::Model>> {
        let reports = ImportReport::find()
            .filter(import_report::Column::UserId.eq(user_id))
            .order_by_desc(import_report::Column::StartedOn)
            .all(&self.0.db)
            .await?;
        Ok(reports)
    }

    pub async fn perform_import(
        &self,
        user_id: String,
        input: Box<DeployImportJobInput>,
    ) -> Result<()> {
        let import_started_at = Utc::now();
        let model = import_report::ActiveModel {
            source: ActiveValue::Set(input.source),
            progress: ActiveValue::Set(Some(dec!(0))),
            user_id: ActiveValue::Set(user_id.to_owned()),
            estimated_finish_time: ActiveValue::Set(import_started_at + Duration::hours(1)),
            ..Default::default()
        };
        let db_import_job = model.insert(&self.0.db).await?;
        let import_id = db_import_job.id.clone();
        ryot_log!(debug, "Started import job with id {import_id}");
        let maybe_import = match input.source {
            ImportSource::Igdb => igdb::import(input.igdb.unwrap()).await,
            ImportSource::Movary => movary::import(input.movary.unwrap()).await,
            ImportSource::Plex => plex::import(input.url_and_key.unwrap()).await,
            ImportSource::Watcharr => watcharr::import(input.path.unwrap()).await,
            ImportSource::Jellyfin => jellyfin::import(input.jellyfin.unwrap()).await,
            ImportSource::Myanimelist => myanimelist::import(input.mal.unwrap()).await,
            ImportSource::Grouvee => grouvee::import(input.generic_csv.unwrap()).await,
            ImportSource::GenericJson => generic_json::import(input.path.unwrap()).await,
            ImportSource::Hardcover => hardcover::import(input.generic_csv.unwrap()).await,
            ImportSource::Netflix => netflix::import(input.netflix.unwrap(), &self.0).await,
            ImportSource::Anilist => anilist::import(input.path.unwrap(), &self.0).await,
            ImportSource::Mediatracker => mediatracker::import(input.url_and_key.unwrap()).await,
            ImportSource::Hevy => hevy::import(input.generic_csv.unwrap(), &self.0, &user_id).await,
            ImportSource::OpenScale => {
                open_scale::import(input.generic_csv.unwrap(), &self.0.timezone).await
            }
            ImportSource::StrongApp => {
                strong_app::import(input.strong_app.unwrap(), &self.0, &user_id).await
            }
            ImportSource::Trakt => {
                trakt::import(
                    input.trakt.unwrap(),
                    self.0.config.server.importer.trakt_client_id.as_str(),
                )
                .await
            }
            ImportSource::Imdb => {
                imdb::import(
                    input.generic_csv.unwrap(),
                    &get_tmdb_non_media_service(&self.0).await?,
                )
                .await
            }
            ImportSource::Goodreads => {
                goodreads::import(
                    input.generic_csv.unwrap(),
                    &get_hardcover_service(&self.0.config).await?,
                    &get_google_books_service(&self.0.config).await?,
                    &get_openlibrary_service(&self.0.config).await?,
                )
                .await
            }
            ImportSource::Storygraph => {
                storygraph::import(
                    input.generic_csv.unwrap(),
                    &get_hardcover_service(&self.0.config).await?,
                    &get_google_books_service(&self.0.config).await?,
                    &get_openlibrary_service(&self.0.config).await?,
                )
                .await
            }
            ImportSource::Audiobookshelf => {
                audiobookshelf::import(
                    input.url_and_key.unwrap(),
                    &self.0,
                    &get_hardcover_service(&self.0.config).await?,
                    &get_google_books_service(&self.0.config).await?,
                    &get_openlibrary_service(&self.0.config).await?,
                )
                .await
            }
        };
        let mut model = db_import_job.into_active_model();
        match maybe_import {
            Ok(import) => {
                let mut quick_update_model = model.clone();
                let each_item = (1..MAX_IMPORT_RETRIES_FOR_PARTIAL_STATE + 1)
                    .map(|i| usize::pow(2, i as u32))
                    .sum::<usize>();
                quick_update_model.estimated_finish_time = ActiveValue::Set(
                    import_started_at
                        + Duration::seconds((import.completed.len() * each_item) as i64),
                );
                quick_update_model.update(&self.0.db).await?;
                match process_import(true, &user_id, import, &self.0, |progress| {
                    let id = import_id.clone();
                    async move {
                        ImportReport::update_many()
                            .filter(import_report::Column::Id.eq(id.clone()))
                            .col_expr(import_report::Column::Progress, Expr::value(progress))
                            .exec(&self.0.db)
                            .await?;
                        Ok(())
                    }
                })
                .await
                {
                    Ok((source_result, details)) => {
                        model.source_result =
                            ActiveValue::Set(Some(serde_json::to_value(&source_result)?));
                        model.details = ActiveValue::Set(Some(details));
                        model.was_success = ActiveValue::Set(Some(true));
                        deploy_background_job(
                            &user_id,
                            BackgroundJob::CalculateUserActivitiesAndSummary,
                            &self.0,
                        )
                        .await
                        .trace_ok();
                    }
                    Err(e) => {
                        ryot_log!(debug, "Error while importing: {:?}", e);
                        model.was_success = ActiveValue::Set(Some(false));
                    }
                }
            }
            Err(e) => {
                ryot_log!(debug, "Error while importing: {:?}", e);
                model.was_success = ActiveValue::Set(Some(false));
            }
        }
        model.finished_on = ActiveValue::Set(Some(Utc::now()));
        model.update(&self.0.db).await.trace_ok();
        Ok(())
    }
}

pub mod utils {
    use super::*;

    pub fn get_date_time_with_offset(
        date_time: NaiveDateTime,
        timezone: &chrono_tz::Tz,
    ) -> DateTimeUtc {
        let offset = timezone
            .offset_from_utc_datetime(&Utc::now().naive_utc())
            .fix()
            .local_minus_utc();
        let offset = Duration::try_seconds(offset.into()).unwrap();
        DateTimeUtc::from_naive_utc_and_offset(date_time, Utc) - offset
    }

    pub async fn associate_with_existing_or_new_exercise(
        user_id: &str,
        exercise_name: &String,
        exercise_lot: ExerciseLot,
        ss: &Arc<SupportingService>,
        unique_exercises: &mut HashMap<String, exercise::Model>,
    ) -> Result<String> {
        let existing_exercise = Exercise::find()
            .filter(exercise::Column::Lot.eq(exercise_lot))
            .filter(exercise::Column::Name.eq(exercise_name))
            .one(&ss.db)
            .await?;
        let generated_id = generate_exercise_id(exercise_name, exercise_lot, user_id);
        let exercise_id = match existing_exercise {
            Some(db_ex) if db_ex.source == ExerciseSource::Github || db_ex.id == generated_id => {
                db_ex.id
            }
            _ => match unique_exercises.get(exercise_name) {
                Some(mem_ex) => mem_ex.id.clone(),
                None => {
                    unique_exercises.insert(
                        exercise_name.clone(),
                        exercise::Model {
                            lot: exercise_lot,
                            id: generated_id.clone(),
                            name: exercise_name.to_owned(),
                            ..Default::default()
                        },
                    );
                    generated_id
                }
            },
        };
        Ok(exercise_id)
    }
}
