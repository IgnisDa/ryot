use std::{collections::HashMap, path::PathBuf, sync::Arc};

use anyhow::{Result, bail};
use background_models::{ApplicationJob, MpApplicationJob};
use chrono::{DateTime, Utc};
use common_models::ExportJob;
use common_utils::get_temporary_directory;
use nanoid::nanoid;
use reqwest::{
    Body, Client,
    header::{CONTENT_LENGTH, CONTENT_TYPE},
};
use sea_orm::Iterable;
use struson::writer::{JsonStreamWriter, JsonWriter};
use supporting_service::SupportingService;
use tokio::fs::File;
use tokio_util::codec::{BytesCodec, FramedRead};

use crate::{
    collection_exports::export_collections,
    export_utilities::ExportItem,
    fitness_exports::{
        export_exercises, export_measurements, export_workout_templates, export_workouts,
    },
    media_exports::{export_media, export_media_group, export_people},
};

pub async fn deploy_export_job(ss: &Arc<SupportingService>, user_id: String) -> Result<bool> {
    ss.perform_application_job(ApplicationJob::Mp(MpApplicationJob::PerformExport(user_id)))
        .await?;
    Ok(true)
}

pub async fn user_exports(ss: &Arc<SupportingService>, user_id: String) -> Result<Vec<ExportJob>> {
    if !ss.config.file_storage.is_enabled() {
        return Ok(vec![]);
    }
    let mut resp = vec![];
    let objects =
        file_storage_service::list_objects_at_prefix(ss, format!("exports/{user_id}")).await?;
    for (size, key) in objects {
        let url = file_storage_service::get_presigned_url(ss, key.clone()).await?;
        let metadata = file_storage_service::get_object_metadata(ss, key.clone()).await?;
        let started_at =
            DateTime::parse_from_rfc2822(metadata.get("started_at").unwrap())?.with_timezone(&Utc);
        let ended_at =
            DateTime::parse_from_rfc2822(metadata.get("ended_at").unwrap())?.with_timezone(&Utc);
        resp.push(ExportJob {
            key,
            url,
            size,
            ended_at,
            started_at,
        });
    }
    resp.sort_by(|a, b| b.ended_at.cmp(&a.ended_at));
    Ok(resp)
}

pub async fn perform_export(ss: &Arc<SupportingService>, user_id: String) -> Result<()> {
    if !ss.config.file_storage.is_enabled() {
        bail!("File storage needs to be enabled to perform an export.");
    }
    let started_at = Utc::now();
    let export_path =
        PathBuf::from(get_temporary_directory()).join(format!("ryot-export-{}.json", nanoid!()));
    let file = std::fs::File::create(&export_path)?;
    let mut writer = JsonStreamWriter::new(file);
    writer.begin_object()?;

    for export in ExportItem::iter() {
        tracing::debug!("Exporting {export}");
        writer.name(&export.to_string())?;
        writer.begin_array()?;
        match export {
            ExportItem::People => export_people(ss, &user_id, &mut writer).await?,
            ExportItem::Metadata => export_media(ss, &user_id, &mut writer).await?,
            ExportItem::Workouts => export_workouts(ss, &user_id, &mut writer).await?,
            ExportItem::Exercises => export_exercises(ss, &user_id, &mut writer).await?,
            ExportItem::Collections => export_collections(ss, &user_id, &mut writer).await?,
            ExportItem::Measurements => export_measurements(ss, &user_id, &mut writer).await?,
            ExportItem::MetadataGroups => export_media_group(ss, &user_id, &mut writer).await?,
            ExportItem::WorkoutTemplates => {
                export_workout_templates(ss, &user_id, &mut writer).await?
            }
        };
        writer.end_array()?;
    }
    writer.end_object()?;
    writer.finish_document()?;
    tracing::debug!("Exporting completed");
    let ended_at = Utc::now();
    let (_key, url) = file_storage_service::get_presigned_put_url(
        ss,
        format!("exports/{user_id}"),
        false,
        Some(HashMap::from([
            ("started_at".to_string(), started_at.to_rfc2822()),
            ("ended_at".to_string(), ended_at.to_rfc2822()),
        ])),
    )
    .await?;
    let file = File::open(&export_path).await?;
    let content_length = file.metadata().await?.len();
    let content_type = mime_guess::from_path(&export_path).first_or_octet_stream();
    let stream = FramedRead::new(file, BytesCodec::new());
    let body = Body::wrap_stream(stream);
    let client = Client::new();
    client
        .put(url)
        .header(CONTENT_TYPE, content_type.to_string())
        .header(CONTENT_LENGTH, content_length)
        .header("x-amz-meta-started_at", started_at.to_rfc2822())
        .header("x-amz-meta-ended_at", ended_at.to_rfc2822())
        .body(body)
        .send()
        .await?;
    Ok(())
}
