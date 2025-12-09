import { Hono } from "hono"

import { forwardError } from "~/lib/error"

import { handleCompletion } from "./handler"

export const chatCompletionRoutes = new Hono()

chatCompletionRoutes.post("/", async (c) => {
  try {
    return await handleCompletion(c)
  } catch (error) {
    return await forwardError(c, error)
  }
})
