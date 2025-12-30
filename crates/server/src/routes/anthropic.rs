//! Anthropic API client for task generation and code review
//!
//! This module provides a client for calling the Anthropic Messages API
//! to generate task titles and descriptions from natural language input,
//! and to conduct code reviews.

use reqwest::Client;
use serde::{Deserialize, Serialize};
use thiserror::Error;

use super::review::{ReviewFinding, ReviewSummary};

const ANTHROPIC_API_URL: &str = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION: &str = "2023-06-01";
const DEFAULT_MODEL: &str = "claude-sonnet-4-20250514";
const MAX_TOKENS: u32 = 1024;
const REVIEW_MAX_TOKENS: u32 = 4096;

#[derive(Debug, Error)]
pub enum AnthropicError {
    #[error("ANTHROPIC_API_KEY environment variable is not set")]
    MissingApiKey,
    #[error("API request failed: {0}")]
    RequestFailed(#[from] reqwest::Error),
    #[error("API returned error: {status} - {message}")]
    ApiError { status: u16, message: String },
    #[error("Failed to parse response: {0}")]
    ParseError(String),
}

#[derive(Debug, Serialize)]
struct Message {
    role: &'static str,
    content: String,
}

#[derive(Debug, Serialize)]
struct MessagesRequest {
    model: &'static str,
    max_tokens: u32,
    system: String,
    messages: Vec<Message>,
}

#[derive(Debug, Deserialize)]
struct MessagesResponse {
    content: Vec<ContentBlock>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
enum ContentBlock {
    #[serde(rename = "text")]
    Text { text: String },
}

#[derive(Debug, Deserialize)]
struct ApiErrorResponse {
    error: ApiErrorDetail,
}

#[derive(Debug, Deserialize)]
struct ApiErrorDetail {
    message: String,
}

/// Generated task from the AI
#[derive(Debug, Deserialize)]
pub struct GeneratedTask {
    pub title: String,
    pub prompt: String,
}

/// Code review result from the AI
#[derive(Debug, Deserialize)]
pub struct CodeReviewResult {
    /// Overall status: "passed", "failed", "warnings"
    pub status: String,
    /// List of findings from the review
    pub findings: Vec<ReviewFinding>,
    /// Summary statistics
    pub summary: ReviewSummary,
}

/// Anthropic API client
pub struct AnthropicClient {
    client: Client,
    api_key: String,
}

impl AnthropicClient {
    /// Create a new Anthropic client, reading the API key from environment
    pub fn from_env() -> Result<Self, AnthropicError> {
        let api_key =
            std::env::var("ANTHROPIC_API_KEY").map_err(|_| AnthropicError::MissingApiKey)?;

        Ok(Self {
            client: Client::new(),
            api_key,
        })
    }

    /// Generate a task from user input
    pub async fn generate_task(&self, user_input: &str) -> Result<GeneratedTask, AnthropicError> {
        let system_prompt = r#"You are a task generation assistant for a software development project management tool.
Your role is to analyze user requests and generate well-structured tasks with clear titles and detailed prompts.

Guidelines:
1. Create a concise, actionable task title (under 80 characters) that starts with a verb (Implement, Fix, Add, Update, Refactor, etc.)
2. Write a detailed prompt/description that a coding agent can use to implement the task
3. Include specific technical details, acceptance criteria, and implementation hints in the prompt
4. The prompt should be comprehensive enough for an AI coding assistant to understand and execute

You MUST respond with valid JSON in exactly this format:
{
  "title": "Short actionable title starting with a verb",
  "prompt": "Detailed description with technical requirements, acceptance criteria, and implementation guidance"
}"#;

        let user_message = format!(
            "Generate a task from this request:\n\n{}",
            user_input
        );

        let request = MessagesRequest {
            model: DEFAULT_MODEL,
            max_tokens: MAX_TOKENS,
            system: system_prompt.to_string(),
            messages: vec![Message {
                role: "user",
                content: user_message,
            }],
        };

        let response = self
            .client
            .post(ANTHROPIC_API_URL)
            .header("x-api-key", &self.api_key)
            .header("anthropic-version", ANTHROPIC_VERSION)
            .header("content-type", "application/json")
            .json(&request)
            .send()
            .await?;

        let status = response.status();

        if !status.is_success() {
            let error_body = response.text().await.unwrap_or_default();
            let message = serde_json::from_str::<ApiErrorResponse>(&error_body)
                .map(|e| e.error.message)
                .unwrap_or(error_body);

            return Err(AnthropicError::ApiError {
                status: status.as_u16(),
                message,
            });
        }

        let messages_response: MessagesResponse = response.json().await?;

        // Extract text from the first content block
        let text = messages_response
            .content
            .into_iter()
            .find_map(|block| match block {
                ContentBlock::Text { text } => Some(text),
            })
            .ok_or_else(|| AnthropicError::ParseError("No text content in response".to_string()))?;

        // Parse the JSON response
        let generated: GeneratedTask = serde_json::from_str(&text).map_err(|e| {
            AnthropicError::ParseError(format!(
                "Failed to parse task JSON: {}. Response was: {}",
                e, text
            ))
        })?;

        Ok(generated)
    }

