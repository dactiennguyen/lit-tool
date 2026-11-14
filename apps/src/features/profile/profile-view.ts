// Pull display fields out of an `account/account_info` or `user/get_info`
// response without assuming an exact schema: the payload is usually under `data`.

import { AVATAR_KEYS, ID_KEYS, isObject, NAME_KEYS, pickString, safeImageUrl, type Json } from "@/lib/lit-json";

export type Scalar = string | number | boolean;

export interface ProfileView {
  name: string | null;
  avatarUrl: string | null;
  id: string | null;
  /** Top-level scalar fields of the profile object, in server order. */
  fields: [string, Scalar][];
  root: Json;
}

export function toProfileView(response: Json): ProfileView {
  const root = isObject(response.data) ? response.data : response;
  const fields = Object.entries(root).filter(
    (e): e is [string, Scalar] => ["string", "number", "boolean"].includes(typeof e[1]),
  );
  return {
    name: pickString(root, NAME_KEYS),
    avatarUrl: safeImageUrl(pickString(root, AVATAR_KEYS)),
    id: pickString(root, ID_KEYS),
    fields: response === root ? fields.filter(([k]) => k !== "success" && k !== "result") : fields,
    root,
  };
}
