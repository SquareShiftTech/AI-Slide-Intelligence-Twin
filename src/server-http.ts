import express from 'express';
import cors from 'cors';
import { google } from 'googleapis';
import { checkEnvironmentVariables } from './utils/envCheck.js';
import { CreatePresentationFromContentSchema } from './schemas.js';
import { createPresentationFromContent } from './tools/createPresentationFromContent.js';
import { TOOLS, callTool } from './toolsRegistry.js';
import { handleMcpRequest } from './mcpHttpHandler.js';

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN;
const PORT = Number(process.env.PORT) || 3000;

checkEnvironmentVariables();

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

let slidesClient: ReturnType<typeof google.slides>;
let driveClient: ReturnType<typeof google.drive>;

const initAuth = () => {
  const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET);
  oauth2Client.setCredentials({ refresh_token: REFRESH_TOKEN });
  slidesClient = google.slides({ version: 'v1', auth: oauth2Client });
  driveClient = google.drive({ version: 'v3', auth: oauth2Client });
};

/**
 * POST /slides
 * Body: { title: string, slides: Array<{ title?, subtitle?, body?, bullets?, notes? }> }
 * Returns: { presentationId, editUrl, title } for the agent to display to the user.
 */
app.post('/slides', async (req, res) => {
  try {
    const parsed = CreatePresentationFromContentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Invalid request body',
        details: parsed.error.errors.map((e) => ({ path: e.path.join('.'), message: e.message })),
      });
      return;
    }
    const result = await createPresentationFromContent(slidesClient, parsed.data, { drive: driveClient });
    res.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('POST /slides error:', err);
    res.status(500).json({ error: 'Failed to create presentation', message });
  }
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'google-slides-mcp' });
});

/**
 * GET /tools — returns { tools } (plain JSON).
 * POST /tools — if body is JSON-RPC (method/id), responds with MCP JSON-RPC (tools/list result).
 *   Otherwise returns { tools }. Elastic MCP connector POSTs JSON-RPC here for listTools.
 */
app.get('/tools', (_req, res) => {
  res.json({ tools: TOOLS });
});
app.post('/tools', async (req, res) => {
  const body = req.body as unknown;
  if (typeof body === 'object' && body !== null && 'method' in body && 'id' in body) {
    await handleMcpRequest(req, res, slidesClient, driveClient);
    return;
  }
  res.json({ tools: TOOLS });
});

/**
 * POST /mcp — single MCP endpoint (Streamable HTTP).
 * Body: JSON-RPC 2.0 with method: "tools/list" | "tools/call" | "initialize".
 * Use this URL in Elastic connector when the connector expects a single MCP endpoint.
 */
app.post('/mcp', async (req, res) => {
  await handleMcpRequest(req, res, slidesClient, driveClient);
});
app.get('/mcp', (_req, res) => {
  res.status(405).setHeader('Content-Type', 'application/json').json({
    error: 'Method Not Allowed',
    message: 'MCP endpoint accepts POST with JSON-RPC body (method: tools/list, tools/call, initialize).',
  });
});

/**
 * POST /tools/call
 * Body: { "name": "tool_name", "arguments": { ... } }
 * Executes the tool and returns { success, content?, error?, errorCode? }.
 */
app.post('/tools/call', async (req, res) => {
  try {
    const { name, arguments: args } = req.body ?? {};
    if (!name || typeof name !== 'string') {
      res.status(400).json({ success: false, error: 'Missing or invalid "name" in request body.' });
      return;
    }
    const result = await callTool(slidesClient, name, args, driveClient);
    const text = result.content?.[0]?.type === 'text' ? result.content[0].text : JSON.stringify(result.content);
    if (result.isError) {
      res.status(400).json({
        success: false,
        error: text,
        errorCode: result.errorCode,
      });
      return;
    }
    res.json({ success: true, content: text });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('POST /tools/call error:', err);
    res.status(500).json({ success: false, error: message });
  }
});

const server = app.listen(PORT, () => {
  initAuth();
  console.error(`Google Slides MCP server running at http://localhost:${PORT}`);
  console.error('GET /tools — list tools (plain JSON)');
  console.error('POST /tools — list tools (plain or MCP JSON-RPC tools/list)');
  console.error('POST /mcp — MCP JSON-RPC endpoint (tools/list, tools/call, initialize)');
  console.error('POST /tools/call — execute tool by name (plain JSON)');
  console.error('POST /slides — create presentation from content, returns editUrl');
});

process.on('SIGINT', () => {
  server.close(() => process.exit(0));
});
process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});
