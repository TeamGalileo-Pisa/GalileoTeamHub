import { supabase } from "./supabase";
import { friendlyError } from "./errors";
export async function rpc<T = void>(
  name: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw friendlyError(error);
  return data as T;
}
export async function staffAction(
  body: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase.functions.invoke("staff-admin", { body });
  if (!error) return;
  let payload: unknown = error;
  if (error.context instanceof Response) {
    try {
      payload = await error.context.json();
    } catch {
      /* generic safe message */
    }
  }
  throw friendlyError(payload);
}
