use crate::migrator::{MetadataLot, MetadataSource};

#[derive(Debug)]
pub struct IntegrationService {
    yank: YankIntegrationService,
}

impl IntegrationService {
    pub async fn new() -> Self {
        let yank = YankIntegrationService::new().await;
        Self { yank }
    }
}

#[derive(Debug, Clone)]
pub struct YankIntegrationMedia {
    pub identifier: String,
    pub lot: MetadataLot,
    pub source: MetadataSource,
    pub progress: i32,
}

#[derive(Debug)]
pub struct YankIntegrationService {}

impl YankIntegrationService {
    pub async fn new() -> Self {
        Self {}
    }

    pub async fn audiobookshelf_progress(
        &self,
        base_url: &str,
        token: &str,
    ) -> Vec<YankIntegrationMedia> {
        todo!()
    }
}
