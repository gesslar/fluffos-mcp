# FluffOS MCP Server

**Real driver validation for LPC development** - An MCP server that wraps FluffOS CLI tools to provide actual driver-level validation and debugging.

This MCP server exposes FluffOS's powerful CLI utilities (`symbol` and `lpcc`) to AI assistants, enabling them to validate LPC code against the actual driver and examine compiled bytecode.

## What This Enables

✨ **AI assistants can now:**

- Validate LPC files using the actual FluffOS driver (not just syntax checking)
- Catch runtime compilation issues that static analysis misses  
- Examine compiled bytecode to debug performance or behavior issues
- Understand how LPC code actually compiles

## Tools

- 🔍 **`fluffos_validate`**: Validate an LPC file using FluffOS's `symbol` tool
- 🔬 **`fluffos_disassemble`**: Disassemble LPC to bytecode using `lpcc`

## Prerequisites

### 1. FluffOS Installation

You need FluffOS installed with the CLI tools available. The following binaries should exist:

- `symbol` - For validating LPC files
- `lpcc` - For disassembling to bytecode

### 2. Node.js

Node.js 16+ required:

```bash
node --version  # Should be v16.0.0 or higher
```

### 3. Install Dependencies

```bash
cd /path/to/fluffos-mcp
npm install
```

## Configuration

The server requires two environment variables:

- `FLUFFOS_BIN_DIR` - Directory containing FluffOS binaries (`symbol`, `lpcc`)
- `MUD_RUNTIME_CONFIG` - Path to your FluffOS config file (e.g., `/mud/lib/etc/config.test`)

## Setup for Different AI Tools

### Warp (Terminal)

Add to your Warp MCP configuration:

**Location**: Settings → AI → Model Context Protocol

```json
{
  "fluffos": {
    "command": "node",
    "args": ["/absolute/path/to/fluffos-mcp/index.js"],
    "env": {
      "FLUFFOS_BIN_DIR": "/path/to/fluffos/bin",
      "MUD_RUNTIME_CONFIG": "/mud/lib/etc/config.test"
    }
  }
}
```

**Important**: Use absolute paths!

Restart Warp after adding the configuration.

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or equivalent:

```json
{
  "mcpServers": {
    "fluffos": {
      "command": "node",
      "args": ["/absolute/path/to/fluffos-mcp/index.js"],
      "env": {
        "FLUFFOS_BIN_DIR": "/path/to/fluffos/bin",
        "MUD_RUNTIME_CONFIG": "/mud/lib/etc/config.test"
      }
    }
  }
}
```

Restart Claude Desktop after configuration.

## Usage Examples

Once configured, you can ask your AI assistant:

**"Validate this LPC file with the actual driver"**
→ AI uses `fluffos_validate` to run `symbol`

**"Show me the bytecode for this function"**
→ AI uses `fluffos_disassemble` to run `lpcc`

**"Why is this code slow?"**
→ AI examines the disassembly to identify inefficient patterns

## How It Works

```
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
5. AI understands your code at the driver level!

## Complementary Tools

This server works great alongside:

- **[lpc-mcp](https://github.com/gesslar/lpc-mcp)** - Language server integration for code intelligence
- **VS Code with jlchmura's LPC extension** - IDE support

Use them together for the complete LPC development experience!

## Contributing

PRs welcome! This is a simple wrapper that can be extended with more FluffOS tools.

## Credits

- **FluffOS Team** - For the amazing driver and CLI tools
- [Model Context Protocol](https://modelcontextprotocol.io/) - Making this integration possible

## License

Unlicense - Public Domain. Do whatever you want with this code.
