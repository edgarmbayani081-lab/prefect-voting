export const firebaseConfig = {
  apiKey: "AIzaSyBOYb9RZpwVBFZLwVcy_URFrLIldqXbJfM",
  authDomain: "prefect-election.firebaseapp.com",
  projectId: "prefect-election",
  appId: "1:414570812421:web:72c9198232c20f7956386c",
};

export const isConfigured = !Object.values(firebaseConfig).some((v) => String(v).startsWith("PASTE"));