    /// Conduct a code review based on task context
    pub async fn conduct_code_review(
        &self,
        task_context: &str,
    ) -> Result<CodeReviewResult, AnthropicError> {
        let system_prompt = r#"You are a code review assistant for a software development project.
Your role is to analyze task descriptions and provide detailed code review feedback.

Guidelines:
1. Identify potential issues, bugs, security concerns, and areas for improvement
2. Categorize findings by severity: "error" (critical issues), "warning" (potential problems), "info" (suggestions), "suggestion" (optional improvements)
3. Categorize findings by type: "security", "performance", "style", "bug", "maintainability", "testing"
4. Provide actionable suggestions for each finding
5. Determine overall status: "failed" if any errors, "warnings" if warnings but no errors, "passed" if clean

You MUST respond with valid JSON in exactly this format:
{
  "status": "passed" | "failed" | "warnings",
  "findings": [
    {
      "filePath": "path/to/file.ts",
      "lineNumber": 42,
      "severity": "error" | "warning" | "info" | "suggestion",
      "category": "security" | "performance" | "style" | "bug" | "maintainability" | "testing",
      "title": "Short description of the issue",
      "description": "Detailed explanation of the finding",
      "suggestion": "How to fix or improve this"
    }
  ],
  "summary": {
    "filesReviewed": 1,
    "errorCount": 0,
    "warningCount": 0,
    "infoCount": 0
  }
}

If the task context doesn't contain enough information for a meaningful review, return a passed status with an info-level finding explaining what additional context would be helpful."#;

        let user_message = format!("Review the following task:\n\n{}", task_context);

        let request = MessagesRequest {
            model: DEFAULT_MODEL,
            max_tokens: REVIEW_MAX_TOKENS,
            system: system_prompt.to_string(),
            messages: vec![Message {
                role: "user",
                content: user_message,
            }],
        };

        let response = self
            .client
            .post(ANTHROPIC_API_URL)
            .header("x-api-key", &self.api_key)
            .header("anthropic-version", ANTHROPIC_VERSION)
            .header("content-type", "application/json")
            .json(&request)
            .send()
            .await?;

        let status = response.status();

        if !status.is_success() {
            let error_body = response.text().await.unwrap_or_default();
            let message = serde_json::from_str::<ApiErrorResponse>(&error_body)
                .map(|e| e.error.message)
                .unwrap_or(error_body);

            return Err(AnthropicError::ApiError {
                status: status.as_u16(),
                message,
            });
        }

        let messages_response: MessagesResponse = response.json().await?;

        // Extract text from the first content block
        let text = messages_response
            .content
            .into_iter()
            .find_map(|block| match block {
                ContentBlock::Text { text } => Some(text),
            })
            .ok_or_else(|| {
                AnthropicError::ParseError("No text content in response".to_string())
            })?;

        // Parse the JSON response
        let review: CodeReviewResult = serde_json::from_str(&text).map_err(|e| {
            AnthropicError::ParseError(format!(
                "Failed to parse review JSON: {}. Response was: {}",
                e, text
            ))
        })?;

        Ok(review)
    }
}
