#!/usr/bin/env node

import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js"
import {StdioServerTransport} from "@modelcontextprotocol/sdk/server/stdio.js"
import * as z from "zod/v4"
import {spawn} from "child_process"
import {FileObject, DirectoryObject, Sass} from "@gesslar/toolkit"
import url from "node:url"

export class FluffOSMCPServer {
  constructor() {
    this.server = new McpServer(
      {
        name: "fluffos-mcp-server",
        version: "0.1.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    )

    this.binDir = process.env.FLUFFOS_BIN_DIR
    this.configFile = process.env.MUD_RUNTIME_CONFIG_FILE
    this.docsDir = process.env.FLUFFOS_DOCS_DIR
    this.mudlibDir = null
  }

  async initialize() {
    if(!this.binDir) {
      console.error("Error: FLUFFOS_BIN_DIR environment variable not set")
      process.exit(1)
    }

    if(!this.configFile) {
      console.error("Error: MUD_RUNTIME_CONFIG_FILE environment variable not set")
      process.exit(1)
    }

    // Parse mudlib directory from config file
    this.mudlibDir = await this.parseMudlibDir()

    console.error(`FluffOS bin directory: ${this.binDir}`)
    console.error(`FluffOS config file: ${this.configFile}`)
    console.error(`Mudlib directory: ${this.mudlibDir || "(not found in config)"}`)

    if(this.docsDir)
      console.error(`FluffOS docs directory: ${this.docsDir}`)
    else
      console.error(`FluffOS docs directory: not set (doc lookup disabled)`)

    this.setupTools()
  }

  async parseMudlibDir() {
    try {
      const configFile = new FileObject(this.configFile)
      const configContent = await configFile.read()
      const {mudlib} = /^mudlib directory\s*:\s*(?<mudlib>.+)$/m.exec(configContent)?.groups ?? {}
      const trimmed = mudlib?.trim()

      if(!trimmed)
        throw Sass.new(`No such entry 'mudlib directory' in ${configFile.path}`)

      return trimmed
    } catch(error) {
      console.error(`Warning: Could not parse mudlib directory from config: ${error.message}`)
    }

    return null
  }

  normalizePath(lpcFile) {
    // If we have a mudlib directory and the file path is absolute and starts with mudlib dir,
    // convert it to a relative path
    if(this.mudlibDir &&
      lpcFile.startsWith("/") &&
      lpcFile.startsWith(this.mudlibDir)
    ) {
      // Remove mudlib directory prefix and leading slash
      return lpcFile.substring(this.mudlibDir.length).replace(/^\/+/, "")
    }

    // Otherwise return as-is (already relative or not under mudlib)
    return lpcFile
  }

  setupTools() {
    // Register validate tool
    this.server.registerTool("fluffos_validate", {
      title: "Validate LPC File",
      description:
        "Compile an LPC source file against the live FluffOS driver using the `symbol` CLI, without loading it into a running MUD.\n\n" +
        "**Use when:**\n" +
        "- Confirming a file will load cleanly (pre-commit, pre-deploy, or after edits).\n" +
        "- Surfacing driver-level errors that static analysis and editor linting miss (inherit resolution, sefun availability, efun signatures, driver-specific semantics).\n" +
        "- Verifying a fix before disassembly or runtime testing.\n\n" +
        "**Do not use for:**\n" +
        "- Runtime behaviour testing — this only validates compilation. Exercise behaviour in the MUD itself.\n" +
        "- Performance analysis — follow up with `fluffos_disassemble` for that.\n\n" +
        "**Returns** a text block: `✓ File validated successfully` plus any driver output on success, or `✗ Validation failed (exit code: N)` plus the compiler errors on failure. A matching `structuredContent` payload with `success`, `exitCode`, and `output` fields is also returned. Read-only and idempotent — never modifies files, drivers, or running MUDs.\n\n" +
        "**Related tools:** `fluffos_disassemble` for bytecode inspection once validation passes; `fluffos_doc_lookup` for reference material on efuns, applies, or concepts cited in error messages.",
      inputSchema: {
        file: z.string().describe(
          "Path to the LPC source file. Absolute paths under the configured mudlib directory are automatically normalised to mudlib-relative; paths already relative to the mudlib root work as-is. Typical extensions: `.c` (LPC source) or `.h` (header). Examples: `/mud/lib/std/object.c`, `std/object.c`, `room/village/square.c`."
        ),
      },
      outputSchema: {
        success: z.boolean().describe("True when the driver compiled the file with exit code 0."),
        exitCode: z.number().int().describe("Exit code from the `symbol` binary. 0 indicates compilation success; any other value indicates failure."),
        output: z.string().describe("Combined stdout and stderr from the driver — informational messages on success, compiler errors on failure."),
      },
      annotations: {
        title: "Validate LPC File",
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    }, async({file}) => {
      try {
        const result = await this.runSymbol(file)
        const text = result.success
          ? `✓ File validated successfully\n\n${result.output}`
          : `✗ Validation failed (exit code: ${result.exitCode})\n\n${result.output}`

        return {
          content: [
            {
              type: "text",
              text,
            },
          ],
          structuredContent: result,
        }
      } catch(error) {
        return {
          content: [
            {
              type: "text",
              text: `Error: ${error.message}`,
            },
          ],
          isError: true,
        }
      }
    })

    // Register disassemble tool
    this.server.registerTool("fluffos_disassemble", {
      title: "Disassemble LPC Bytecode",
      description:
        "Compile an LPC file with the `lpcc` CLI and return the resulting bytecode disassembly.\n\n" +
        "**Use when:**\n" +
        "- Debugging unexpected runtime behaviour by inspecting the instruction stream.\n" +
        "- Comparing two implementations for generated-code efficiency.\n" +
        "- Understanding how closures, inherited calls, or control flow resolve at the bytecode level.\n" +
        "- Investigating why a particular pattern is slow.\n\n" +
        "**Do not use for:**\n" +
        "- Quick validity checks — prefer `fluffos_validate`, which is faster and far easier to read.\n" +
        "- Anything requiring a running MUD state — this is a static compile/disassemble only.\n\n" +
        "**Returns** the full disassembly as text: program header, function table, string table, and per-function instruction listings. On compile failure the text is an error block containing the driver's output and a non-zero exit code. A matching `structuredContent` payload with `success`, `exitCode`, and `output` fields is also returned. Read-only and idempotent.\n\n" +
        "**Related tools:** `fluffos_validate` to confirm the file compiles before chasing disassembly quirks; `fluffos_doc_lookup` to look up efun semantics referenced in the bytecode.",
      inputSchema: {
        file: z.string().describe(
          "Path to the LPC source file. Same path semantics as `fluffos_validate`: absolute paths under the mudlib are normalised, and mudlib-relative paths pass through. Examples: `/mud/lib/std/object.c`, `std/object.c`."
        ),
      },
      outputSchema: {
        success: z.boolean().describe("True when the file compiled and disassembly was produced."),
        exitCode: z.number().int().describe("Exit code from `lpcc`. 0 indicates success."),
        output: z.string().describe("Full disassembly text on success, or compiler error output on failure."),
      },
      annotations: {
        title: "Disassemble LPC Bytecode",
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    }, async({file}) => {
      try {
        const result = await this.runLpcc(file)
        const text = result.success
          ? result.output
          : `Error (exit code: ${result.exitCode}):\n\n${result.output}`

        return {
          content: [
            {
              type: "text",
              text,
            },
          ],
          structuredContent: result,
        }
      } catch(error) {
        return {
          content: [
            {
              type: "text",
              text: `Error: ${error.message}`,
            },
          ],
          isError: true,
        }
      }
    })

    // Register doc lookup tool (conditional)
    if(this.docsDir) {
      this.server.registerTool("fluffos_doc_lookup", {
        title: "Search FluffOS Documentation",
        description:
          "Search the local FluffOS markdown documentation tree for a keyword using ripgrep (with a grep fallback).\n\n" +
          "**Use when:**\n" +
          "- Looking up efun signatures (e.g. `call_out`, `write`, `this_object`).\n" +
          "- Finding apply semantics (e.g. `heart_beat`, `create`, `reset`).\n" +
          "- Exploring configuration directives or LPC language concepts.\n" +
          "- Getting three lines of surrounding context for each documentation hit.\n\n" +
          "**Do not use for:**\n" +
          "- Verifying whether an efun exists in *your* specific driver build — use `fluffos_validate` on a test file that calls it.\n" +
          "- Full-text code search across your mudlib — this only searches the docs tree.\n\n" +
          "**Returns** `Found documentation for \"<query>\":` followed by match blocks with file paths and surrounding context, or `No documentation found for \"<query>\".` if nothing matched. A matching `structuredContent` payload with `found`, `query`, and `results` fields is also returned. Read-only and idempotent. Only registered when the server was started with the `FLUFFOS_DOCS_DIR` environment variable set.\n\n" +
          "**Related tools:** `fluffos_validate` and `fluffos_disassemble` for checking how documented features actually compile in your driver build.",
        inputSchema: {
          query: z.string().describe(
            "Case-insensitive search term, matched as a literal substring (not a regex). Examples: `call_out`, `mapping`, `LPC_OPTIMIZE_LOOPS`, `heart_beat`, `sprintf`. Shorter, more specific terms produce the most useful results."
          ),
        },
        outputSchema: {
          found: z.boolean().describe("True when at least one documentation match was found."),
          query: z.string().describe("The search term that was used."),
          results: z.string().describe("The full result text — either match blocks or the 'no documentation found' message."),
        },
        annotations: {
          title: "Search FluffOS Documentation",
          readOnlyHint: true,
          idempotentHint: true,
          openWorldHint: false,
        },
      }, async({query}) => {
        try {
          const result = await this.searchDocs(query)
          const text = result.found
            ? `Found documentation for "${result.query}":\n\n${result.results}`
            : `No documentation found for "${result.query}".`

          return {
            content: [
              {
                type: "text",
                text,
              },
            ],
            structuredContent: result,
          }
        } catch(error) {
          return {
            content: [
              {
                type: "text",
                text: `Error: ${error.message}`,
              },
            ],
            isError: true,
          }
        }
      })
    }
  }

  async runSymbol(lpcFile) {
    return new Promise((resolve, reject) => {
      const normalizedPath = this.normalizePath(lpcFile)
      const binDir = new DirectoryObject(this.binDir)
      const symbolPath = binDir.getFile("symbol").path
      const configFile = new FileObject(this.configFile)
      const proc = spawn(symbolPath, [this.configFile, normalizedPath], {
        cwd: configFile.parentPath,
      })

      let stdout = ""
      let stderr = ""

      proc.stdout.on("data", data => {
        stdout += data.toString()
      })

      proc.stderr.on("data", data => {
        stderr += data.toString()
      })

      proc.on("close", code => {
        const output = (stdout + stderr).trim()

        resolve({
          success: code === 0,
          exitCode: code,
          output,
        })
      })

      proc.on("error", err => {
        reject(new Error(`Failed to run symbol: ${err.message}`))
      })
    })
  }

  async runLpcc(lpcFile) {
    return new Promise((resolve, reject) => {
      const normalizedPath = this.normalizePath(lpcFile)
      const binDir = new DirectoryObject(this.binDir)
      const lpccPath = binDir.getFile("lpcc").path
      const configFile = new FileObject(this.configFile)
      const proc = spawn(lpccPath, [this.configFile, normalizedPath], {
        cwd: configFile.parentPath,
      })

      let stdout = ""
      let stderr = ""

      proc.stdout.on("data", data => {
        stdout += data.toString()
      })

      proc.stderr.on("data", data => {
        stderr += data.toString()
      })

      proc.on("close", code => {
        const output = (stdout + stderr).trim()

        resolve({
          success: code === 0,
          exitCode: code,
          output,
        })
      })

      proc.on("error", err => {
        reject(new Error(`Failed to run lpcc: ${err.message}`))
      })
    })
  }

  async searchDocs(query) {
    return new Promise((resolve, reject) => {
      const scriptsFile = new FileObject(
        "src/search_docs.sh",
        url.fileURLToPath(new url.URL(import.meta.url))
      )

      console.error(`Loading ${scriptsFile.path}`)

      const scriptPath = scriptsFile.path
      const proc = spawn(scriptPath, [this.docsDir, query])

      let stdout = ""
      let stderr = ""

      proc.stdout.on("data", data => {
        stdout += data.toString()
      })

      proc.stderr.on("data", data => {
        stderr += data.toString()
      })

      proc.on("close", code => {
        if(code === 0) {
          const trimmed = stdout.trim()
          resolve({
            found: trimmed.length > 0,
            query,
            results: trimmed.length > 0 ? trimmed : `No documentation found for "${query}".`,
          })
        } else {
          resolve({
            found: false,
            query,
            results: `Error searching documentation:\n${stderr || stdout}`,
          })
        }
      })

      proc.on("error", err => {
        reject(new Error(`Failed to search docs: ${err.message}`))
      })
    })
  }

  async run() {
    await this.initialize()

    const transport = new StdioServerTransport()
    await this.server.connect(transport)

    console.error("FluffOS MCP Server running on stdio")
  }
}

// Only run the server if this file is executed directly
if(process.argv[1] === url.fileURLToPath(import.meta.url)) {
  const server = new FluffOSMCPServer()
  server.run().catch(console.error)
}
