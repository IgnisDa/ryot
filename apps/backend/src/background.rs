use apalis::prelude::{Job, JobContext, JobError, JobResult};
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize, Serialize)]
pub struct RefreshMedia {}

impl Job for RefreshMedia {
    const NAME: &'static str = "apalis::RefreshMedia";
}

pub async fn refresh_media(
    information: RefreshMedia,
    ctx: JobContext,
) -> Result<JobResult, JobError> {
    tracing::trace!("Refreshing media items");
    Ok(JobResult::Success)
}
