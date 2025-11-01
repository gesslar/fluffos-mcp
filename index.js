#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { spawn } from "child_process";
import path from "path";
import fs from "fs";

class FluffOSMCPServer {
  constructor() {
    this.server = new Server(
      {
        name: "fluffos-mcp-server",
        version: "0.1.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.binDir = process.env.FLUFFOS_BIN_DIR;
    this.configFile = process.env.MUD_RUNTIME_CONFIG_FILE;
    this.docsDir = process.env.FLUFFOS_DOCS_DIR;
    this.mudlibDir = null;

    if (!this.binDir) {
      console.error("Error: FLUFFOS_BIN_DIR environment variable not set");
      process.exit(1);
    }

    if (!this.configFile) {
      console.error("Error: MUD_RUNTIME_CONFIG_FILE environment variable not set");
      process.exit(1);
    }

    // Parse mudlib directory from config file
    this.mudlibDir = this.parseMudlibDir();

    console.error(`FluffOS bin directory: ${this.binDir}`);
    console.error(`FluffOS config file: ${this.configFile}`);
    console.error(`Mudlib directory: ${this.mudlibDir || "(not found in config)"}`);
    
    if (this.docsDir) {
      console.error(`FluffOS docs directory: ${this.docsDir}`);
    } else {
      console.error(`FluffOS docs directory: not set (doc lookup disabled)`);
    }

    this.setupHandlers();
  }

  parseMudlibDir() {
    try {
      const configContent = fs.readFileSync(this.configFile, "utf8");
      const match = configContent.match(/^mudlib directory\s*:\s*(.+)$/m);
      if (match) {
        return match[1].trim();
      }
    } catch (err) {
      console.error(`Warning: Could not parse mudlib directory from config: ${err.message}`);
    }
    return null;
  }

  normalizePath(lpcFile) {
    // If we have a mudlib directory and the file path is absolute and starts with mudlib dir,
    // convert it to a relative path
    if (this.mudlibDir && path.isAbsolute(lpcFile) && lpcFile.startsWith(this.mudlibDir)) {
      // Remove mudlib directory prefix and leading slash
      return lpcFile.substring(this.mudlibDir.length).replace(/^\/+/, "");
    }
    // Otherwise return as-is (already relative or not under mudlib)
    return lpcFile;
  }

  setupHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: "fluffos_validate",
          description:
            "Validate an LPC file using the FluffOS driver's symbol tool. Compiles the file and reports success or failure with any compilation errors. Fast and lightweight check for code validity.",
          inputSchema: {
            type: "object",
            properties: {
              file: {
                type: "string",
                description: "Absolute path to the LPC file to validate",
              },
            },
            required: ["file"],
          },
        },
        {
          name: "fluffos_disassemble",
          description:
            "Disassemble an LPC file to show compiled bytecode using lpcc. Returns detailed bytecode, function tables, strings, and disassembly. Useful for debugging and understanding how code compiles.",
          inputSchema: {
            type: "object",
            properties: {
              file: {
                type: "string",
                description: "Absolute path to the LPC file to disassemble",
              },
            },
            required: ["file"],
          },
        },
        ...(this.docsDir ? [{
          name: "fluffos_doc_lookup",
          description:
            "Search FluffOS documentation for information about efuns, applies, concepts, etc. Searches markdown documentation files.",
          inputSchema: {
            type: "object",
            properties: {
              query: {
                type: "string",
                description: "Term to search for in documentation (e.g., 'call_out', 'mapping', 'socket')",
              },
            },
            required: ["query"],
          },
        }] : []),
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case "fluffos_validate": {
            const result = await this.runSymbol(args.file);
            return {
              content: [
                {
                  type: "text",
                  text: result,
                },
              ],
            };
          }

          case "fluffos_disassemble": {
            const result = await this.runLpcc(args.file);
            return {
              content: [
                {
                  type: "text",
                  text: result,
                },
              ],
            };
          }

          case "fluffos_doc_lookup": {
            if (!this.docsDir) {
              throw new Error("Documentation lookup is not available (FLUFFOS_DOCS_DIR not set)");
            }
            const result = await this.searchDocs(args.query);
            return {
              content: [
                {
                  type: "text",
                  text: result,
                },
              ],
            };
          }

          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
    });
  }

  async runSymbol(lpcFile) {
    return new Promise((resolve, reject) => {
      const normalizedPath = this.normalizePath(lpcFile);
      const symbolPath = path.join(this.binDir, "symbol");
      const proc = spawn(symbolPath, [this.configFile, normalizedPath], {
        cwd: path.dirname(this.configFile),
      });

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      proc.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      proc.on("close", (code) => {
        const output = (stdout + stderr).trim();
        
        if (code === 0) {
          resolve(`✓ File validated successfully\n\n${output}`);
        } else {
          resolve(`✗ Validation failed (exit code: ${code})\n\n${output}`);
        }
      });

      proc.on("error", (err) => {
        reject(new Error(`Failed to run symbol: ${err.message}`));
      });
    });
  }

  async runLpcc(lpcFile) {
    return new Promise((resolve, reject) => {
      const normalizedPath = this.normalizePath(lpcFile);
      const lpccPath = path.join(this.binDir, "lpcc");
      const proc = spawn(lpccPath, [this.configFile, normalizedPath], {
        cwd: path.dirname(this.configFile),
      });

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      proc.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      proc.on("close", (code) => {
        const output = (stdout + stderr).trim();
        
        if (code === 0) {
          resolve(output);
        } else {
          resolve(`Error (exit code: ${code}):\n\n${output}`);
        }
      });

      proc.on("error", (err) => {
        reject(new Error(`Failed to run lpcc: ${err.message}`));
      });
    });
  }

  async searchDocs(query) {
    return new Promise((resolve, reject) => {
      const scriptPath = path.join(path.dirname(new URL(import.meta.url).pathname), "scripts", "search_docs.sh");
      const proc = spawn(scriptPath, [this.docsDir, query]);

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      proc.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      proc.on("close", (code) => {
        if (code === 0) {
          if (stdout.trim()) {
            resolve(`Found documentation for "${query}":\n\n${stdout}`);
          } else {
            resolve(`No documentation found for "${query}".`);
          }
        } else {
          resolve(`Error searching documentation:\n${stderr || stdout}`);
        }
      });

      proc.on("error", (err) => {
        reject(new Error(`Failed to search docs: ${err.message}`));
      });
    });
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);

    console.error("FluffOS MCP Server running on stdio");
  }
}

const server = new FluffOSMCPServer();
server.run().catch(console.error);
