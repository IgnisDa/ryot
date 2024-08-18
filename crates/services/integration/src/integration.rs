use anyhow::Result;

use super::{IntegrationMediaCollection, IntegrationMediaSeen};

pub trait YankIntegration {
    async fn yank_progress(
        &self,
    ) -> Result<(Vec<IntegrationMediaSeen>, Vec<IntegrationMediaCollection>)>;
}

pub trait PushIntegration {
    async fn push_progress(&self) -> Result<()>;
}
