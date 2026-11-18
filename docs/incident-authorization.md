# Incident authorization

CloudSentinels separates authentication from incident mutation permissions.

## Access rules

- Listing, reading, creating incidents, and reading comments require a valid authenticated session.
- Updating an incident, running triage analysis, or deleting an incident requires a Firebase custom claim containing `roles: ["operator"]` or `roles: ["admin"]`.
- Comment authors are derived from the verified Firebase identity (email, falling back to UID). The API rejects client-supplied author names.
- Incident deletion writes an audit log entry with the incident ID and authenticated subject.
- The local development bearer token is assigned both `operator` and `admin` roles by the local authenticator. It is disabled in production unless explicitly enabled.

## Assigning a role

Roles must be assigned by a trusted server-side administrator using the Firebase Admin SDK. Never accept role changes from the browser or store service-account credentials in the repository.

Example Node.js administration script (run only in a trusted environment with Firebase Admin credentials configured):

```js
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

initializeApp({ credential: applicationDefault() });

const uid = process.argv[2];
const role = process.argv[3];

if (!uid || !["operator", "admin"].includes(role)) {
  throw new Error("Usage: node set-role.mjs <firebase-uid> <operator|admin>");
}

const user = await getAuth().getUser(uid);
const existing = Array.isArray(user.customClaims?.roles)
  ? user.customClaims.roles
  : [];

const roles = [...new Set([...existing, role])];
await getAuth().setCustomUserClaims(uid, { ...user.customClaims, roles });
console.log(`Assigned ${role} to ${uid}; refresh the user's ID token.`);
```

After assigning a role, the user must obtain a refreshed Firebase ID token before the claim is available to CloudSentinels. Role removal should also be performed server-side with the Admin SDK and should preserve unrelated custom claims.

## Operational note

The current incident store is process-local memory, not a durable multi-tenant database. Role checks protect mutation endpoints, but they do not provide per-tenant data isolation. Do not treat the current in-memory store as a production multi-tenant boundary; durable persistence and tenant ownership checks remain separate production-readiness work.
