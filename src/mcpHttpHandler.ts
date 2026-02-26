/**
 * MCP over HTTP (Streamable HTTP) handler.
 * Handles JSON-RPC 2.0 requests: tools/list, tools/call, and optional initialize.
 * See: https://modelcontextprotocol.io/specification/2025-11-25/server/tools
 */

import type { Request, Response } from 'express';
import type { drive_v3, slides_v1 } from 'googleapis';
import { TOOLS, callTool } from './toolsRegistry.js';

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

function isJsonRpcBody(body: unknown): body is JsonRpcRequest {
  return typeof body === 'object' && body !== null && 'method' in body;
}

function sendJsonRpcResponse(res: Response, id: string | number | null, result: unknown) {
  res.setHeader('Content-Type', 'application/json');
  res.json({ jsonrpc: '2.0', id, result });
}

function sendJsonRpcError(res: Response, id: string | number | null, code: number, message: string) {
  res.setHeader('Content-Type', 'application/json');
  res.status(400).json({ jsonrpc: '2.0', id, error: { code, message } });
}

/**
 * Single MCP endpoint: POST with JSON-RPC body.
 * Methods: initialize, tools/list, tools/call
 */
export async function handleMcpRequest(
  req: Request,
  res: Response,
  slides: slides_v1.Slides,
  drive?: drive_v3.Drive
): Promise<void> {
  const body = req.body as unknown;
  if (!isJsonRpcBody(body)) {
    sendJsonRpcError(res, null, -32600, 'Invalid Request: body must be JSON-RPC with method');
    return;
  }

  const { id = null, method, params = {} } = body;

  if (method === 'initialize') {
    sendJsonRpcResponse(res, id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'google-slides-mcp', version: '0.1.0' },
    });
    return;
  }

  // MCP lifecycle notification: client confirms it received initialize result. No response body.
  if (method === 'notifications/initialized') {
    res.status(202).end();
    return;
  }

  if (method === 'tools/list') {
    sendJsonRpcResponse(res, id, { tools: TOOLS });
    return;
  }

  if (method === 'tools/call') {
    const name = params.name as string | undefined;
    const args = params.arguments as unknown;
    if (!name || typeof name !== 'string') {
      sendJsonRpcError(res, id, -32602, 'Invalid params: missing or invalid "name"');
      return;
    }
    try {
      const result = await callTool(slides, name, args, drive);
      sendJsonRpcResponse(res, id, {
        content: result.content,
        isError: result.isError ?? false,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendJsonRpcResponse(res, id, {
        content: [{ type: 'text', text: message }],
        isError: true,
      });
    }
    return;
  }

  sendJsonRpcError(res, id, -32601, `Method not found: ${method}`);
}
