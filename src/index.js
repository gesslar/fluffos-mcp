#!/usr/bin/env node

import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js"
import {StdioServerTransport} from "@modelcontextprotocol/sdk/server/stdio.js"
import * as z from "zod/v4"
import {spawn} from "child_process"
import {FileObject, DirectoryObject, Sass} from "@gesslar/toolkit"
import url from "node:url"
import {writeFile, unlink} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {randomUUID} from "node:crypto"

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
    // Opt-in only: fluffos_eval executes live LPC against the mudlib (side
    // effects possible), so the tool is registered only when this is set to
    // an explicit affirmative. A plain truthiness check would treat "false"
    // and "0" as enabled (any non-empty string is truthy in JS), so match a
    // fixed set of yes-values case-insensitively instead.
    this.enableEval = ["1", "true", "yes", "on"].includes(
      (process.env.FLUFFOS_ENABLE_EVAL ?? "").trim().toLowerCase()
    )
    // Wall-clock cap for a single fluffos_eval run before the child is killed.
    // Override with FLUFFOS_EVAL_TIMEOUT_MS; falls back to 30s on unset/invalid.
    const parsedTimeout = Number.parseInt(process.env.FLUFFOS_EVAL_TIMEOUT_MS ?? "", 10)
    this.evalTimeoutMs = Number.isInteger(parsedTimeout) && parsedTimeout > 0
      ? parsedTimeout
      : 30000
    // Reject oversized eval payloads before they hit the temp filesystem.
    // Override with FLUFFOS_EVAL_MAX_BYTES; falls back to 10 MiB on unset/invalid.
    const parsedMaxBytes = Number.parseInt(process.env.FLUFFOS_EVAL_MAX_BYTES ?? "", 10)
    this.evalMaxBytes = Number.isInteger(parsedMaxBytes) && parsedMaxBytes > 0
      ? parsedMaxBytes
      : 10 * 1024 * 1024
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

    if(this.enableEval)
      console.error(`LPC eval (lpcshell): ENABLED — executes live LPC with possible side effects`)
    else
      console.error(`LPC eval (lpcshell): disabled (set FLUFFOS_ENABLE_EVAL to enable)`)

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

    // Register eval tool (conditional — executes live LPC, opt-in only)
    if(this.enableEval) {
      this.server.registerTool("fluffos_eval", {
        title: "Evaluate LPC (lpcshell)",
        description:
          "Evaluate LPC statements against the **live** FluffOS driver using the `lpcshell` CLI in script mode. Unlike `fluffos_validate` and `fluffos_disassemble`, this **boots the full runtime** (master object, simul_efun, preloaded daemons) and **executes** the code you provide.\n\n" +
          "**Use when:**\n" +
          "- Checking the actual runtime value or behaviour of an expression (e.g. `sizeof(users())`, an efun's return, a mapping operation).\n" +
          "- Reproducing a runtime error interactively without editing and reloading a mudlib file.\n" +
          "- Probing driver state through efuns during debugging.\n\n" +
          "**⚠️ Not read-only.** Statements run with full driver privileges and can have side effects — writing files, mutating daemon or database state, firing events. Do not use for untrusted code or as a routine auto-invoked check. Each statement is auto-printed like a REPL; a bare expression prints its value, a statement (assignment, loop, `if`) runs silently. Variable values persist across statements within a single call.\n\n" +
          "**Do not use for:**\n" +
          "- Compile-only validation — use `fluffos_validate` (faster, no side effects).\n" +
          "- Bytecode inspection — use `fluffos_disassemble`.\n\n" +
          "**Returns** the combined driver output (auto-printed results, `write()`/`printf()` output, and clang-style compile/runtime diagnostics) as text, plus a `structuredContent` payload with `success`, `exitCode`, and `output`. Exit code is nonzero if any statement failed to compile or errored. Only registered when the server was started with `FLUFFOS_ENABLE_EVAL` set.\n\n" +
          "**Related tools:** `fluffos_validate` to compile without executing; `fluffos_doc_lookup` for efun/apply reference.",
        inputSchema: {
          code: z.string().describe(
            "One or more LPC statements to evaluate, separated by newlines. A bare expression (e.g. `1 + 1` or `sizeof(users())`) is auto-printed; a statement (e.g. `int x = 5;`, `foreach(...) ...`) runs silently. Variable declarations persist across lines within this one call. Example: `object o = load_object(\"/std/object\");\\nvalues(o->query_stats());`"
          ),
        },
        outputSchema: {
          success: z.boolean().describe("True when every statement compiled and executed with exit code 0."),
          exitCode: z.number().int().describe("Exit code from `lpcshell`. 0 indicates all statements succeeded; nonzero indicates a compile or runtime failure."),
          output: z.string().describe("Combined stdout and stderr from the driver — auto-printed results, explicit output, and any diagnostics."),
        },
        annotations: {
          title: "Evaluate LPC (lpcshell)",
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: false,
          openWorldHint: true,
        },
      }, async({code}) => {
        try {
          const result = await this.runLpcshell(code)
          const text = result.success
            ? result.output
            : `✗ Evaluation failed (exit code: ${result.exitCode})\n\n${result.output}`

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

  async runLpcshell(code) {
    // The script file is read by lpcshell via a plain OS-level open (not the
    // driver's file system), so it does NOT need to live inside the mudlib
    // jail — a temp file anywhere the process can read works. Only the LPC
    // statements themselves execute inside the jail.
    const byteLength = Buffer.byteLength(code, "utf8")
    if(byteLength > this.evalMaxBytes)
      throw new Error(
        `Eval payload too large: ${byteLength} bytes exceeds the ${this.evalMaxBytes}-byte limit ` +
        `(set FLUFFOS_EVAL_MAX_BYTES to change it).`
      )

    const scriptPath = join(tmpdir(), `fluffos-eval-${randomUUID()}.lpc`)
    // 0o600: the eval script may contain sensitive code, and tmpdir() is
    // shared — keep it readable only by the user running the server.
    await writeFile(scriptPath, code.endsWith("\n") ? code : `${code}\n`, {mode: 0o600})

    try {
      return await new Promise((resolve, reject) => {
        const binDir = new DirectoryObject(this.binDir)
        const lpcshellPath = binDir.getFile("lpcshell").path
        const configFile = new FileObject(this.configFile)
        const proc = spawn(lpcshellPath, [this.configFile, scriptPath], {
          cwd: configFile.parentPath,
        })

        let stdout = ""
        let stderr = ""
        let timedOut = false

        // The driver's own eval-cost limit kills runaway CPU loops, but a
        // genuinely blocked statement would otherwise hang this call (and the
        // child) forever. Cap the wall-clock lifetime and SIGKILL on expiry.
        const timer = setTimeout(() => {
          timedOut = true
          proc.kill("SIGKILL")
        }, this.evalTimeoutMs)

        proc.stdout.on("data", data => {
          stdout += data.toString()
        })

        proc.stderr.on("data", data => {
          stderr += data.toString()
        })

        proc.on("close", code => {
          clearTimeout(timer)
          const output = (stdout + stderr).trim()

          if(timedOut) {
            resolve({
              success: false,
              exitCode: code,
              output: `${output}\n\n✗ Evaluation timed out after ${this.evalTimeoutMs}ms and was killed.`.trim(),
            })

            return
          }

          resolve({
            success: code === 0,
            exitCode: code,
            output,
          })
        })

        proc.on("error", err => {
          clearTimeout(timer)
          reject(new Error(`Failed to run lpcshell: ${err.message}`))
        })
      })
    } finally {
      await unlink(scriptPath).catch(() => {})
    }
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
