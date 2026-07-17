# FluffOS MCP Server

**Real driver validation for LPC development** - An MCP server that wraps FluffOS CLI tools to provide actual driver-level validation and debugging.

<a href="https://glama.ai/mcp/servers/@gesslar/fluffos-mcp">
  <img width="380" height="200" src="https://glama.ai/mcp/servers/@gesslar/fluffos-mcp/badge" alt="FluffOS Server MCP server" />
</a>

This MCP server exposes FluffOS's powerful CLI utilities (`symbol` and `lpcc`) to AI assistants, enabling them to validate LPC code against the actual driver and examine compiled bytecode.

## What This Enables

**AI assistants can now:**

- Validate LPC files using the actual FluffOS driver (not just syntax checking)
- Catch runtime compilation issues that static analysis misses
- Examine compiled bytecode to debug performance or behavior issues
- Understand how LPC code actually compiles

## Tools

- **`fluffos_validate`**: Validate an LPC file using FluffOS's `symbol` tool
- **`fluffos_disassemble`**: Disassemble LPC to bytecode using `lpcc`
- **`fluffos_doc_lookup`**: Search FluffOS documentation for efuns, applies, concepts, etc.
- **`fluffos_eval`**: Evaluate LPC statements against the **live** driver using `lpcshell` (opt-in)

`fluffos_validate`, `fluffos_disassemble`, and `fluffos_doc_lookup` are **read-only** and **idempotent** — they never modify files, drivers, or running MUDs, and are safe for agents to auto-invoke.

`fluffos_eval` is **not** read-only: it boots the full runtime and **executes** the LPC you give it, so it can have side effects (writing files, mutating daemon/database state, firing events). It is registered only when `FLUFFOS_ENABLE_EVAL` is set, and should not be auto-invoked on untrusted input.

### When to use which tool

| I want to… | Use |
| --- | --- |
| Check whether a file compiles against the driver | `fluffos_validate` |
| See the bytecode a function compiles to | `fluffos_disassemble` |
| Investigate why a pattern is slow | `fluffos_disassemble` |
| Look up an efun signature or apply semantics | `fluffos_doc_lookup` |
| Find out if an efun exists in *this* driver build | `fluffos_validate` on a file that calls it |
| Pre-commit / pre-deploy sanity check | `fluffos_validate` |
| See the actual runtime value/behaviour of an expression | `fluffos_eval` |
| Reproduce a runtime error interactively | `fluffos_eval` |

`fluffos_doc_lookup` is only registered when the server is started with `FLUFFOS_DOCS_DIR` set. `fluffos_eval` is only registered when `FLUFFOS_ENABLE_EVAL` is set.

## Prerequisites

### 1. FluffOS Installation

You need FluffOS installed with the CLI tools available. The following binaries should exist:

- `symbol` - For validating LPC files
- `lpcc` - For disassembling to bytecode
- `lpcshell` - (Optional) For `fluffos_eval`; required only when `FLUFFOS_ENABLE_EVAL` is set

### 2. Node.js

Node.js 16+ required:

```bash
node --version  # Should be v16.0.0 or higher
```

## Installation

You can install the server via npm:

```bash
npm install -g @gesslar/fluffos-mcp
```

Or clone and install locally:

```bash
git clone https://github.com/gesslar/fluffos-mcp.git
cd fluffos-mcp
npm install
```

## Configuration

The server requires these environment variables:

