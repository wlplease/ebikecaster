type FirestoreValue =
  | { stringValue: string }
  | { integerValue: string }
  | { doubleValue: number }
  | { booleanValue: boolean }
  | { nullValue: null }
  | { mapValue: { fields: Record<string, FirestoreValue> } };

type FirestoreDocument = {
  name: string;
  fields?: Record<string, FirestoreValue>;
};

type QueryResult = {
  document?: FirestoreDocument;
};

const PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "";
const API_KEY = process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "";
const BASE_URL = PROJECT_ID
  ? `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`
  : "";

function configured() {
  return !!PROJECT_ID && !!API_KEY;
}

function url(path = "") {
  if (!configured()) throw new Error("Firebase client config is not set");
  const suffix = path ? (path.startsWith(":") ? path : `/${path}`) : "";
  return `${BASE_URL}${suffix}?key=${encodeURIComponent(API_KEY)}`;
}

function valueToFirestore(value: unknown): FirestoreValue {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") {
    if (Number.isInteger(value)) return { integerValue: String(value) };
    return { doubleValue: value };
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    return { mapValue: { fields: objectToFields(value as Record<string, unknown>) } };
  }
  return { stringValue: String(value) };
}

function valueFromFirestore(value: FirestoreValue | undefined): unknown {
  if (!value) return undefined;
  if ("stringValue" in value) return value.stringValue;
  if ("integerValue" in value) return Number(value.integerValue || 0);
  if ("doubleValue" in value) return value.doubleValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("nullValue" in value) return null;
  if ("mapValue" in value) return fieldsToObject(value.mapValue.fields || {});
  return undefined;
}

function objectToFields(data: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(data).map(([key, value]) => [key, valueToFirestore(value)]));
}

function fieldsToObject(fields: Record<string, FirestoreValue>) {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, valueFromFirestore(value)]));
}

function documentId(name: string) {
  return name.split("/").pop() || "";
}

export function firebaseRestConfigured() {
  return configured();
}

export async function getDoc(collection: string, id: string) {
  const res = await fetch(url(`${collection}/${encodeURIComponent(id)}`), { cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("Firestore read failed");
  const doc = (await res.json()) as FirestoreDocument;
  return { id, data: fieldsToObject(doc.fields || {}) };
}

export async function setDoc(collection: string, id: string, data: Record<string, unknown>) {
  const res = await fetch(url(`${collection}/${encodeURIComponent(id)}`), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fields: objectToFields(data) }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error("Firestore write failed");
}

export async function addDoc(collection: string, data: Record<string, unknown>) {
  const res = await fetch(url(collection), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fields: objectToFields(data) }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error("Firestore add failed");
}

export async function queryDocs({
  collection,
  whereField,
  whereValue,
  orderField,
  orderDirection = "DESCENDING",
  limit = 25,
}: {
  collection: string;
  whereField?: string;
  whereValue?: string | number | boolean;
  orderField: string;
  orderDirection?: "ASCENDING" | "DESCENDING";
  limit?: number;
}) {
  const structuredQuery: Record<string, unknown> = {
    from: [{ collectionId: collection }],
    orderBy: [{ field: { fieldPath: orderField }, direction: orderDirection }],
    limit,
  };

  if (whereField && whereValue !== undefined) {
    structuredQuery.where = {
      fieldFilter: {
        field: { fieldPath: whereField },
        op: "EQUAL",
        value: valueToFirestore(whereValue),
      },
    };
  }

  const res = await fetch(url(":runQuery"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ structuredQuery }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error("Firestore query failed");
  const rows = (await res.json()) as QueryResult[];
  return rows
    .filter((row) => row.document)
    .map((row) => ({
      id: documentId(row.document?.name || ""),
      data: fieldsToObject(row.document?.fields || {}),
    }));
}
