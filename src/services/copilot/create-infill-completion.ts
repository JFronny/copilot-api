import { copilotBaseUrl } from "~/lib/api-config"
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

  const headers: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
    "User-Agent": "helix/1.0.0",
    Authorization: `Bearer ${state.copilotToken}`,
    "Editor-Plugin-Version": "copilot-chat/0.24.1",
    "Editor-Version": "vscode/1.99",
    "Openai-Intent": "conversation-panel",
    "Openai-Organization": "github-copilot",
    "VScode-MachineId": genHexStr(64),
    "VScode-SessionId":
      genHexStr(8) +
      "-" +
      genHexStr(4) +
      "-" +
      genHexStr(4) +
      "-" +
      genHexStr(4) +
      "-" +
      genHexStr(25),
    "X-Request-Id":
      genHexStr(8) +
      "-" +
      genHexStr(4) +
      "-" +
      genHexStr(4) +
      "-" +
      genHexStr(4) +
      "-" +
      genHexStr(12),
    "Accept-Encoding": "gzip,deflate,br",
    Accept: "*/*",
  }

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