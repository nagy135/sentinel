import { getAuth } from "./auth.server";

const json = (error: string, status: number) =>
  Response.json(
    { error },
    { status, headers: { "Cache-Control": "no-store" } },
  );
export async function handleAuth(request: Request, action: "login" | "logout") {
  const auth = getAuth();
  if (!auth.sameOrigin(request))
    return json("Request origin is not allowed.", 403);
  if (action === "logout") {
    await auth.ready;
    auth.revoke(request);
    return new Response(null, {
      status: 204,
      headers: {
        "Set-Cookie": auth.cookie(request, null),
        "Cache-Control": "no-store",
      },
    });
  }
  if (request.headers.get("content-type")?.split(";")[0] !== "application/json")
    return json("Send credentials as JSON.", 415);
  const reader = request.body?.getReader();
  if (!reader) return json("Username and password are required.", 400);
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > 8192) {
      await reader.cancel();
      return json("Request is too large.", 413);
    }
    chunks.push(value);
  }
  let input: unknown;
  try {
    input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return json("Invalid request.", 400);
  }
  if (
    !input ||
    typeof input !== "object" ||
    !("username" in input) ||
    !("password" in input) ||
    typeof input.username !== "string" ||
    typeof input.password !== "string" ||
    !input.username ||
    input.username.length > 256 ||
    !input.password ||
    input.password.length > 1024
  )
    return json("Username and password are required.", 400);
  const result = await auth.signIn(input.username, input.password);
  if ("status" in result) {
    const response = json(
      result.status === 429
        ? "Too many attempts. Try again in a minute."
        : "Incorrect username or password.",
      result.status,
    );
    if (result.status === 429) response.headers.set("Retry-After", "60");
    return response;
  }
  auth.revoke(request);
  return new Response(null, {
    status: 204,
    headers: {
      "Set-Cookie": auth.cookie(request, result.token),
      "Cache-Control": "no-store",
    },
  });
}
