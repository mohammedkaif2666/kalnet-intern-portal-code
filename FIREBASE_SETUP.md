# KALNET Portal - Firebase Setup Guide

This portal now uses:

- Firebase Authentication with email/password
- Google sign-in for recruiter access
- A single `interns` collection for both recruiters and interns
- Recruiter-created intern accounts
- Firestore collections for meetings, tickets, chat, deliverables, and Q&A

## 1. Create the Firebase project

1. Open the Firebase Console.
2. Create a project for the KALNET portal.
3. Register a web app and copy the Firebase config.
4. Replace the encoded config values in the frontend if you move to a new Firebase project.

## 2. Enable Authentication

Go to `Build > Authentication > Sign-in method` and enable:

- `Email/Password`
- `Google`

## 3. Firestore collections used by the portal

Create or allow the app to create these collections:

- `interns`
- `deliverables`
- `qa`
- `chat`
- `meetings`
- `tickets`

### `interns` document shape

Each user is stored in `interns/{uid}` with a `role` field:

```json
{
  "uid": "firebase-auth-uid",
  "name": "User name",
  "email": "user@example.com",
  "phone": "91XXXXXXXXXX",
  "role": "intern",
  "group": "Group A",
  "photoURL": "",
  "showcasePhotos": [],
  "github": "",
  "linkedin": "",
  "portfolio": "",
  "credits": 0,
  "profileComplete": true,
  "createdByRecruiterUid": "optional-recruiter-uid",
  "createdByRecruiterName": "optional recruiter name"
}
```

For recruiters:

```json
{
  "role": "recruiter",
  "group": "Recruiter"
}
```

## 4. Recommended Firestore rules

The UI now separates recruiter and intern workflows, but real protection still depends on Firestore rules.

Use recruiter-aware rules instead of open read/write access. A good starting point is:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function signedIn() {
      return request.auth != null;
    }

    function userProfile() {
      return get(/databases/$(database)/documents/interns/$(request.auth.uid));
    }

    function isRecruiter() {
      return signedIn() &&
        exists(/databases/$(database)/documents/interns/$(request.auth.uid)) &&
        (
          userProfile().data.role == 'recruiter' ||
          userProfile().data.group == 'Recruiter'
        );
    }

    function isOwner(userId) {
      return signedIn() && request.auth.uid == userId;
    }

    match /interns/{userId} {
      allow read: if signedIn();
      allow create: if isRecruiter() || isOwner(userId);
      allow update: if isRecruiter() || isOwner(userId);
      allow delete: if false;
    }

    match /deliverables/{docId} {
      allow read: if signedIn();
      allow create: if signedIn();
      allow update: if signedIn();
    }

    match /qa/{docId} {
      allow read: if signedIn();
      allow create: if signedIn();
      allow update: if signedIn();
    }

    match /chat/{docId} {
      allow read, create: if signedIn();
    }

    match /meetings/{docId} {
      allow read: if signedIn();
      allow create, update: if isRecruiter();
    }

    match /tickets/{docId} {
      allow read: if signedIn();
      allow create: if signedIn();
      allow update: if isRecruiter();
    }
  }
}
```

Adjust these rules if you want tighter ownership checks on `deliverables`, `qa`, or `chat`.

## 5. Important limitation

Recruiter-created intern accounts are currently created from the frontend with a secondary Firebase Auth instance. That works for a pure frontend portal, but if you want stronger security and auditability, move user creation to a server-side Firebase Admin flow or a Cloud Function later.

## 6. Deployment

The AI mentor is now wired through the local Express server in `server.js`, so the Groq key stays server-side and is never exposed in frontend code.

Recommended deployment flow:

1. Create a `.env` file in the project root.
2. Add:

```env
GROQ_API_KEY=your_server_side_groq_api_key
GROQ_MODEL=llama-3.3-70b-versatile
PORT=3000
```

3. Install dependencies:

```bash
npm install
```

4. Start the app:

```bash
npm run dev
```

This serves both:

- the portal frontend
- the AI mentor route at `/api/groq-chat`

Important notes:

- `GitHub Pages` is not suitable if you want the AI mentor key to stay hidden, because it cannot run `server.js`.
- A pure `Parcel` static deployment also cannot securely hide the Groq key. If you want to keep the AI mentor secure, deploy the project on a Node-capable host that can run `server.js`.
- The default Groq model is `llama-3.3-70b-versatile`, which is a strong choice for explanation and debugging tasks in this portal.

## 7. Operational notes

- Intern sign-in uses `email + phone number password`
- Recruiters can sign in with `email + phone number password` or Google
- Recruiter signup is public in the UI, but only recruiter accounts should be created through that page
- Intern signup is intentionally removed from the public website
- Group assignment is intentionally controlled from the recruiter dashboard
- Browser meeting notifications work when the app is open and notification permission is enabled
- True background push notifications when the app is fully closed still require Firebase Cloud Messaging or another push service later
