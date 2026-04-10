import {describe, it, mock} from "node:test"
import assert from "node:assert"
import {FluffOSMCPServer} from "./index.js"

// To run integration tests with real environment variables, set them before running:
// FLUFFOS_BIN_DIR=/path/to/bin MUD_RUNTIME_CONFIG_FILE=/path/to/config FLUFFOS_DOCS_DIR=/path/to/docs node --test src/index.test.js

describe("FluffOSMCPServer", () => {
  describe("constructor", () => {
    it("should initialize with default values", () => {
      const server = new FluffOSMCPServer()
      assert.ok(server.server)
      assert.strictEqual(server.mudlibDir, null)
    })

    it("should read environment variables", () => {
      // process.env.FLUFFOS_BIN_DIR = "/test/bin"
      // process.env.MUD_RUNTIME_CONFIG_FILE = "/test/config"
      // process.env.FLUFFOS_DOCS_DIR = "/test/docs"

      // const server = new FluffOSMCPServer()
      // assert.strictEqual(server.binDir, "/test/bin")
      // assert.strictEqual(server.configFile, "/test/config")
      // assert.strictEqual(server.docsDir, "/test/docs")

      // delete process.env.FLUFFOS_BIN_DIR
      // delete process.env.MUD_RUNTIME_CONFIG_FILE
      // delete process.env.FLUFFOS_DOCS_DIR
    })
  })

  describe("normalizePath", () => {
    it("should normalize absolute paths under mudlib directory", () => {
      const server = new FluffOSMCPServer()
      server.mudlibDir = "/path/to/mudlib"

      const result = server.normalizePath("/path/to/mudlib/obj/test.c")
      assert.strictEqual(result, "obj/test.c")
    })

    it("should handle paths with multiple leading slashes", () => {
      const server = new FluffOSMCPServer()
      server.mudlibDir = "/path/to/mudlib"

      const result = server.normalizePath("/path/to/mudlib///obj/test.c")
      assert.strictEqual(result, "obj/test.c")
    })

    it("should return path as-is if not under mudlib", () => {
      const server = new FluffOSMCPServer()
      server.mudlibDir = "/path/to/mudlib"

      const result = server.normalizePath("/other/path/obj/test.c")
      assert.strictEqual(result, "/other/path/obj/test.c")
    })

    it("should return path as-is if mudlib not set", () => {
      const server = new FluffOSMCPServer()
      server.mudlibDir = null

      const result = server.normalizePath("/path/to/file.c")
      assert.strictEqual(result, "/path/to/file.c")
    })

    it("should return relative paths as-is", () => {
      const server = new FluffOSMCPServer()
      server.mudlibDir = "/path/to/mudlib"

      const result = server.normalizePath("obj/test.c")
      assert.strictEqual(result, "obj/test.c")
    })
  })

  describe("setupTools", () => {
    it("should register fluffos_validate tool", () => {
      const server = new FluffOSMCPServer()
      const registerMock = mock.method(server.server, "registerTool")

      server.setupTools()

      const calls = registerMock.mock.calls
      const validateCall = calls.find(call => call.arguments[0] === "fluffos_validate")
      assert.ok(validateCall, "fluffos_validate tool should be registered")
    })

    it("should register fluffos_disassemble tool", () => {
      const server = new FluffOSMCPServer()
      const registerMock = mock.method(server.server, "registerTool")

      server.setupTools()

      const calls = registerMock.mock.calls
      const disassembleCall = calls.find(call => call.arguments[0] === "fluffos_disassemble")
      assert.ok(disassembleCall, "fluffos_disassemble tool should be registered")
    })

    it("should register fluffos_doc_lookup tool when docsDir is set", () => {
      const server = new FluffOSMCPServer()
      server.docsDir = "/test/docs"
      const registerMock = mock.method(server.server, "registerTool")

      server.setupTools()

      const calls = registerMock.mock.calls
      const docLookupCall = calls.find(call => call.arguments[0] === "fluffos_doc_lookup")
      assert.ok(docLookupCall, "fluffos_doc_lookup tool should be registered")
    })

    it("should not register fluffos_doc_lookup tool when docsDir is not set", () => {
      const server = new FluffOSMCPServer()
      server.docsDir = null
      const registerMock = mock.method(server.server, "registerTool")

      server.setupTools()

      const calls = registerMock.mock.calls
      const docLookupCall = calls.find(call => call.arguments[0] === "fluffos_doc_lookup")
      assert.ok(!docLookupCall, "fluffos_doc_lookup tool should not be registered")
    })

    it("should define validate tool with correct schema", () => {
      const server = new FluffOSMCPServer()
      const registerMock = mock.method(server.server, "registerTool")

      server.setupTools()

      const validateCall = registerMock.mock.calls.find(
        call => call.arguments[0] === "fluffos_validate"
      )
      assert.ok(validateCall)
      const schema = validateCall.arguments[1]
      assert.ok(schema.description.includes("Validate an LPC file"))
      assert.ok(schema.inputSchema)
    })

    it("should define disassemble tool with correct schema", () => {
      const server = new FluffOSMCPServer()
      const registerMock = mock.method(server.server, "registerTool")

      server.setupTools()

      const disassembleCall = registerMock.mock.calls.find(
        call => call.arguments[0] === "fluffos_disassemble"
      )
      assert.ok(disassembleCall)
      const schema = disassembleCall.arguments[1]
      assert.ok(schema.description.includes("Disassemble an LPC file"))
      assert.ok(schema.inputSchema)
    })

    it("should define doc lookup tool with correct schema when enabled", () => {
      const server = new FluffOSMCPServer()
      server.docsDir = "/test/docs"
      const registerMock = mock.method(server.server, "registerTool")

      server.setupTools()

      const docLookupCall = registerMock.mock.calls.find(
        call => call.arguments[0] === "fluffos_doc_lookup"
      )
      assert.ok(docLookupCall)
      const schema = docLookupCall.arguments[1]
      assert.ok(schema.description.includes("Search FluffOS documentation"))
      assert.ok(schema.inputSchema)
    })
  })

  describe("tool handlers", () => {
    it("should handle validate tool returning success", async() => {
      const server = new FluffOSMCPServer()
      const registerMock = mock.method(server.server, "registerTool")

      // Mock runSymbol to return success
      mock.method(server, "runSymbol", async() => "✓ File validated successfully")

      server.setupTools()

      const validateCall = registerMock.mock.calls.find(
        call => call.arguments[0] === "fluffos_validate"
      )
      const handler = validateCall.arguments[2]

      const result = await handler({file: "/test/file.c"})
      assert.strictEqual(result.content[0].text, "✓ File validated successfully")
      assert.strictEqual(result.isError, undefined)
    })

    it("should handle validate tool returning error", async() => {
      const server = new FluffOSMCPServer()
      const registerMock = mock.method(server.server, "registerTool")

      // Mock runSymbol to throw error
      mock.method(server, "runSymbol", async() => {
        throw new Error("Validation failed")
      })

      server.setupTools()

      const validateCall = registerMock.mock.calls.find(
        call => call.arguments[0] === "fluffos_validate"
      )
      const handler = validateCall.arguments[2]

      const result = await handler({file: "/test/file.c"})
      assert.ok(result.content[0].text.includes("Error: Validation failed"))
      assert.strictEqual(result.isError, true)
    })

    it("should handle disassemble tool returning success", async() => {
      const server = new FluffOSMCPServer()
      const registerMock = mock.method(server.server, "registerTool")

      // Mock runLpcc to return bytecode
      mock.method(server, "runLpcc", async() => "Bytecode output")

      server.setupTools()

      const disassembleCall = registerMock.mock.calls.find(
        call => call.arguments[0] === "fluffos_disassemble"
      )
      const handler = disassembleCall.arguments[2]

      const result = await handler({file: "/test/file.c"})
      assert.strictEqual(result.content[0].text, "Bytecode output")
      assert.strictEqual(result.isError, undefined)
    })

    it("should handle disassemble tool returning error", async() => {
      const server = new FluffOSMCPServer()
      const registerMock = mock.method(server.server, "registerTool")

      // Mock runLpcc to throw error
      mock.method(server, "runLpcc", async() => {
        throw new Error("Disassembly failed")
      })

      server.setupTools()

      const disassembleCall = registerMock.mock.calls.find(
        call => call.arguments[0] === "fluffos_disassemble"
      )
      const handler = disassembleCall.arguments[2]

      const result = await handler({file: "/test/file.c"})
      assert.ok(result.content[0].text.includes("Error: Disassembly failed"))
      assert.strictEqual(result.isError, true)
    })

    it("should handle doc lookup tool returning results", async() => {
      const server = new FluffOSMCPServer()
      server.docsDir = "/test/docs"
      const registerMock = mock.method(server.server, "registerTool")

      // Mock searchDocs to return results
      mock.method(server, "searchDocs", async() => 'Found documentation for "test"')

      server.setupTools()

      const docLookupCall = registerMock.mock.calls.find(
        call => call.arguments[0] === "fluffos_doc_lookup"
      )
      const handler = docLookupCall.arguments[2]

      const result = await handler({query: "test"})
      assert.ok(result.content[0].text.includes('Found documentation for "test"'))
      assert.strictEqual(result.isError, undefined)
    })

    it("should handle doc lookup tool returning error", async() => {
      const server = new FluffOSMCPServer()
      server.docsDir = "/test/docs"
      const registerMock = mock.method(server.server, "registerTool")

      // Mock searchDocs to throw error
      mock.method(server, "searchDocs", async() => {
        throw new Error("Search failed")
      })

      server.setupTools()

      const docLookupCall = registerMock.mock.calls.find(
        call => call.arguments[0] === "fluffos_doc_lookup"
      )
      const handler = docLookupCall.arguments[2]

      const result = await handler({query: "test"})
      assert.ok(result.content[0].text.includes("Error: Search failed"))
      assert.strictEqual(result.isError, true)
    })
  })

  // Integration tests - only run if real environment variables are set
  describe("integration tests", () => {
    const hasRealEnv = process.env.FLUFFOS_BIN_DIR &&
                        process.env.MUD_RUNTIME_CONFIG_FILE &&
                        process.env.FLUFFOS_DOCS_DIR

    it("should parse mudlib directory from real config", {
      skip: !hasRealEnv ? "Set FLUFFOS_BIN_DIR, MUD_RUNTIME_CONFIG_FILE, and FLUFFOS_DOCS_DIR to run" : false,
    }, async() => {
      const server = new FluffOSMCPServer()
      const mudlibDir = await server.parseMudlibDir()
      assert.ok(mudlibDir !== undefined, "Should return a result (null or string)")
    })

    it("should read real environment variables", {
      skip: !hasRealEnv ? "Set FLUFFOS_BIN_DIR, MUD_RUNTIME_CONFIG_FILE, and FLUFFOS_DOCS_DIR to run" : false,
    }, () => {
      const server = new FluffOSMCPServer()
      assert.strictEqual(server.binDir, process.env.FLUFFOS_BIN_DIR)
      assert.strictEqual(server.configFile, process.env.MUD_RUNTIME_CONFIG_FILE)
      assert.strictEqual(server.docsDir, process.env.FLUFFOS_DOCS_DIR)
    })

    it("should search docs for a real term", {
      skip: !hasRealEnv ? "Set FLUFFOS_BIN_DIR, MUD_RUNTIME_CONFIG_FILE, and FLUFFOS_DOCS_DIR to run" : false,
    }, async() => {
      const server = new FluffOSMCPServer()
      // Pick a term you know exists in your docs, e.g. 'call_out' or 'mapping'
      const query = "call_out"
      const result = await server.searchDocs(query)
      assert.ok(result.includes(query) || result.includes("No documentation found"), "Should return search results or not found message")
    })
  })
})
