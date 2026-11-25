import ReactDOM from "react-dom/client";
import App from "./App";
import { FirebaseAuthProvider } from "./auth/FirebaseAuth";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./index.css";
BigInt.prototype.toJSON = function () {
  return this.toString();
};
declare global {
  interface BigInt {
    toJSON(): string;
  }
}
ReactDOM.createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <FirebaseAuthProvider>
      <App />
    </FirebaseAuthProvider>
  </ErrorBoundary>,
);
