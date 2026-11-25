// Only enabled by the loopback dashboard build. Tokens live in memory for this tab.
export const localOperatorMode = import.meta.env.VITE_LOCAL_OPERATOR === "true";
let token: string | null = null;
export const localOperatorToken = () => token;
export function setLocalOperatorToken(value: string | null) {
  token = value;
}
