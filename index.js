#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { spawn } from "child_process";
import path from "path";

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
    this.configFile = process.env.MUD_RUNTIME_CONFIG;

    if (!this.binDir) {
      console.error("Error: FLUFFOS_BIN_DIR environment variable not set");
      process.exit(1);
    }

    if (!this.configFile) {
      console.error("Error: MUD_RUNTIME_CONFIG environment variable not set");
      process.exit(1);
    }

    console.error(`FluffOS bin directory: ${this.binDir}`);
    console.error(`FluffOS config file: ${this.configFile}`);

    this.setupHandlers();
  }

  setupHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: "fluffos_validate",
          description:
            "Validate an LPC file using the FluffOS driver's symbol tool. Returns success/failure and any compilation errors.",
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
            "Disassemble an LPC file to show compiled bytecode using lpcc. Useful for debugging and understanding how code compiles.",
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
      const symbolPath = path.join(this.binDir, "symbol");
      const proc = spawn(symbolPath, [this.configFile, lpcFile], {
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
      const lpccPath = path.join(this.binDir, "lpcc");
      const proc = spawn(lpccPath, [this.configFile, lpcFile], {
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

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);

    console.error("FluffOS MCP Server running on stdio");
  }
}

const server = new FluffOSMCPServer();
server.run().catch(console.error);
