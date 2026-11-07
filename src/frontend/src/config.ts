import {
  createActor,
  type backendInterface,
  type CreateActorOptions,
  ExternalBlob,
} from "./backend";
import { StorageClient } from "./utils/StorageClient";
import { HttpAgent } from "@icp-sdk/core/agent";

const DEFAULT_STORAGE_GATEWAY_URL = "http://localhost:6188";
const DEFAULT_BUCKET_NAME = "default-bucket";
const DEFAULT_PROJECT_ID = "0000000-0000-0000-0000-00000000000";
const DEFAULT_MAINNET_HOST = "https://icp-api.io";
const DEFAULT_LOCAL_HOST = "http://localhost:8081";

interface JsonConfig {
  backend_host: string;
  backend_canister_id: string;
  project_id: string;
  ii_derivation_origin: string;
}

interface Config {
  backend_host: string;
  backend_canister_id: string;
  storage_gateway_url: string;
  bucket_name: string;
  project_id: string;
  ii_derivation_origin?: string;
}

let configCache: Config | null = null;

export async function loadConfig(): Promise<Config> {
  if (configCache) return configCache;

  const backendCanisterId = process.env.CANISTER_ID_BACKEND;
  const isLocal = process.env.DFX_NETWORK === "local";
  const envBaseUrl = process.env.BASE_URL || "/";
  const baseUrl = envBaseUrl.endsWith("/") ? envBaseUrl : `${envBaseUrl}/`;

  let fileConfig: Partial<JsonConfig> = {};
  try {
    const response = await fetch(`${baseUrl}env.json`);
    if (response.ok) fileConfig = (await response.json()) as JsonConfig;
  } catch (error) {
    // The build-time canister ID and safe network defaults remain available
    // when a static host does not publish env.json.
    console.warn("CloudSentinels runtime config file is unavailable.", error);
  }

  const configuredCanisterId =
    fileConfig.backend_canister_id &&
    fileConfig.backend_canister_id !== "undefined"
      ? fileConfig.backend_canister_id
      : backendCanisterId;

  if (!configuredCanisterId || configuredCanisterId === "undefined") {
    throw new Error(
      "CloudSentinels is not connected to a backend canister. Configure CANISTER_ID_BACKEND in the frontend build environment, then rebuild and redeploy.",
    );
  }

  const configuredHost =
    fileConfig.backend_host && fileConfig.backend_host !== "undefined"
      ? fileConfig.backend_host
      : isLocal
        ? DEFAULT_LOCAL_HOST
        : DEFAULT_MAINNET_HOST;

  configCache = {
    backend_host: configuredHost,
    backend_canister_id: configuredCanisterId,
    storage_gateway_url:
      process.env.STORAGE_GATEWAY_URL ?? DEFAULT_STORAGE_GATEWAY_URL,
    bucket_name: DEFAULT_BUCKET_NAME,
    project_id:
      fileConfig.project_id && fileConfig.project_id !== "undefined"
        ? fileConfig.project_id
        : DEFAULT_PROJECT_ID,
    ii_derivation_origin:
      fileConfig.ii_derivation_origin &&
      fileConfig.ii_derivation_origin !== "undefined"
        ? fileConfig.ii_derivation_origin
        : undefined,
  };
  return configCache;
}

function extractAgentErrorMessage(error: string): string {
  const errorString = String(error);
  const match = errorString.match(/with message:\s*'([^']+)'/s);
  return match ? match[1] : errorString;
}

function processError(e: unknown): never {
  if (e && typeof e === "object" && "message" in e) {
    throw new Error(extractAgentErrorMessage(`${e.message}`));
  }
  throw e;
}

async function maybeLoadMockBackend(): Promise<backendInterface | null> {
  if (import.meta.env.VITE_USE_MOCK !== "true") return null;

  try {
    const mockModules = import.meta.glob("./mocks/backend.{ts,tsx,js,jsx}");
    const path = Object.keys(mockModules)[0];
    if (!path) return null;
    const mod = (await mockModules[path]()) as {
      mockBackend?: backendInterface;
    };
    return mod.mockBackend ?? null;
  } catch {
    return null;
  }
}

export async function createActorWithConfig(
  options?: CreateActorOptions,
): Promise<backendInterface> {
  const mock = await maybeLoadMockBackend();
  if (mock) return mock;

  const config = await loadConfig();
  const resolvedOptions = options ?? {};
  const agent = new HttpAgent({
    ...resolvedOptions.agentOptions,
    host: config.backend_host,
  });

  if (config.backend_host.includes("localhost")) {
    await agent.fetchRootKey().catch((err) => {
      console.warn(
        "Unable to fetch root key. Check that the local ICP replica is running.",
      );
      console.error(err);
    });
  }

  const actorOptions = {
    ...resolvedOptions,
    agent,
    processError,
  };

  const storageClient = new StorageClient(
    config.bucket_name,
    config.storage_gateway_url,
    config.backend_canister_id,
    config.project_id,
    agent,
  );

  const MOTOKO_DEDUPLICATION_SENTINEL = "cloudsentinels:";

  const uploadFile = async (file: ExternalBlob): Promise<Uint8Array> => {
    const { hash } = await storageClient.putFile(
      await file.getBytes(),
      file.onProgress,
    );
    return new TextEncoder().encode(MOTOKO_DEDUPLICATION_SENTINEL + hash);
  };

  const downloadFile = async (bytes: Uint8Array): Promise<ExternalBlob> => {
    const hashWithPrefix = new TextDecoder().decode(new Uint8Array(bytes));
    const hash = hashWithPrefix.substring(MOTOKO_DEDUPLICATION_SENTINEL.length);
    const url = await storageClient.getDirectURL(hash);
    return ExternalBlob.fromURL(url);
  };

  return createActor(
    config.backend_canister_id,
    uploadFile,
    downloadFile,
    actorOptions,
  );
}
