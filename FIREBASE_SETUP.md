# KALNET Portal Setup Notes

## Vercel Environment Variables

Add these in your Vercel project settings:

- `GROQ_API_KEY=your_real_groq_key`
- `GROQ_MODEL=llama-3.3-70b-versatile`

## Required Firestore Rules

Use this ruleset so recruiter auth, tickets, chat, and recruiter analysis attendance all work correctly:

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

    match /meetings/{meetingId} {
      allow read: if signedIn();
      allow create, update: if isRecruiter();
      allow delete: if false;
    }

    match /meetingAttendance/{recordId} {
      allow read: if signedIn();
      allow create, update: if isRecruiter();
      allow delete: if false;
    }

    match /tickets/{ticketId} {
      allow read: if signedIn();
      allow create: if signedIn();
      allow update: if isRecruiter();
      allow delete: if false;
    }

    match /deliverables/{deliverableId} {
      allow read: if signedIn();
      allow create: if signedIn();
      allow update, delete: if false;
    }

    match /qa/{qaId} {
      allow read: if signedIn();
      allow create: if signedIn();
      allow update: if signedIn();
      allow delete: if false;
    }

    match /chat/{chatId} {
      allow read, create: if signedIn();
      allow update, delete: if false;
    }
  }
}
```

## Notes

- The recruiter analysis page is recruiter-only and uses live Firestore data.
- Meeting attendance is now stored in the `meetingAttendance` collection.
- The AI analysis works on Vercel through `/api/groq-chat` and locally through `npm.cmd run dev`.
