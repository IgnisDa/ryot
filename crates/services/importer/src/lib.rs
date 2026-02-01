use std::sync::Arc;

use anyhow::Result;
use chrono::{Duration, Utc};
use common_models::BackgroundJob;
use common_utils::MAX_IMPORT_RETRIES_FOR_PARTIAL_STATE;
use database_models::{import_report, prelude::ImportReport};
use dependent_import_utils::process_import;
use dependent_jobs_utils::deploy_background_job;
use dependent_provider_utils::{
    get_google_books_service, get_hardcover_service, get_openlibrary_service,
    get_tmdb_non_media_service,
};
use enum_models::ImportSource;
use media_models::DeployImportJobInput;
use rust_decimal::dec;
use sea_orm::{
    ActiveModelTrait, ActiveValue, ColumnTrait, EntityTrait, IntoActiveModel, QueryFilter,
    prelude::Expr,
};
use supporting_service::SupportingService;
use traits::TraceOk;

pub mod job_operations;

pub async fn perform_import(
    ss: &Arc<SupportingService>,
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
    let db_import_job = model.insert(&ss.db).await?;
    let import_id = db_import_job.id.clone();
    tracing::debug!("Started import job with id {import_id}");
    let maybe_import = match input.source {
        ImportSource::Igdb => igdb_importer_service::import(input.igdb.unwrap()).await,
        ImportSource::Plex => plex_importer_service::import(input.url_and_key.unwrap()).await,
        ImportSource::Watcharr => watcharr_importer_service::import(input.path.unwrap()).await,
        ImportSource::Jellyfin => jellyfin_importer_service::import(input.jellyfin.unwrap()).await,
        ImportSource::Myanimelist => myanimelist_importer_service::import(input.mal.unwrap()).await,
        ImportSource::Grouvee => grouvee_importer_service::import(input.generic_csv.unwrap()).await,
        ImportSource::Hardcover => {
            hardcover_importer_service::import(input.generic_csv.unwrap()).await
        }
        ImportSource::Movary => movary_importer_service::import(input.movary.unwrap()).await,
        ImportSource::Mediatracker => {
            mediatracker_importer_service::import(input.url_and_key.unwrap()).await
        }
        ImportSource::Netflix => netflix_importer_service::import(input.netflix.unwrap(), ss).await,
        ImportSource::Hevy => {
            hevy_importer_service::import(input.generic_csv.unwrap(), ss, &user_id).await
        }
        ImportSource::GenericJson => {
            generic_json_importer_service::import(input.path.unwrap()).await
        }
        ImportSource::OpenScale => {
            open_scale_importer_service::import(input.generic_csv.unwrap(), &ss.timezone).await
        }
        ImportSource::Anilist => anilist_importer_service::import(input.path.unwrap(), ss).await,
        ImportSource::StrongApp => {
            strong_app_importer_service::import(input.strong_app.unwrap(), ss, &user_id).await
        }
        ImportSource::Trakt => {
            trakt_importer_service::import(
                input.trakt.unwrap(),
                ss.config.server.importer.trakt_client_id.as_str(),
            )
            .await
        }
        ImportSource::Imdb => {
            imdb_importer_service::import(
                input.generic_csv.unwrap(),
                &get_tmdb_non_media_service(ss).await?,
            )
            .await
        }
        ImportSource::Goodreads => {
            goodreads_importer_service::import(
                input.generic_csv.unwrap(),
                &get_hardcover_service(&ss.config).await?,
                &get_google_books_service(&ss.config).await?,
                &get_openlibrary_service(&ss.config).await?,
            )
            .await
        }
        ImportSource::Storygraph => {
            storygraph_importer_service::import(
                input.generic_csv.unwrap(),
                &get_hardcover_service(&ss.config).await?,
                &get_google_books_service(&ss.config).await?,
                &get_openlibrary_service(&ss.config).await?,
            )
            .await
        }
        ImportSource::Audiobookshelf => {
            audiobookshelf_importer_service::import(
                input.url_and_key.unwrap(),
                ss,
                &get_hardcover_service(&ss.config).await?,
                &get_google_books_service(&ss.config).await?,
                &get_openlibrary_service(&ss.config).await?,
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
                import_started_at + Duration::seconds((import.completed.len() * each_item) as i64),
            );
            quick_update_model.update(&ss.db).await?;
            match process_import(true, &user_id, import, ss, |progress| {
                let id = import_id.clone();
                async move {
                    ImportReport::update_many()
                        .filter(import_report::Column::Id.eq(id.clone()))
                        .col_expr(import_report::Column::Progress, Expr::value(progress))
                        .exec(&ss.db)
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
                        BackgroundJob::RecalculateUserActivitiesAndSummary,
                        ss,
                    )
                    .await
                    .trace_ok();
                }
                Err(e) => {
                    tracing::debug!("Error while importing: {:?}", e);
                    model.was_success = ActiveValue::Set(Some(false));
                }
            }
        }
        Err(e) => {
            tracing::debug!("Error while importing: {:?}", e);
            model.was_success = ActiveValue::Set(Some(false));
        }
    }
    model.finished_on = ActiveValue::Set(Some(Utc::now()));
    model.update(&ss.db).await.trace_ok();
    Ok(())
}
