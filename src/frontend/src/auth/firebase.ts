import { firebaseAuth } from "./FirebaseAuth";

export async function getFirebaseIdToken(): Promise<string | null> {
  const user = firebaseAuth?.currentUser;
  return user ? user.getIdToken() : null;
}
