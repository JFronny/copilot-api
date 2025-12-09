import { copilotHeaders, copilotBaseUrl } from "~/lib/api-config"
import {state} from "~/lib/state";
import consola from "consola";
import type {ChatCompletionResponse} from "~/services/copilot/create-chat-completions";
import {events} from "fetch-event-stream";
import crypto from "crypto"

export const genHexStr = (length: number) => {
  const bytes = crypto.randomBytes(length / 2);
  return bytes.toString('hex');
}

export const createInfillCompletion = async (
  payload: InfillCompletionPayload,
) => {
  if (!state.copilotToken) throw new Error("Copilot token not found")

  const headers: Record<string, string> = copilotHeaders(state, false)

  consola.debug("Headers: ")

  const response = await fetch(`${copilotBaseUrl(state, "proxy")}/v1/engines/gpt-4o-copilot/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload)
  })

  if (!response.ok) {
    consola.error("Failed to create infill completion", response)
    throw new Error("Failed to create infill completion")
  }

  if (payload.stream) {
    return events(response);
  }

  return (await response.json()) as ChatCompletionResponse
}

export interface InfillCompletionPayload {
  temperature?: number | null
  top_p?: number | null
  max_tokens?: number | null
  stop?: string | Array<string> | null
  n?: number | null
  nwo?: string | null
  prompt: string | Array<string> | null
  suffix?: string | null
  stream?: boolean | null
  extra?: InfillCompletionExtra
}

export interface InfillCompletionExtra {
  language?: string | null
  next_intent?: number | null
  prompt_tokens?: number | null
  suffix_tokens?: number | null
  trim_by_indentation?: boolean | null
}
