import { createServiceClient } from "./service-client.ts";

// Validate with Auth itself: supports both legacy and asymmetric session JWTs.
export async function requireActor(request: Request, adminOnly = true) {
  const token = request.headers.get("authorization")?.match(/^Bearer (.+)$/i)
    ?.[1];
  if (!token) throw new Error("UNAUTHORIZED");
  const client = createServiceClient();
  const { data: { user }, error } = await client.auth.getUser(token);
  if (error || !user) throw new Error("UNAUTHORIZED");
  const { data: profile } = await client.from("profiles").select(
    "status,must_change_password",
  ).eq("id", user.id).single();
  if (profile?.status !== "active" || profile.must_change_password) {
    throw new Error("FORBIDDEN");
  }
  if (adminOnly) {
    const { data: roles } = await client.from("system_roles").select("role").eq(
      "user_id",
      user.id,
    ).in("role", ["admin", "team_leader"]);
    if (!roles?.length) throw new Error("FORBIDDEN");
  }
  return { client, user };
}
