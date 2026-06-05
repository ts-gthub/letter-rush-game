import { initializeApp } from 'firebase/app';
import { getDatabase } from 'firebase/database';

// 1) Create a Firebase project
// 2) Create a Realtime Database
// 3) Replace this config with your Firebase web app config
const firebaseConfig = {
  apiKey: "AIzaSyCMs6WLvpedO-RxnBkKhCw1obwTBmZzxY8",
  authDomain: "letter-rush-game.firebaseapp.com",
  databaseURL: "https://letter-rush-game-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "letter-rush-game",
  storageBucket: "letter-rush-game.firebasestorage.app",
  messagingSenderId: "549741342102",
  appId: "1:549741342102:web:a8eb49780116a630fe01b7"
};

export const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
