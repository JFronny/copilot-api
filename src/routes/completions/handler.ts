import {createInfillCompletion, type InfillCompletionPayload,} from "~/services/copilot/create-infill-completion";
import type {Context} from "hono";
import {checkRateLimit} from "~/lib/rate-limit";
import {state} from "~/lib/state";
import consola from "consola";
import {type SSEMessage, streamSSE} from "hono/streaming";
import {type ChatCompletionResponse, createChatCompletions} from "~/services/copilot/create-chat-completions";

function isLegalStop(s: string): boolean {
  if (s.startsWith("<") && s.endsWith(">")) return false;
  if (s == ")\n") return false;
  if (s == ",\n") return false;
  return true;
}

export async function handleCompletion(c: Context) {
  await checkRateLimit(state)

  let payload = await c.req.json<CompletionCreateParams>()
  consola.debug("Request payload:", JSON.stringify(payload).slice(-400))
  let prompt: string
  if (typeof payload.prompt === "string") {
    prompt = payload.prompt
  } else {
    prompt = (payload.prompt as string[]).join("\n")
  }
  if (prompt.includes("<fim_prefix>") && prompt.includes("<fim_suffix>") && prompt.includes("<fim_middle>")) {
    const prefixIndex = prompt.indexOf("<fim_prefix>")
    const suffixIndex = prompt.indexOf("<fim_suffix>", prefixIndex) // This may not be accurate if the text includes <fim_prefix>. Oh well
    if (suffixIndex == -1) throw new Error("Suffix is before prefix")
    const middleIndex = prompt.lastIndexOf("<fim_middle>")
    if (middleIndex < suffixIndex) throw new Error("Middle before suffix")
    const prefix = prompt.substring(prefixIndex + "<fim_prefix>".length, suffixIndex)
    const suffix = prompt.substring(suffixIndex + "<fim_suffix>".length, middleIndex)
    const middle = prompt.substring(middleIndex + "<fim_middle>".length)
    if (payload.suffix != undefined) throw new Error("Invalid FIM request: defined suffix")
    if (middle != null && middle.trim()) throw new Error(`Invalid FIM: request: non-empty middle: '${middle}'`)
    prompt = prefix
    payload.suffix = suffix;
  }
  payload.prompt = prompt

  if (payload.stop == null) {
    payload.stop = []
  }
  if (typeof payload.stop === "string") {
    const s = payload.stop
    if (isLegalStop(s)) {
      payload.stop = [s]
    }
  } else if (Array.isArray(payload.stop)) {
    payload.stop = payload.stop.filter(isLegalStop)
  } else {
    consola.debug("Unexpected stop type:", typeof payload.stop)
  }
  if (payload.stop.length == 0) payload.stop = ["\n\n"]
  consola.debug("Modified stop:", JSON.stringify(payload.stop))

  const mappedPayload: InfillCompletionPayload = {
    extra: {
      language: "java",
      next_intent: 0,
      prompt_tokens: 500,
      suffix_tokens: 300,
      trim_by_indentation: true,
    },
    max_tokens: payload.max_tokens ?? 500,
    n: payload.n ?? 1,
    nwo: "app",
    prompt: `// Path: /var/tmp/appyZVr5Hx.java\n${payload.prompt}`,
    stop: payload.stop,
    stream: payload.stream ?? false,
    suffix: payload.suffix,
    temperature: payload.temperature ?? ((payload.n ?? 1) > 1 ? 0.4 : 0),
    top_p: payload.top_p ?? 1
  }

  const response = await createInfillCompletion(mappedPayload)

  if (isNonStreaming(response)) {
    consola.debug("Non-streaming response:", JSON.stringify(response))
    return c.json(response)
  }

  consola.debug("Streaming response")
  return streamSSE(c, async (stream) => {
    for await (const chunk of response) {
      if (chunk.data != "[DONE]" && chunk.data != null) {
        const response: Completion = JSON.parse(chunk.data)
        const timestamp = Math.floor(Date.now() / 1000);
        response.id = "cmpl-" + timestamp;
        response.created = timestamp;
        response.model = payload.model ?? "gpt-4o-copilot"
        response.object = "text_completion"
        response.usage = {
          completion_tokens: 12,
          prompt_tokens: 12,
          total_tokens: 24,
        }
        chunk.data = JSON.stringify(response)
      }
      consola.debug("Streaming chunk:", JSON.stringify(chunk))
      await stream.writeSSE(chunk as SSEMessage)
    }
    consola.debug("Streaming complete")
  }, async (e, stream) => {
    consola.error("Failed stream:", e)
    await stream.close()
  })

  /*
  {
  "model":"grok-code-fast-1",
  "prompt":"<fim_prefix>import {\n  createInfillCompletion,\n  type InfillCompletionPayload,\n} from \"~/services/copilot/create-infill-completion\";\nimport type {Context} from \"hono\";\nimport {checkRateLimit} from \"~/lib/rate-limit\";\nimport {state} from \"~/lib/state\";\nimport consola from \"consola\";\n\nexport async function handleCompletion(c: Context) {\n  await checkRateLimit(state)\n\n  let payload = await c.req.json<any>()\n  consola.info(JSON.stringify(payload))\n  \n  <fim_suffix>\n\n  return c.json(null)\n}<fim_middle>",
  "stop":["<fim_prefix>","<fim_suffix>","<fim_middle>","\n\n","<file_sep>","<|endoftext|>","</fim_middle>","\n",")\n","]\n","}\n",",\n"],
  "suffix":null,
  "stream":true
  }
*/
}

