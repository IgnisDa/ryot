use anyhow::Result;

use crate::IntegrationMediaCollection;
use crate::IntegrationMediaSeen;

pub trait Integration {
    async fn progress(&self) -> Result<(Vec<IntegrationMediaSeen>, Vec<IntegrationMediaCollection>)>;
}
