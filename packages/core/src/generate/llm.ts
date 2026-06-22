/**
 * @fileoverview The LLM boundary for the generation engine.
 *
 * Everything the engine asks of Claude goes through the small {@link LlmClient}
 * interface, so the rest of `core` never imports the Anthropic SDK directly.
 * That keeps the engine testable (swap in {@link MockLlmClient} /
 * {@link ScriptedLlmClient}) and the provider replaceable. The real client
 * reads its key and model from the environment and NEVER hardcodes a key.
 */

/** Default Claude model; override with `MCPGEN_MODEL`. */
export const DEFAULT_MODEL = "claude-opus-4-8";

/** A single chat message handed to the model. */
export interface LlmMessage {
  readonly role: "user" | "assistant";
  readonly content: string;
}

/** One completion request. */
export interface LlmRequest {
  /** Optional system prompt. */
  readonly system?: string;
  /** Conversation turns (must start with a user turn). */
  readonly messages: readonly LlmMessage[];
  /** Cap on output tokens. */
  readonly maxTokens?: number;
  /**
   * Stable, human-readable label for this call (e.g. `plan`, `tool.listPets`).
   * Used by recorded-fixture clients to route to the right response and to make
   * cache keys legible. Has no effect on the real API call.
   */
  readonly tag: string;
}

/** A completion response (text only — the engine parses JSON out of it). */
export interface LlmResponse {
  readonly text: string;
}

/** The provider-agnostic completion interface. */
export interface LlmClient {
  /** Identifier of the underlying model (part of cache keys). */
  readonly model: string;
  complete(request: LlmRequest): Promise<LlmResponse>;
}

/** Raised when the Anthropic client is constructed without an API key. */
export class MissingApiKeyError extends Error {
  constructor() {
    super(
      "No Anthropic API key found. Set ANTHROPIC_API_KEY (or MCPGEN_ANTHROPIC_API_KEY).",
    );
    this.name = "MissingApiKeyError";
  }
}

/** Resolve the API key from the environment without ever hardcoding one. */
export function resolveApiKey(env: NodeJS.ProcessEnv = process.env): string {
  const key = env.MCPGEN_ANTHROPIC_API_KEY ?? env.ANTHROPIC_API_KEY;
  if (!key) throw new MissingApiKeyError();
  return key;
}

/** Resolve the model id from the environment, falling back to the default. */
export function resolveModel(env: NodeJS.ProcessEnv = process.env): string {
  return env.MCPGEN_MODEL ?? DEFAULT_MODEL;
}

/**
 * The production client, backed by the Anthropic SDK. Imported lazily so that
 * code paths which only use mocks/fixtures (tests, CI) never load the SDK.
 */
export async function createAnthropicClient(
  options: { apiKey?: string; model?: string } = {},
): Promise<LlmClient> {
  const apiKey = options.apiKey ?? resolveApiKey();
  const model = options.model ?? resolveModel();
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey });

  return {
    model,
    async complete(request: LlmRequest): Promise<LlmResponse> {
      const message = await client.messages.create({
        model,
        max_tokens: request.maxTokens ?? 4096,
        system: request.system,
        messages: request.messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
      });
      const text = message.content
        .map((block) => (block.type === "text" ? block.text : ""))
        .join("");
      return { text };
    },
  };
}

/**
 * In-memory client for unit tests: returns canned text keyed by request
 * {@link LlmRequest.tag}. Throws on an unknown tag so missing fixtures surface
 * loudly.
 */
export class MockLlmClient implements LlmClient {
  readonly model: string;
  private readonly responses: Map<string, string>;

  constructor(responses: Record<string, string>, model = "mock-model") {
    this.model = model;
    this.responses = new Map(Object.entries(responses));
  }

  complete(request: LlmRequest): Promise<LlmResponse> {
    const text = this.responses.get(request.tag);
    if (text === undefined) {
      throw new Error(`MockLlmClient: no response for tag "${request.tag}"`);
    }
    return Promise.resolve({ text });
  }
}