const isNonStreaming = (
  response: Awaited<ReturnType<typeof createChatCompletions>>,
): response is ChatCompletionResponse => Object.hasOwn(response, "choices")

export type CompletionCreateParams = CompletionCreateParamsNonStreaming | CompletionCreateParamsStreaming;

export interface CompletionCreateParamsBase {
  /**
   * ID of the model to use. You can use the
   * [List models](https://platform.openai.com/docs/api-reference/models/list) API to
   * see all of your available models, or see our
   * [Model overview](https://platform.openai.com/docs/models) for descriptions of
   * them.
   */
  model: (string & {}) | 'gpt-3.5-turbo-instruct' | 'davinci-002' | 'babbage-002';

  /**
   * The prompt(s) to generate completions for, encoded as a string, array of
   * strings, array of tokens, or array of token arrays.
   *
   * Note that <|endoftext|> is the document separator that the model sees during
   * training, so if a prompt is not specified the model will generate as if from the
   * beginning of a new document.
   */
  prompt: string | Array<string> | Array<number> | Array<Array<number>> | null;

  /**
   * Generates `best_of` completions server-side and returns the "best" (the one with
   * the highest log probability per token). Results cannot be streamed.
   *
   * When used with `n`, `best_of` controls the number of candidate completions and
   * `n` specifies how many to return – `best_of` must be greater than `n`.
   *
   * **Note:** Because this parameter generates many completions, it can quickly
   * consume your token quota. Use carefully and ensure that you have reasonable
   * settings for `max_tokens` and `stop`.
   */
  best_of?: number | null;

  /**
   * Echo back the prompt in addition to the completion
   */
  echo?: boolean | null;

  /**
   * Number between -2.0 and 2.0. Positive values penalize new tokens based on their
   * existing frequency in the text so far, decreasing the model's likelihood to
   * repeat the same line verbatim.
   *
   * [See more information about frequency and presence penalties.](https://platform.openai.com/docs/guides/text-generation)
   */
  frequency_penalty?: number | null;

  /**
   * Modify the likelihood of specified tokens appearing in the completion.
   *
   * Accepts a JSON object that maps tokens (specified by their token ID in the GPT
   * tokenizer) to an associated bias value from -100 to 100. You can use this
   * [tokenizer tool](/tokenizer?view=bpe) to convert text to token IDs.
   * Mathematically, the bias is added to the logits generated by the model prior to
   * sampling. The exact effect will vary per model, but values between -1 and 1
   * should decrease or increase likelihood of selection; values like -100 or 100
   * should result in a ban or exclusive selection of the relevant token.
   *
   * As an example, you can pass `{"50256": -100}` to prevent the <|endoftext|> token
   * from being generated.
   */
  logit_bias?: { [key: string]: number } | null;

