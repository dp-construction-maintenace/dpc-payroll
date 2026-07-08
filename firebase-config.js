// ============================================================
// FIREBASE CONFIG — replace the values below with YOUR project's
// config snippet from the Firebase Console.
//
// How to get this: Firebase Console → Project settings (gear icon)
// → General tab → "Your apps" → Web app → SDK setup and config.
// Full walkthrough in README.md.
// ============================================================
window.firebaseConfig = {
  apiKey: "AIzaSyAMV9wb8oVBEKaWjJTClDZpDC0uK0XFjYQ",
  authDomain: "dpc-payroll.firebaseapp.com",
  projectId: "dpc-payroll",
  storageBucket: "dpc-payroll.firebasestorage.app",
  messagingSenderId: "594043754277",
  appId: "1:594043754277:web:3e892723f6b2415dfdaccc"
};

// Company details shown on payslips. Edit freely — this is also
// editable from inside the app (Settings tab) once you're logged in;
// the app copy (stored in Firestore) will take priority once saved.
window.companyDefaults = {
  name: "DP Construction Group",
  regNo: "",
  address: "",
  phone: "",
  email: "",
  logoDataUrl: "" // leave blank, or paste a base64 image data URL
};
