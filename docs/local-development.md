# Local development

## 1. Install

```bash
npm install
```

## 2. Configure Firebase

Create a Firebase project and enable Authentication. For the first increment, use a test authentication user/provider supported by the Android client. Record the Firebase project ID.

Set:

```text
FIREBASE_PROJECT_ID=...
```

in `.dev.vars`.

## 3. Local D1

```bash
npm run db:migrate:local
```

Check tables:

```bash
npx wrangler d1 execute mygate-control --local --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
```

## 4. Run Worker

```bash
npm run dev
```

## 5. Test health

```bash
curl http://localhost:8787/v1/health
```

## 6. Test authentication

Get a Firebase ID token from a test client. Then call:

```bash
curl http://localhost:8787/v1/me \
  -H "Authorization: Bearer $FIREBASE_ID_TOKEN"
```

A newly authenticated Firebase user is created in `users`, but still has no society membership. This is intentional.

Platform provisioning will create the society, license and membership. That provisioning API is part of the next increment.

## 7. Run tests

```bash
npm test
npm run typecheck
```