  /**
   * Include the log probabilities on the `logprobs` most likely output tokens, as
   * well the chosen tokens. For example, if `logprobs` is 5, the API will return a
   * list of the 5 most likely tokens. The API will always return the `logprob` of
   * the sampled token, so there may be up to `logprobs+1` elements in the response.
   *
   * The maximum value for `logprobs` is 5.
   */
  logprobs?: number | null;

  /**
   * The maximum number of [tokens](/tokenizer) that can be generated in the
   * completion.
   *
   * The token count of your prompt plus `max_tokens` cannot exceed the model's
   * context length.
   * [Example Python code](https://cookbook.openai.com/examples/how_to_count_tokens_with_tiktoken)
   * for counting tokens.
   */
  max_tokens?: number | null;

  /**
   * How many completions to generate for each prompt.
   *
   * **Note:** Because this parameter generates many completions, it can quickly
   * consume your token quota. Use carefully and ensure that you have reasonable
   * settings for `max_tokens` and `stop`.
   */
  n?: number | null;

  /**
   * Number between -2.0 and 2.0. Positive values penalize new tokens based on
   * whether they appear in the text so far, increasing the model's likelihood to
   * talk about new topics.
   *
   * [See more information about frequency and presence penalties.](https://platform.openai.com/docs/guides/text-generation)
   */
  presence_penalty?: number | null;

  /**
   * If specified, our system will make a best effort to sample deterministically,
   * such that repeated requests with the same `seed` and parameters should return
   * the same result.
   *
   * Determinism is not guaranteed, and you should refer to the `system_fingerprint`
   * response parameter to monitor changes in the backend.
   */
  seed?: number | null;

  /**
   * Not supported with latest reasoning models `o3` and `o4-mini`.
   *
   * Up to 4 sequences where the API will stop generating further tokens. The
   * returned text will not contain the stop sequence.
   */
  stop?: string | null | Array<string>;

  /**
   * Whether to stream back partial progress. If set, tokens will be sent as
   * data-only
   * [server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events#Event_stream_format)
   * as they become available, with the stream terminated by a `data: [DONE]`
   * message.
   * [Example Python code](https://cookbook.openai.com/examples/how_to_stream_completions).
   */
  stream?: boolean | null;

  /**
   * Options for streaming response. Only set this when you set `stream: true`.
   */
  stream_options?: ChatCompletionStreamOptions | null;

  /**
   * The suffix that comes after a completion of inserted text.
   *
   * This parameter is only supported for `gpt-3.5-turbo-instruct`.
   */
  suffix?: string | null;

  /**
   * What sampling temperature to use, between 0 and 2. Higher values like 0.8 will
   * make the output more random, while lower values like 0.2 will make it more
   * focused and deterministic.
   *
   * We generally recommend altering this or `top_p` but not both.
   */
  temperature?: number | null;

  /**
   * An alternative to sampling with temperature, called nucleus sampling, where the
   * model considers the results of the tokens with top_p probability mass. So 0.1
   * means only the tokens comprising the top 10% probability mass are considered.
   *
   * We generally recommend altering this or `temperature` but not both.
   */
  top_p?: number | null;

  /**
   * A unique identifier representing your end-user, which can help OpenAI to monitor
   * and detect abuse.
   * [Learn more](https://platform.openai.com/docs/guides/safety-best-practices#end-user-ids).
   */
  user?: string;
}

/**
 * Options for streaming response. Only set this when you set `stream: true`.
 */
export interface ChatCompletionStreamOptions {
  /**
   * When true, stream obfuscation will be enabled. Stream obfuscation adds random
   * characters to an `obfuscation` field on streaming delta events to normalize
   * payload sizes as a mitigation to certain side-channel attacks. These obfuscation
   * fields are included by default, but add a small amount of overhead to the data
   * stream. You can set `include_obfuscation` to false to optimize for bandwidth if
   * you trust the network links between your application and the OpenAI API.
   */
  include_obfuscation?: boolean;

  /**
   * If set, an additional chunk will be streamed before the `data: [DONE]` message.
   * The `usage` field on this chunk shows the token usage statistics for the entire
   * request, and the `choices` field will always be an empty array.
   *
   * All other chunks will also include a `usage` field, but with a null value.
   * **NOTE:** If the stream is interrupted, you may not receive the final usage
   * chunk which contains the total token usage for the request.
   */
  include_usage?: boolean;
}

