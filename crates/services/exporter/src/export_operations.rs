use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::Arc,
};

use anyhow::{Context, Result, bail};
use background_models::{ApplicationJob, MpApplicationJob};
use chrono::{DateTime, Utc};
use common_models::ExportJob;
use common_utils::{get_temporary_directory, ryot_log};
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

const ENDED_AT_KEY: &str = "ended-at";
const STARTED_AT_KEY: &str = "started-at";

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
        let started_at = export_timestamp(&metadata, STARTED_AT_KEY)?;
        let ended_at = export_timestamp(&metadata, ENDED_AT_KEY)?;
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
        ryot_log!(debug, "Exporting {export}");
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
    ryot_log!(debug, "Exporting completed");
    let ended_at = Utc::now();
    let (_key, url) = file_storage_service::get_presigned_put_url(
        ss,
        format!("exports/{user_id}"),
        false,
        Some(HashMap::from([
            (ENDED_AT_KEY.to_string(), ended_at.to_rfc2822()),
            (STARTED_AT_KEY.to_string(), started_at.to_rfc2822()),
        ])),
    )
    .await?;
    upload_export(url, &export_path, started_at, ended_at).await
}

fn export_timestamp(metadata: &HashMap<String, String>, key: &str) -> Result<DateTime<Utc>> {
    let value = metadata
        .get(key)
        .or_else(|| metadata.get(&key.replace('-', "_")))
        .with_context(|| format!("Export metadata is missing \"{key}\""))?;
    Ok(DateTime::parse_from_rfc2822(value)?.with_timezone(&Utc))
}

async fn upload_export(
    url: String,
    export_path: &Path,
    started_at: DateTime<Utc>,
    ended_at: DateTime<Utc>,
) -> Result<()> {
    let file = File::open(export_path).await?;
    let content_length = file.metadata().await?.len();
    let content_type = mime_guess::from_path(export_path).first_or_octet_stream();
    let stream = FramedRead::new(file, BytesCodec::new());
    let body = Body::wrap_stream(stream);
    let client = Client::new();
    client
        .put(url)
        .header(CONTENT_TYPE, content_type.to_string())
        .header(CONTENT_LENGTH, content_length)
        .header(format!("x-amz-meta-{ENDED_AT_KEY}"), ended_at.to_rfc2822())
        .header(
            format!("x-amz-meta-{STARTED_AT_KEY}"),
            started_at.to_rfc2822(),
        )
        .body(body)
        .send()
        .await?
        .error_for_status()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::TcpListener,
        task::JoinHandle,
    };

    use super::*;

    async fn storage_server(status: &'static str) -> (String, JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!(
            "http://{}/exports/user/export",
            listener.local_addr().unwrap()
        );
        let handle = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = Vec::new();
            let mut buffer = [0; 1024];
            let head_end = loop {
                let read = socket.read(&mut buffer).await.unwrap();
                request.extend_from_slice(&buffer[..read]);
                if let Some(end) = request.windows(4).position(|w| w == b"\r\n\r\n") {
                    break end + 4;
                }
            };
            let head = String::from_utf8_lossy(&request[..head_end]).to_lowercase();
            let content_length = head
                .lines()
                .find_map(|line| line.strip_prefix("content-length:"))
                .map(|value| value.trim().parse::<usize>().unwrap())
                .unwrap_or_default();
            while request.len() < head_end + content_length {
                let read = socket.read(&mut buffer).await.unwrap();
                request.extend_from_slice(&buffer[..read]);
            }
            let response =
                format!("HTTP/1.1 {status}\r\ncontent-length: 0\r\nconnection: close\r\n\r\n");
            socket.write_all(response.as_bytes()).await.unwrap();
            head
        });
        (url, handle)
    }

    fn export_file() -> PathBuf {
        let path = PathBuf::from(get_temporary_directory())
            .join(format!("ryot-export-test-{}.json", nanoid!()));
        std::fs::write(&path, "{}").unwrap();
        path
    }

    fn timestamps() -> (DateTime<Utc>, DateTime<Utc>) {
        let started_at = DateTime::parse_from_rfc3339("2026-10-01T10:00:00Z").unwrap();
        let ended_at = DateTime::parse_from_rfc3339("2026-10-01T10:05:00Z").unwrap();
        (started_at.with_timezone(&Utc), ended_at.with_timezone(&Utc))
    }

    #[tokio::test]
    async fn upload_sends_metadata_headers_without_underscores() {
        let path = export_file();
        let (started_at, ended_at) = timestamps();
        let (url, server) = storage_server("200 OK").await;
        upload_export(url, &path, started_at, ended_at)
            .await
            .unwrap();
        let head = server.await.unwrap();
        std::fs::remove_file(&path).unwrap();
        assert!(head.contains(&format!(
            "x-amz-meta-started-at: {}",
            started_at.to_rfc2822().to_lowercase()
        )));
        assert!(head.contains(&format!(
            "x-amz-meta-ended-at: {}",
            ended_at.to_rfc2822().to_lowercase()
        )));
        let header_names = head.lines().skip(1).filter_map(|line| line.split_once(':'));
        assert!(
            header_names
                .map(|(name, _)| name)
                .all(|name| !name.contains('_'))
        );
    }

    #[tokio::test]
    async fn upload_fails_when_storage_rejects_the_export() {
        let path = export_file();
        let (started_at, ended_at) = timestamps();
        let (url, server) = storage_server("403 Forbidden").await;
        let result = upload_export(url, &path, started_at, ended_at).await;
        server.await.unwrap();
        std::fs::remove_file(&path).unwrap();
        assert!(result.is_err());
    }

    #[test]
    fn export_timestamps_are_read_from_current_and_legacy_metadata_keys() {
        let (started_at, ended_at) = timestamps();
        let current = HashMap::from([
            ("started-at".to_owned(), started_at.to_rfc2822()),
            ("ended-at".to_owned(), ended_at.to_rfc2822()),
        ]);
        let legacy = HashMap::from([
            ("started_at".to_owned(), started_at.to_rfc2822()),
            ("ended_at".to_owned(), ended_at.to_rfc2822()),
        ]);
        for metadata in [current, legacy] {
            assert_eq!(
                export_timestamp(&metadata, "started-at").unwrap(),
                started_at
            );
            assert_eq!(export_timestamp(&metadata, "ended-at").unwrap(), ended_at);
        }
    }

    #[test]
    fn missing_export_timestamp_is_an_error() {
        assert!(export_timestamp(&HashMap::new(), "started-at").is_err());
    }
}
