/// <reference path="../_shared/runtime.d.ts" />
import { createServiceClient } from "../_shared/service-client.ts";
import { sendQueuedEmail } from "../_shared/email.ts";

Deno.serve(async (request) => {
  if (request.method !== "POST") return new Response(null, { status: 405 });
  const token = request.headers.get("x-queue-token");
  if (!token || !/^[a-f0-9]{64}$/.test(token))
    return new Response(null, { status: 401 });
  const client = createServiceClient();
  const { data: authorized, error } = await client.rpc(
    "verify_email_worker_token",
    { p_token: token },
  );
  if (error || authorized !== true) return new Response(null, { status: 401 });
  const { data: ids, error: queueError } = await client.rpc(
    "list_due_email_deliveries",
  );
  if (queueError) return new Response(null, { status: 503 });
  EdgeRuntime.waitUntil(
    Promise.allSettled(
      ((ids as string[]) ?? []).map((id) => sendQueuedEmail(client, id)),
    ).then(() => undefined),
  );
  return new Response(null, { status: 202 });
});