export interface CompletionCreateParamsNonStreaming extends CompletionCreateParamsBase {
  /**
   * Whether to stream back partial progress. If set, tokens will be sent as
   * data-only
   * [server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events#Event_stream_format)
   * as they become available, with the stream terminated by a `data: [DONE]`
   * message.
   * [Example Python code](https://cookbook.openai.com/examples/how_to_stream_completions).
   */
  stream?: false | null;
}

export interface CompletionCreateParamsStreaming extends CompletionCreateParamsBase {
  /**
   * Whether to stream back partial progress. If set, tokens will be sent as
   * data-only
   * [server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events#Event_stream_format)
   * as they become available, with the stream terminated by a `data: [DONE]`
   * message.
   * [Example Python code](https://cookbook.openai.com/examples/how_to_stream_completions).
   */
  stream: true;
}

/**
 * Represents a completion response from the API. Note: both the streamed and
 * non-streamed response objects share the same shape (unlike the chat endpoint).
 */
export interface Completion {
  /**
   * A unique identifier for the completion.
   */
  id: string;

  /**
   * The list of completion choices the model generated for the input prompt.
   */
  choices: Array<CompletionChoice>;

  /**
   * The Unix timestamp (in seconds) of when the completion was created.
   */
  created: number;

  /**
   * The model used for completion.
   */
  model: string;

  /**
   * The object type, which is always "text_completion"
   */
  object: 'text_completion';

  /**
   * This fingerprint represents the backend configuration that the model runs with.
   *
   * Can be used in conjunction with the `seed` request parameter to understand when
   * backend changes have been made that might impact determinism.
   */
  system_fingerprint?: string;

  /**
   * Usage statistics for the completion request.
   */
  usage?: CompletionUsage;
}

interface CompletionChoice {
  /**
   * The reason the model stopped generating tokens. This will be `stop` if the model
   * hit a natural stop point or a provided stop sequence, `length` if the maximum
   * number of tokens specified in the request was reached, or `content_filter` if
   * content was omitted due to a flag from our content filters.
   */
  finish_reason: 'stop' | 'length' | 'content_filter';

  index: number;

  logprobs: Logprobs | null;

  text: string;
}

interface Logprobs {
  text_offset?: Array<number>;

  token_logprobs?: Array<number>;

  tokens?: Array<string>;

  top_logprobs?: Array<{ [key: string]: number }>;
}

/**
 * Usage statistics for the completion request.
 */
interface CompletionUsage {
  /**
   * Number of tokens in the generated completion.
   */
  completion_tokens: number;

  /**
   * Number of tokens in the prompt.
   */
  prompt_tokens: number;

  /**
   * Total number of tokens used in the request (prompt + completion).
   */
  total_tokens: number;

  /**
   * Breakdown of tokens used in a completion.
   */
  completion_tokens_details?: CompletionTokensDetails;

  /**
   * Breakdown of tokens used in the prompt.
   */
  prompt_tokens_details?: PromptTokensDetails;
}

/**
 * Breakdown of tokens used in the prompt.
 */
interface PromptTokensDetails {
  /**
   * Audio input tokens present in the prompt.
   */
  audio_tokens?: number;

  /**
   * Cached tokens present in the prompt.
   */
  cached_tokens?: number;
}

/**
 * Breakdown of tokens used in a completion.
 */
interface CompletionTokensDetails {
  /**
   * When using Predicted Outputs, the number of tokens in the prediction that
   * appeared in the completion.
   */
  accepted_prediction_tokens?: number;

  /**
   * Audio input tokens generated by the model.
   */
  audio_tokens?: number;

  /**
   * Tokens generated by the model for reasoning.
   */
  reasoning_tokens?: number;

  /**
   * When using Predicted Outputs, the number of tokens in the prediction that did
   * not appear in the completion. However, like reasoning tokens, these tokens are
   * still counted in the total completion tokens for purposes of billing, output,
   * and context window limits.
   */
  rejected_prediction_tokens?: number;
}
