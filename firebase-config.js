import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-app.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';
import { getAuth, signInAnonymously } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js';

const firebaseConfig = {
  apiKey: 'AIzaSyCgPkeacvypxyqew1iXtpmAs-uXL4KI2HA',
  authDomain: 'baatokasystem.firebaseapp.com',
  projectId: 'baatokasystem',
  storageBucket: 'baatokasystem.appspot.com',
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

await signInAnonymously(auth);

export { db, auth };
