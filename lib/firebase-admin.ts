import { initializeApp, getApps, cert, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

let app: App;
let adminDb: Firestore;

function getAdminApp(): App {
  if (app) return app;
  const apps = getApps();
  if (apps.length > 0) {
    app = apps[0];
    return app;
  }

  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!serviceAccountJson) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT env var is not set");
  }

  const serviceAccount = JSON.parse(serviceAccountJson);
  app = initializeApp({ credential: cert(serviceAccount) });
  return app;
}

export function getAdminDb(): Firestore {
  if (adminDb) return adminDb;
  getAdminApp();
  adminDb = getFirestore();
  return adminDb;
}
