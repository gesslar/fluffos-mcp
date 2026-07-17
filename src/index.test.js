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

    it("should default evalTimeoutMs to 30000 when unset or invalid", () => {
      const saved = process.env.FLUFFOS_EVAL_TIMEOUT_MS
      try {
        delete process.env.FLUFFOS_EVAL_TIMEOUT_MS
        assert.strictEqual(new FluffOSMCPServer().evalTimeoutMs, 30000)

        process.env.FLUFFOS_EVAL_TIMEOUT_MS = "not-a-number"
        assert.strictEqual(new FluffOSMCPServer().evalTimeoutMs, 30000)

        process.env.FLUFFOS_EVAL_TIMEOUT_MS = "0"
        assert.strictEqual(new FluffOSMCPServer().evalTimeoutMs, 30000)
      } finally {
        if(saved === undefined)
          delete process.env.FLUFFOS_EVAL_TIMEOUT_MS
        else
          process.env.FLUFFOS_EVAL_TIMEOUT_MS = saved
      }
    })

    it("should honour a valid FLUFFOS_EVAL_TIMEOUT_MS override", () => {
      const saved = process.env.FLUFFOS_EVAL_TIMEOUT_MS
      try {
        process.env.FLUFFOS_EVAL_TIMEOUT_MS = "5000"
        assert.strictEqual(new FluffOSMCPServer().evalTimeoutMs, 5000)
      } finally {
        if(saved === undefined)
          delete process.env.FLUFFOS_EVAL_TIMEOUT_MS
        else
          process.env.FLUFFOS_EVAL_TIMEOUT_MS = saved
      }
    })

    it("should default evalMaxBytes to 10 MiB, honouring a valid override", () => {
      const saved = process.env.FLUFFOS_EVAL_MAX_BYTES
      try {
        const tenMiB = 10 * 1024 * 1024
        delete process.env.FLUFFOS_EVAL_MAX_BYTES
        assert.strictEqual(new FluffOSMCPServer().evalMaxBytes, tenMiB)

        process.env.FLUFFOS_EVAL_MAX_BYTES = "garbage"
        assert.strictEqual(new FluffOSMCPServer().evalMaxBytes, tenMiB)

        process.env.FLUFFOS_EVAL_MAX_BYTES = "2048"
        assert.strictEqual(new FluffOSMCPServer().evalMaxBytes, 2048)
      } finally {
        if(saved === undefined)
          delete process.env.FLUFFOS_EVAL_MAX_BYTES
        else
          process.env.FLUFFOS_EVAL_MAX_BYTES = saved
      }
    })

    it("should reject an oversized eval payload before writing to disk", async() => {
      const server = new FluffOSMCPServer()
      server.evalMaxBytes = 16
      await assert.rejects(
        () => server.runLpcshell("x".repeat(17)),
        /Eval payload too large/
      )
    })

    it("should default evalMaxConcurrent to 4, honouring a valid override", () => {
      const saved = process.env.FLUFFOS_EVAL_MAX_CONCURRENT
      try {
        delete process.env.FLUFFOS_EVAL_MAX_CONCURRENT
        assert.strictEqual(new FluffOSMCPServer().evalMaxConcurrent, 4)

        process.env.FLUFFOS_EVAL_MAX_CONCURRENT = "garbage"
        assert.strictEqual(new FluffOSMCPServer().evalMaxConcurrent, 4)

        process.env.FLUFFOS_EVAL_MAX_CONCURRENT = "8"
        assert.strictEqual(new FluffOSMCPServer().evalMaxConcurrent, 8)
      } finally {
        if(saved === undefined)
          delete process.env.FLUFFOS_EVAL_MAX_CONCURRENT
        else
          process.env.FLUFFOS_EVAL_MAX_CONCURRENT = saved
      }
    })

    it("should reject an eval when the concurrency limit is reached", async() => {
      const server = new FluffOSMCPServer()
      server.evalMaxConcurrent = 2
      server.evalInFlight = 2
      await assert.rejects(
        () => server.runLpcshell("1 + 1;"),
        /Too many concurrent evaluations/
      )
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

    it("should register fluffos_eval tool when enableEval is set", () => {
      const server = new FluffOSMCPServer()
      server.enableEval = true
      const registerMock = mock.method(server.server, "registerTool")

      server.setupTools()

      const calls = registerMock.mock.calls
      const evalCall = calls.find(call => call.arguments[0] === "fluffos_eval")
      assert.ok(evalCall, "fluffos_eval tool should be registered")
    })

    it("should not register fluffos_eval tool when enableEval is not set", () => {
      const server = new FluffOSMCPServer()
      server.enableEval = false
      const registerMock = mock.method(server.server, "registerTool")

      server.setupTools()

      const calls = registerMock.mock.calls
      const evalCall = calls.find(call => call.arguments[0] === "fluffos_eval")
      assert.ok(!evalCall, "fluffos_eval tool should not be registered")
    })

    it("should mark fluffos_eval as not read-only and not idempotent", () => {
      const server = new FluffOSMCPServer()
      server.enableEval = true
      const registerMock = mock.method(server.server, "registerTool")

      server.setupTools()

      const evalCall = registerMock.mock.calls.find(
        call => call.arguments[0] === "fluffos_eval"
      )
      const {annotations} = evalCall.arguments[1]
      assert.strictEqual(annotations.readOnlyHint, false)
      assert.strictEqual(annotations.idempotentHint, false)
    })

    it("should define validate tool with quality metadata", () => {
      const server = new FluffOSMCPServer()
      const registerMock = mock.method(server.server, "registerTool")

      server.setupTools()

      const validateCall = registerMock.mock.calls.find(
        call => call.arguments[0] === "fluffos_validate"
      )
      assert.ok(validateCall)
      const config = validateCall.arguments[1]

      // Title
      assert.strictEqual(typeof config.title, "string")
      assert.ok(config.title.length > 0, "title should not be empty")

      // Description quality markers
      assert.ok(config.description.includes("Compile an LPC source file"))
      assert.ok(config.description.includes("Use when:"), "description should include 'Use when:' guidance")
      assert.ok(config.description.includes("Do not use for:"), "description should include 'Do not use for:' guidance")
      assert.ok(config.description.includes("Returns"), "description should document return shape")
      assert.ok(config.description.includes("fluffos_disassemble"), "description should cross-reference sibling tools")

      // Input and output schemas present
      assert.ok(config.inputSchema, "inputSchema should be defined")
      assert.ok(config.outputSchema, "outputSchema should be defined")

      // Annotations communicate behaviour
      assert.ok(config.annotations, "annotations should be defined")
      assert.strictEqual(config.annotations.readOnlyHint, true)
      assert.strictEqual(config.annotations.idempotentHint, true)
      assert.strictEqual(config.annotations.openWorldHint, false)
    })

    it("should define disassemble tool with quality metadata", () => {
      const server = new FluffOSMCPServer()
      const registerMock = mock.method(server.server, "registerTool")

      server.setupTools()

      const disassembleCall = registerMock.mock.calls.find(
        call => call.arguments[0] === "fluffos_disassemble"
      )
      assert.ok(disassembleCall)
      const config = disassembleCall.arguments[1]

      assert.strictEqual(typeof config.title, "string")
      assert.ok(config.title.length > 0, "title should not be empty")

      assert.ok(config.description.includes("bytecode disassembly"))
      assert.ok(config.description.includes("Use when:"))
      assert.ok(config.description.includes("Do not use for:"))
      assert.ok(config.description.includes("Returns"))
      assert.ok(config.description.includes("fluffos_validate"), "description should cross-reference sibling tools")

      assert.ok(config.inputSchema)
      assert.ok(config.outputSchema)

      assert.ok(config.annotations)
      assert.strictEqual(config.annotations.readOnlyHint, true)
      assert.strictEqual(config.annotations.idempotentHint, true)
      assert.strictEqual(config.annotations.openWorldHint, false)
    })

    it("should define doc lookup tool with quality metadata when enabled", () => {
      const server = new FluffOSMCPServer()
      server.docsDir = "/test/docs"
      const registerMock = mock.method(server.server, "registerTool")

      server.setupTools()

      const docLookupCall = registerMock.mock.calls.find(
        call => call.arguments[0] === "fluffos_doc_lookup"
      )
      assert.ok(docLookupCall)
      const config = docLookupCall.arguments[1]

      assert.strictEqual(typeof config.title, "string")
      assert.ok(config.title.length > 0, "title should not be empty")

      assert.ok(config.description.includes("FluffOS markdown documentation"))
      assert.ok(config.description.includes("Use when:"))
      assert.ok(config.description.includes("Do not use for:"))
      assert.ok(config.description.includes("Returns"))
      assert.ok(config.description.includes("fluffos_validate"), "description should cross-reference sibling tools")

      assert.ok(config.inputSchema)
      assert.ok(config.outputSchema)

      assert.ok(config.annotations)
      assert.strictEqual(config.annotations.readOnlyHint, true)
      assert.strictEqual(config.annotations.idempotentHint, true)
      assert.strictEqual(config.annotations.openWorldHint, false)
    })
  })

  describe("tool handlers", () => {
    it("should handle validate tool returning success", async() => {
      const server = new FluffOSMCPServer()
      const registerMock = mock.method(server.server, "registerTool")

      // Mock runSymbol to return structured success
      mock.method(server, "runSymbol", async() => ({
        success: true,
        exitCode: 0,
        output: "compiled clean",
      }))

      server.setupTools()

      const validateCall = registerMock.mock.calls.find(
        call => call.arguments[0] === "fluffos_validate"
      )
      const handler = validateCall.arguments[2]

      const result = await handler({file: "/test/file.c"})
      assert.ok(result.content[0].text.includes("✓ File validated successfully"))
      assert.ok(result.content[0].text.includes("compiled clean"))
      assert.deepStrictEqual(result.structuredContent, {
        success: true,
        exitCode: 0,
        output: "compiled clean",
      })
      assert.strictEqual(result.isError, undefined)
    })

    it("should handle validate tool returning compilation failure", async() => {
      const server = new FluffOSMCPServer()
      const registerMock = mock.method(server.server, "registerTool")

      mock.method(server, "runSymbol", async() => ({
        success: false,
        exitCode: 1,
        output: "parse error at line 10",
      }))

      server.setupTools()

      const validateCall = registerMock.mock.calls.find(
        call => call.arguments[0] === "fluffos_validate"
      )
      const handler = validateCall.arguments[2]

      const result = await handler({file: "/test/file.c"})
      assert.ok(result.content[0].text.includes("✗ Validation failed"))
      assert.ok(result.content[0].text.includes("exit code: 1"))
      assert.ok(result.content[0].text.includes("parse error at line 10"))
      assert.strictEqual(result.structuredContent.success, false)
      assert.strictEqual(result.structuredContent.exitCode, 1)
      assert.strictEqual(result.isError, undefined)
    })

    it("should handle validate tool when helper throws", async() => {
      const server = new FluffOSMCPServer()
      const registerMock = mock.method(server.server, "registerTool")

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

      mock.method(server, "runLpcc", async() => ({
        success: true,
        exitCode: 0,
        output: "Bytecode output",
      }))

      server.setupTools()

      const disassembleCall = registerMock.mock.calls.find(
        call => call.arguments[0] === "fluffos_disassemble"
      )
      const handler = disassembleCall.arguments[2]

      const result = await handler({file: "/test/file.c"})
      assert.strictEqual(result.content[0].text, "Bytecode output")
      assert.deepStrictEqual(result.structuredContent, {
        success: true,
        exitCode: 0,
        output: "Bytecode output",
      })
      assert.strictEqual(result.isError, undefined)
    })

    it("should handle disassemble tool returning compilation failure", async() => {
      const server = new FluffOSMCPServer()
      const registerMock = mock.method(server.server, "registerTool")

      mock.method(server, "runLpcc", async() => ({
        success: false,
        exitCode: 2,
        output: "lpcc: syntax error",
      }))

      server.setupTools()

      const disassembleCall = registerMock.mock.calls.find(
        call => call.arguments[0] === "fluffos_disassemble"
      )
      const handler = disassembleCall.arguments[2]

      const result = await handler({file: "/test/file.c"})
      assert.ok(result.content[0].text.includes("Error (exit code: 2)"))
      assert.ok(result.content[0].text.includes("lpcc: syntax error"))
      assert.strictEqual(result.structuredContent.success, false)
      assert.strictEqual(result.isError, undefined)
    })

    it("should handle disassemble tool when helper throws", async() => {
      const server = new FluffOSMCPServer()
      const registerMock = mock.method(server.server, "registerTool")

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

      mock.method(server, "searchDocs", async() => ({
        found: true,
        query: "call_out",
        results: "call_out(func, delay)",
      }))

      server.setupTools()

      const docLookupCall = registerMock.mock.calls.find(
        call => call.arguments[0] === "fluffos_doc_lookup"
      )
      const handler = docLookupCall.arguments[2]

      const result = await handler({query: "call_out"})
      assert.ok(result.content[0].text.includes('Found documentation for "call_out"'))
      assert.ok(result.content[0].text.includes("call_out(func, delay)"))
      assert.strictEqual(result.structuredContent.found, true)
      assert.strictEqual(result.structuredContent.query, "call_out")
      assert.strictEqual(result.isError, undefined)
    })

    it("should handle doc lookup tool returning no results", async() => {
      const server = new FluffOSMCPServer()
      server.docsDir = "/test/docs"
      const registerMock = mock.method(server.server, "registerTool")

      mock.method(server, "searchDocs", async() => ({
        found: false,
        query: "nonexistent",
        results: 'No documentation found for "nonexistent".',
      }))

      server.setupTools()

      const docLookupCall = registerMock.mock.calls.find(
        call => call.arguments[0] === "fluffos_doc_lookup"
      )
      const handler = docLookupCall.arguments[2]

      const result = await handler({query: "nonexistent"})
      assert.ok(result.content[0].text.includes('No documentation found for "nonexistent"'))
      assert.strictEqual(result.structuredContent.found, false)
      assert.strictEqual(result.isError, undefined)
    })

    it("should handle doc lookup tool when helper throws", async() => {
      const server = new FluffOSMCPServer()
      server.docsDir = "/test/docs"
      const registerMock = mock.method(server.server, "registerTool")

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
      assert.ok(typeof result === "object", "Should return a structured result")
      assert.ok("found" in result, "result should have 'found' field")
      assert.ok("query" in result, "result should have 'query' field")
      assert.ok("results" in result, "result should have 'results' field")
      assert.strictEqual(result.query, query)
    })
  })
})