- `FLUFFOS_BIN_DIR` - Directory containing FluffOS binaries (`symbol`, `lpcc`, and optionally `lpcshell`)
- `MUD_RUNTIME_CONFIG_FILE` - Path to your FluffOS config file (e.g., `/mud/lib/etc/config.test`)
- `FLUFFOS_DOCS_DIR` - (Optional) Directory containing FluffOS documentation for doc lookup
- `FLUFFOS_ENABLE_EVAL` - (Optional) Set to `true` (or `1`/`yes`/`on`, case-insensitive) to register `fluffos_eval`, which executes live LPC via `lpcshell`. Off by default — any other value, including `false`/`0` or leaving it unset, keeps the tool disabled because it is not read-only.
- `FLUFFOS_EVAL_TIMEOUT_MS` - (Optional) Wall-clock cap in milliseconds for a single `fluffos_eval` run before the `lpcshell` child is killed. Defaults to `30000` (30s); ignored unless `fluffos_eval` is enabled.
- `FLUFFOS_EVAL_MAX_BYTES` - (Optional) Maximum size in bytes of an `fluffos_eval` `code` payload; larger requests are rejected before anything is written to disk. Defaults to `10485760` (10 MiB); ignored unless `fluffos_eval` is enabled.

## Setup for Different AI Tools

### Warp (Terminal)

Add to your Warp MCP configuration:

**Location**: Settings → AI → Model Context Protocol

**If installed via npm:**

```json
{
  "fluffos": {
    "command": "npx",
    "args": ["@gesslar/fluffos-mcp"],
    "env": {
      "FLUFFOS_BIN_DIR": "/path/to/fluffos/bin",
      "MUD_RUNTIME_CONFIG_FILE": "/mud/lib/etc/config.test",
      "FLUFFOS_DOCS_DIR": "/path/to/fluffos/docs"
    }
  }
}
```

**If cloned locally:**

```json
{
  "fluffos": {
    "command": "node",
    "args": ["/absolute/path/to/fluffos-mcp/index.js"],
    "env": {
      "FLUFFOS_BIN_DIR": "/path/to/fluffos/bin",
      "MUD_RUNTIME_CONFIG_FILE": "/mud/lib/etc/config.test",
      "FLUFFOS_DOCS_DIR": "/path/to/fluffos/docs"
    }
  }
}
```

**Important**: Use absolute paths!

Restart Warp after adding the configuration.

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or equivalent:

**If installed via npm:**

```json
{
  "mcpServers": {
    "fluffos": {
      "command": "npx",
      "args": ["@gesslar/fluffos-mcp"],
      "env": {
        "FLUFFOS_BIN_DIR": "/path/to/fluffos/bin",
        "MUD_RUNTIME_CONFIG_FILE": "/mud/lib/etc/config.test",
        "FLUFFOS_DOCS_DIR": "/path/to/fluffos/docs"
      }
    }
  }
}
```

**If cloned locally:**

```json
{
  "mcpServers": {
    "fluffos": {
      "command": "node",
      "args": ["/absolute/path/to/fluffos-mcp/index.js"],
      "env": {
        "FLUFFOS_BIN_DIR": "/path/to/fluffos/bin",
        "MUD_RUNTIME_CONFIG_FILE": "/mud/lib/etc/config.test",
        "FLUFFOS_DOCS_DIR": "/path/to/fluffos/docs"
      }
    }
  }
}
```

Restart Claude Desktop after configuration.

### Enabling live LPC eval (optional)

The examples above register only the three read-only tools. To also expose
`fluffos_eval` — which boots the driver and **executes** LPC, so it can have
side effects — add `FLUFFOS_ENABLE_EVAL` to the `env` block alongside the
others:

```json
"env": {
  "FLUFFOS_BIN_DIR": "/path/to/fluffos/bin",
  "MUD_RUNTIME_CONFIG_FILE": "/mud/lib/etc/config.test",
  "FLUFFOS_ENABLE_EVAL": "true"
}
```

Accepted "on" values are `true`, `1`, `yes`, or `on` (case-insensitive). Any
other value — or omitting the variable entirely — leaves the tool disabled.
The `lpcshell` binary must exist in `FLUFFOS_BIN_DIR` for this to work.

## Usage Examples

Once configured, you can ask your AI assistant:

**"Validate this LPC file with the actual driver"**
→ AI uses `fluffos_validate` to run `symbol`

