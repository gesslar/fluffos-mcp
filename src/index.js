#!/usr/bin/env node

import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js"
import {StdioServerTransport} from "@modelcontextprotocol/sdk/server/stdio.js"
import * as z from "zod/v4"
import {spawn} from "child_process"
import {FileObject, DirectoryObject} from "@gesslar/toolkit"

class FluffOSMCPServer {
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
      const match = configContent.match(/^mudlib directory\s*:\s*(.+)$/m)

      if(match)
        return match[1].trim()

    } catch(err) {
      console.error(`Warning: Could not parse mudlib directory from config: ${err.message}`)
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
      description: "Validate an LPC file using the FluffOS driver's symbol tool. " +
        "Compiles the file and reports success or failure with any " +
        "compilation errors. Fast and lightweight check for code validity.",
      inputSchema: {
        file: z.string().describe("Absolute path to the LPC file to validate"),
      },
    }, async({file}) => {
      try {
        const result = await this.runSymbol(file)

        return {
          content: [
            {
              type: "text",
              text: result,
            },
          ],
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
      description: "Disassemble an LPC file to show compiled bytecode using lpcc. Returns detailed bytecode, function tables, strings, and disassembly. Useful for debugging and understanding how code compiles.",
      inputSchema: {
        file: z.string().describe("Absolute path to the LPC file to disassemble"),
      },
    }, async({file}) => {
      try {
        const result = await this.runLpcc(file)

        return {
          content: [
            {
              type: "text",
              text: result,
            },
          ],
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
        description: "Search FluffOS documentation for information about efuns, applies, concepts, etc. Searches markdown documentation files.",
        inputSchema: {
          query: z.string().describe("Term to search for in documentation (e.g., 'call_out', 'mapping', 'socket')"),
        },
      }, async({query}) => {
        try {
          const result = await this.searchDocs(query)

          return {
            content: [
              {
                type: "text",
                text: result,
              },
            ],
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

        if(code === 0)
          resolve(`✓ File validated successfully\n\n${output}`)
        else
          resolve(`✗ Validation failed (exit code: ${code})\n\n${output}`)

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

        if(code === 0) {
          resolve(output)
        } else {
          resolve(`Error (exit code: ${code}):\n\n${output}`)
        }
      })

      proc.on("error", err => {
        reject(new Error(`Failed to run lpcc: ${err.message}`))
      })
    })
  }

  async searchDocs(query) {
    return new Promise((resolve, reject) => {
      const moduleFile = new FileObject(new URL(import.meta.url).pathname)
      const scriptsDir = moduleFile.parent.getDirectory("scripts")
      const scriptPath = scriptsDir.getFile("search_docs.sh").path
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
          if(stdout.trim()) {
            resolve(`Found documentation for "${query}":\n\n${stdout}`)
          } else {
            resolve(`No documentation found for "${query}".`)
          }
        } else {
          resolve(`Error searching documentation:\n${stderr || stdout}`)
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

const server = new FluffOSMCPServer()
server.run().catch(console.error)
