# Letter Rush

A multiplayer digital version of Name / Animal / Capital / Fruit or Vegetable / Celebrity.

## Features
- Room code system
- Many players can join
- One game master
- Game master can assign another player as game master
- 10 rounds per game
- 60 seconds per round
- Random letter every round
- Game master judges answers at the end
- 10 points for each correct answer
- Final leaderboard

## Setup
1. Create a Firebase project.
2. Create a Realtime Database.
3. Register a Web App in Firebase.
4. Copy your Firebase config into `src/firebase.js`.
5. Install and run locally:

```bash
npm install
npm run dev
```

## Deploy to Vercel
1. Upload this folder to GitHub.
2. Go to Vercel.
3. Add New Project.
4. Choose the GitHub repo.
5. Click Deploy.

## Simple Firebase Realtime Database Rules for testing
Use these only for MVP testing with friends:

```json
{
  "rules": {
    ".read": true,
    ".write": true
  }
}
```

Do not use open rules for a serious public launch.
