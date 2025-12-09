import {Hono} from "hono";
import {handleCompletion} from "~/routes/completions/handler";
import {forwardError} from "~/lib/error";

export const completionRoutes = new Hono()

completionRoutes.post("/", async (c) => {
  try {
    return await handleCompletion(c)
  } catch (error) {
    return await forwardError(c, error)
  }
})