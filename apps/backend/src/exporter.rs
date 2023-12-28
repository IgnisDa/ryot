use apalis::prelude::Storage;
use async_graphql::{Context, Object, Result};
use std::{
    fs::File,
    io::{BufWriter, Write},
    sync::Arc,
};

use crate::{
    background::ApplicationJob, fitness::resolver::ExerciseService,
    miscellaneous::resolver::MiscellaneousService, models::ExportItem, traits::AuthProvider,
};

#[derive(Default)]
pub struct ExporterMutation;

#[Object]
impl ExporterMutation {
    /// Deploy a job to export data for a user.
    async fn deploy_export_job(
        &self,
        gql_ctx: &Context<'_>,
        to_export: Vec<ExportItem>,
    ) -> Result<bool> {
        let service = gql_ctx.data_unchecked::<Arc<ExporterService>>();
        let user_id = service.user_id_from_ctx(gql_ctx).await?;
        service.deploy_export_job(user_id, to_export).await
    }
}

pub struct ExporterService {
    media_service: Arc<MiscellaneousService>,
    exercise_service: Arc<ExerciseService>,
}

impl AuthProvider for ExporterService {}

impl ExporterService {
    pub fn new(
        media_service: Arc<MiscellaneousService>,
        exercise_service: Arc<ExerciseService>,
    ) -> Self {
        Self {
            media_service,
            exercise_service,
        }
    }

    async fn deploy_export_job(&self, user_id: i32, to_export: Vec<ExportItem>) -> Result<bool> {
        self.media_service
            .perform_application_job
            .clone()
            .push(ApplicationJob::PerformExport(user_id, to_export))
            .await?;
        Ok(true)
    }

    pub async fn perform_export(&self, user_id: i32, to_export: Vec<ExportItem>) -> Result<bool> {
        let file = File::create("tmp/output.json").unwrap();
        let mut writer = BufWriter::new(file);
        writer.write_all(b"{").unwrap();
        for (idx, export) in to_export.iter().enumerate() {
            writer
                .write_all(format!(r#""{}":["#, export).as_bytes())
                .unwrap();
            match export {
                ExportItem::Media => {
                    self.media_service
                        .export_media(user_id, &mut writer)
                        .await?
                }
                ExportItem::People => {
                    self.media_service
                        .export_people(user_id, &mut writer)
                        .await?
                }
                ExportItem::Measurements => {
                    self.exercise_service
                        .export_measurements(user_id, &mut writer)
                        .await?
                }
                ExportItem::Workouts => {
                    self.exercise_service
                        .export_workouts(user_id, &mut writer)
                        .await?
                }
            };
            writer.write_all(b"]").unwrap();
            if idx != to_export.len() - 1 {
                writer.write_all(b",").unwrap();
            }
        }
        writer.write_all(b"}").unwrap();
        Ok(true)
    }
}
