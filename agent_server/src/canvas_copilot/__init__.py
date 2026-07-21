"""Canvas copilot — Claude embedded on the Experimental v2 smart canvas.

Modules:
- bridge:  in-memory live canvas state (snapshots, pen-event ring, command fan-out)
- tools:   in-process MCP tools (mcp__canvas__*) the copilot uses to see/drive the canvas
- copilot: ClaudeSDKClient session management + WebSocket message relay

Design of record: docs/vault/Canvas Copilot (Claude on the Page).md
"""