**"Show me the bytecode for this function"**
→ AI uses `fluffos_disassemble` to run `lpcc`

**"Why is this code slow?"**
→ AI examines the disassembly to identify inefficient patterns

**"What's the syntax for call_out?"**
→ AI uses `fluffos_doc_lookup` to search documentation

**"How do I use mappings?"**
→ AI searches docs for mapping-related documentation

## How It Works

```text
AI Assistant
    ↓ (natural language)
  MCP Protocol
    ↓ (tool calls: fluffos_validate, fluffos_disassemble)
  This Server
    ↓ (spawns: symbol, lpcc)
  FluffOS CLI Tools
    ↓ (validates/compiles with actual driver)
  Your LPC Code
```

1. AI assistant sends MCP tool requests
2. Server spawns appropriate FluffOS CLI tool
3. CLI tool validates/disassembles using the driver
4. Server returns results to AI
5. AI understands your code at the driver level and can reference FluffOS documentation to explain how functions work!

## Implementation Details

### Architecture

The server is built using the [Model Context Protocol SDK](https://github.com/modelcontextprotocol/sdk) and follows a class-based architecture:

- **FluffOSMCPServer class**: Main server implementation
- **MCP SDK Server**: Handles protocol communication via stdio
- **Child process spawning**: Executes FluffOS CLI tools
- **Path normalization**: Converts absolute paths to mudlib-relative paths

### Path Handling

The server intelligently handles file paths:

1. Parses `mudlib directory` from your FluffOS config file
2. Normalizes absolute paths to mudlib-relative paths
3. Passes normalized paths to FluffOS tools (which expect relative paths)

Example: `/mud/ox/lib/std/object.c` → `std/object.c`

### Tool Implementation

**`fluffos_validate`**:

- Spawns `symbol <config> <file>` from the config directory
- Captures stdout/stderr
- Returns success/failure with compilation errors
- Exit code 0 = validation passed

**`fluffos_disassemble`**:

- Spawns `lpcc <config> <file>` from the config directory
- Returns complete bytecode disassembly
- Includes function tables, strings, and instruction-level detail

**`fluffos_doc_lookup`** (optional):

- Runs `scripts/search_docs.sh` helper script
- Uses `grep` to search markdown files
- Only available if `FLUFFOS_DOCS_DIR` is set

**`fluffos_eval`** (optional):

- Writes the submitted LPC statements to a temporary script file, then spawns `lpcshell <config> <tmpfile>`
- The temp file is a plain OS file (read by `lpcshell` directly, not through the driver's file system) and so does **not** need to live inside the mudlib jail — only the LPC statements execute in-jail
- Boots the full runtime and executes the code; captures stdout/stderr and exit code, then deletes the temp file
- Only available if `FLUFFOS_ENABLE_EVAL` is set

### Error Handling

- Validates required environment variables on startup
- Returns structured error responses via MCP
- Gracefully handles missing config or tool execution failures
- Non-zero exit codes are reported but don't crash the server

## Complementary Tools

This server works great alongside:

- **[lpc-mcp](https://github.com/gesslar/lpc-mcp)** - Language server integration for code intelligence
- **VS Code with jlchmura's LPC extension** - IDE support

Use them together for the complete LPC development experience!

## Contributing

PRs welcome! This is a simple wrapper that can be extended with more FluffOS tools.

## Credits

- [**FluffOS Team**](<https://github.com/fluffos/fluffos>) - For the amazing driver and CLI tools
- [**Model Context Protocol**](<https://modelcontextprotocol.io/>) - Making this integration possible

## License

`@gesslar/fluffos-mcp` is released under the [0BSD](LICENSE.txt).

This package includes or depends on third-party components under their own
licenses:

| Dependency | License |
| --- | --- |
| [@gesslar/toolkit](https://github.com/gesslar/toolkit) | 0BSD |
| [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/typescript-sdk) | MIT |
| [zod](https://github.com/colinhacks/zod) | MIT |
