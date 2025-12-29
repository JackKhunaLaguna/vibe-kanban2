/**
 * Project context information used to enhance task generation prompts.
 */
export interface ProjectContext {
  /** Technology stack (e.g., "TypeScript, Next.js, React") */
  techStack?: string;
  /** Project structure description or key directories */
  projectStructure?: string;
  /** Coding standards and conventions to follow */
  codingStandards?: string;
  /** Additional context about the project */
  additionalContext?: string;
}

/**
 * Builds a meta-prompt that instructs Claude to generate an optimized task title
 * and Claude Code prompt from natural language user input.
 *
 * @param userInput - The user's natural language description of the task
 * @param projectContext - Optional context about the project to include in the prompt
 * @returns A prompt string to send to Claude for task generation
 */
export function buildTaskGenerationPrompt(
  userInput: string,
  projectContext?: ProjectContext
): string {
  const contextSection = buildContextSection(projectContext);

  return `You are an expert at converting natural language task descriptions into well-structured technical tasks for Claude Code.

Your job is to analyze the user's input and generate:
1. A clear, technical task title
2. A detailed Claude Code prompt optimized for implementation

${contextSection}
## User Input

<user_input>
${userInput}
</user_input>

## Instructions

Analyze the user's input and generate a task title and Claude Code prompt following these guidelines:

### Task Title Guidelines
- Keep it concise (under 80 characters)
- Use imperative mood (e.g., "Add", "Fix", "Implement", "Refactor")
- Be specific about what will be done
- Avoid vague terms like "update" or "change" unless appropriate
- Include the affected component or area when relevant

### Claude Code Prompt Guidelines

Generate a prompt that includes:

1. **Clear Objective**: Start with a single sentence describing what needs to be accomplished.

2. **Technical Approach**: Suggest a concrete technical approach, including:
   - Specific patterns or architectures to use
   - Libraries or APIs to leverage
   - Key functions or components to create/modify

3. **File Paths**: When determinable from context, include:
   - Files to create or modify
   - Files to reference for patterns or context
   - Test files to add or update

4. **Acceptance Criteria**: List specific, verifiable criteria:
   - Functional requirements
   - Edge cases to handle
   - Error handling expectations
   - Performance considerations (if applicable)

5. **Testing Considerations**: Include testing guidance:
   - Types of tests to write (unit, integration, e2e)
   - Key test scenarios
   - Mocking requirements

### Prompt Best Practices

- Be specific and actionable, not vague
- Include enough context for Claude Code to work autonomously
- Reference existing patterns in the codebase when applicable
- Specify coding standards to follow
- Avoid over-specifying implementation details that Claude should decide
- Use clear formatting with headers and bullet points

## Output Format

Return your response as valid JSON with this exact structure:

\`\`\`json
{
  "title": "Imperative task title under 80 chars",
  "prompt": "Detailed Claude Code prompt with all sections..."
}
\`\`\`

Important:
- The JSON must be valid and parseable
- Escape any special characters in strings properly
- The prompt should be a single string with \\n for newlines
- Do not include markdown code fences inside the JSON values`;
}

/**
 * Builds the project context section of the prompt.
 */
function buildContextSection(projectContext?: ProjectContext): string {
  if (!projectContext) {
    return '';
  }

  const sections: string[] = ['## Project Context\n'];

  if (projectContext.techStack) {
    sections.push(`**Tech Stack:** ${projectContext.techStack}\n`);
  }

  if (projectContext.projectStructure) {
    sections.push(
      `**Project Structure:**\n${projectContext.projectStructure}\n`
    );
  }

  if (projectContext.codingStandards) {
    sections.push(
      `**Coding Standards:**\n${projectContext.codingStandards}\n`
    );
  }

  if (projectContext.additionalContext) {
    sections.push(
      `**Additional Context:**\n${projectContext.additionalContext}\n`
    );
  }

  return sections.length > 1 ? sections.join('\n') + '\n' : '';
}
