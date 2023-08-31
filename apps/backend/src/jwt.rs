use anyhow::Result;
use chrono::{Duration, Utc};
use jsonwebtoken::{DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize, Serialize)]
pub struct Claims {
    pub sub: String,
    pub exp: usize,
    pub iat: usize,
}

impl Claims {
    pub fn new(sub: String, token_valid_for_days: i64) -> Self {
        let iat = Utc::now();
        let exp = iat + Duration::days(token_valid_for_days);

        Self {
            sub,
            iat: iat.timestamp().try_into().unwrap(),
            exp: exp.timestamp().try_into().unwrap(),
        }
    }
}

pub fn sign(id: i32, jwt_secret: &str, token_valid_for_days: i64) -> Result<String> {
    let tokens = jsonwebtoken::encode(
        &Header::default(),
        &Claims::new(id.to_string(), token_valid_for_days),
        &EncodingKey::from_secret(jwt_secret.as_bytes()),
    )?;
    Ok(tokens)
}

pub fn verify(token: &str, jwt_secret: &str) -> Result<Claims> {
    let claims = jsonwebtoken::decode(
        token,
        &DecodingKey::from_secret(jwt_secret.as_bytes()),
        &Validation::default(),
    )
    .map(|data| data.claims)?;
    dbg!(&claims);
    Ok(claims)
}
