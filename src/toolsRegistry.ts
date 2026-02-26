import type { drive_v3, slides_v1 } from 'googleapis';
import {
  CreatePresentationArgsSchema,
  GetPresentationArgsSchema,
  BatchUpdatePresentationArgsSchema,
  GetPageArgsSchema,
  SummarizePresentationArgsSchema,
  CreatePresentationFromContentSchema,
} from './schemas.js';
import { createPresentationTool } from './tools/createPresentation.js';
import { getPresentationTool } from './tools/getPresentation.js';
import { batchUpdatePresentationTool } from './tools/batchUpdatePresentation.js';
import { getPageTool } from './tools/getPage.js';
import { summarizePresentationTool } from './tools/summarizePresentation.js';
import { createPresentationFromContent } from './tools/createPresentationFromContent.js';
import { executeTool } from './utils/toolExecutor.js';

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/**
 * All tools exposed for Elastic Agent Builder MCP setup.
 * GET /tools returns this list.
 */
export const TOOLS: ToolDefinition[] = [
  {
    name: 'create_presentation',
    description: 'Create a new Google Slides presentation. Returns presentationId and editUrl.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'The title of the presentation.' },
      },
      required: ['title'],
    },
  },
  {
    name: 'create_presentation_from_content',
    description: 'Create a full presentation from structured slide content (title + slides array). Returns presentationId and editUrl. Optional templatePresentationId: copy a Google Slides template (preserves theme/layout) and fill placeholders.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Deck title.' },
        slides: {
          type: 'array',
          description: 'At least one slide. Each can have title, subtitle, body, bullets (array of strings), notes.',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              subtitle: { type: 'string' },
              body: { type: 'string' },
              bullets: { type: 'array', items: { type: 'string' } },
              notes: { type: 'string' },
            },
          },
        },
        templatePresentationId: { type: 'string', description: 'Optional. Google Slides presentation ID to use as template. Copy is made and filled with content; preserves template theme and layout. Template must have at least one slide with TITLE and BODY/SUBTITLE placeholders.' },
      },
      required: ['title', 'slides'],
    },
  },
  {
    name: 'get_presentation',
    description: 'Get details about a Google Slides presentation.',
    inputSchema: {
      type: 'object',
      properties: {
        presentationId: { type: 'string', description: 'The ID of the presentation to retrieve.' },
        fields: { type: 'string', description: 'Optional. Field mask (e.g. "slides,pageSize").' },
      },
      required: ['presentationId'],
    },
  },
  {
    name: 'batch_update_presentation',
    description: 'Apply a batch of updates to a Google Slides presentation (add slides, insert text, etc.).',
    inputSchema: {
      type: 'object',
      properties: {
        presentationId: { type: 'string', description: 'The ID of the presentation to update.' },
        requests: { type: 'array', description: 'Array of Google Slides API batchUpdate request objects.', items: { type: 'object' } },
        writeControl: { type: 'object', description: 'Optional. requiredRevisionId / targetRevisionId.' },
      },
      required: ['presentationId', 'requests'],
    },
  },
  {
    name: 'get_page',
    description: 'Get details about a specific page (slide) in a presentation.',
    inputSchema: {
      type: 'object',
      properties: {
        presentationId: { type: 'string', description: 'The ID of the presentation.' },
        pageObjectId: { type: 'string', description: 'The object ID of the page (slide) to retrieve.' },
      },
      required: ['presentationId', 'pageObjectId'],
    },
  },
  {
    name: 'summarize_presentation',
    description: 'Extract text content from all slides for summarization. Optionally include speaker notes.',
    inputSchema: {
      type: 'object',
      properties: {
        presentationId: { type: 'string', description: 'The ID of the presentation to summarize.' },
        include_notes: { type: 'boolean', description: 'Whether to include speaker notes (default: false).' },
      },
      required: ['presentationId'],
    },
  },
];

type McpToolResult = { content: Array<{ type: string; text: string }>; isError?: boolean; errorCode?: number };

/**
 * Execute a tool by name with the given arguments.
 * Used by POST /tools/call. drive is required for create_presentation_from_content when using a template.
 */
export async function callTool(
  slides: slides_v1.Slides,
  name: string,
  args: unknown,
  drive?: drive_v3.Drive
): Promise<McpToolResult> {
  switch (name) {
    case 'create_presentation':
      return executeTool(slides, name, args, CreatePresentationArgsSchema, createPresentationTool);
    case 'create_presentation_from_content': {
      const parsed = CreatePresentationFromContentSchema.safeParse(args);
      if (!parsed.success) {
        return {
          content: [{ type: 'text', text: parsed.error.errors.map((e) => e.message).join('; ') }],
          isError: true,
        };
      }
      const result = await createPresentationFromContent(slides, parsed.data, { drive });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
    case 'get_presentation':
      return executeTool(slides, name, args, GetPresentationArgsSchema, getPresentationTool);
    case 'batch_update_presentation':
      return executeTool(slides, name, args, BatchUpdatePresentationArgsSchema, batchUpdatePresentationTool);
    case 'get_page':
      return executeTool(slides, name, args, GetPageArgsSchema, getPageTool);
    case 'summarize_presentation':
      return executeTool(slides, name, args, SummarizePresentationArgsSchema, summarizePresentationTool);
    default:
      return {
        content: [{ type: 'text', text: `Unknown tool: ${name}` }],
        isError: true,
      };
  }
}
