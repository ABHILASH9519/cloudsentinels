import { firebaseAuth } from "./FirebaseAuth";
import { localOperatorMode, localOperatorToken } from "./localOperator";

export async function getFirebaseIdToken(): Promise<string | null> {
  if (localOperatorMode) return localOperatorToken();
  const user = firebaseAuth?.currentUser;
  return user ? user.getIdToken() : null;
}
