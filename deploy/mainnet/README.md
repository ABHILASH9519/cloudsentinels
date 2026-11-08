# CloudSentinels ICP Mainnet Deployment Preparation

This runbook prepares a user-owned ICP mainnet deployment. It does not create canisters, spend ICP, mint cycles, or publish a live application by itself.

## Ownership and funding requirements

- Deploy from an ICP identity controlled by the project owner.
- Never share a seed phrase, private key, hardware-wallet recovery phrase, or admin bootstrap token.
- Canister IDs are assigned by ICP when canisters are created. Do not invent or pre-fill IDs.
- ICP converted to cycles is not reversible: cycles cannot be converted back to ICP.
- Cycles are consumed by canister compute, storage, and messages. Monitor balances and set a funding alert/reminder.

Official guidance currently recommends planning approximately 1–2T cycles per canister as a starting balance and 2–5T cycles per canister before a production deployment. For the two CloudSentinels canisters (backend and frontend), budget at least 4T cycles as a starting point, with 4–10T or more providing a larger initial reserve. Actual consumption depends on traffic, storage, subnet, and configuration. Check current official guidance and balances before converting funds.

## 1. Prepare a mainnet identity

Install the current ICP CLI and the project build prerequisites using the official ICP documentation. On Windows, use WSL2 with Docker Desktop as required by the toolchain.

Create a dedicated identity locally:

```sh
icp identity new cloudsentinels-mainnet
icp identity default cloudsentinels-mainnet
icp identity principal
```

Write down the principal (it is a public identifier). Store the seed phrase offline in a secure password manager or hardware-backed recovery method. Do not paste it into ChatGPT, GitHub, issue trackers, or terminal logs.

Verify the active identity before any transaction:

```sh
icp identity whoami
icp identity principal
```

## 2. Acquire ICP and convert only the planned amount

Acquire ICP through a provider you independently trust and verify its withdrawal/network instructions. Withdraw to the principal shown by `icp identity principal`. First send a small test amount if this is your first transfer, then verify the balance:

```sh
icp token balance -n ic
```

After verifying the amount and destination, convert only the amount you intend to spend:

```sh
# Example only: this irreversibly converts 5 ICP into cycles.
icp cycles mint --icp 5 -n ic
icp cycles balance -n ic
```

Do not run the example until you have independently reviewed the amount. The ICP/XDR conversion rate changes; the CLI/CMC determines the actual cycles minted at conversion time.

## 3. Configure the first-admin bootstrap secret locally

Generate a high-entropy secret on your own machine and keep it out of source control:

```sh
mkdir -p src/backend/secrets
openssl rand -hex 32 > src/backend/secrets/admin-token
chmod 600 src/backend/secrets/admin-token
```

The `src/backend/secrets/` directory is ignored by Git. Do not put the token in `icp.yaml`, `canister.yaml`, GitHub Actions logs, a commit, or this chat.

Before deployment, configure the backend canister's `CLOUDSENTINELS_ADMIN_TOKEN` runtime environment variable using the supported ICP canister-settings mechanism from a trusted local terminal. The CLI settings interface supports environment-variable settings; never enable shell tracing (`set -x`) or paste the secret into a command literal. Confirm the configured value without printing it. The first principal that registers with the exact token becomes the initial administrator; later users register as regular users. Keep the token only until the first-admin bootstrap has been completed, then rotate/remove it from the canister settings.

## 4. Build and deploy only after funding and secret configuration

The repository now defines an explicit `production` environment in `icp.yaml`, targeting ICP mainnet and applying 90-day freezing thresholds with controller-only logs/status.

Run a clean build first:

```sh
icp build
```

Review the build output and verify that the frontend build receives the backend canister ID. Then deploy:

```sh
icp deploy -e production
```

This creates the canisters if they do not exist, so it spends cycles. Do not run it until the active identity, cycles balance, and deployment target have been checked.

After deployment, inspect both canisters:

```sh
icp canister status backend -e production
icp canister status frontend -e production
```

Record the actual IDs from the CLI output and generated `.icp/data/mappings/production.ids.json`. Canister IDs are public configuration, not secrets. Never replace them with guessed values.

## 5. Authentication acceptance tests

A successful deployment is not sufficient by itself. Verify in a real browser:

1. Open the deployed frontend canister URL and confirm Internet Identity opens.
2. Sign in with a non-anonymous principal.
3. Confirm the frontend creates an actor for the deployed backend canister and completes caller registration.
4. Confirm the first administrator has the intended Admin role.
5. Sign out, then sign in with a second independent principal and confirm it receives the regular User role.
6. Refresh the browser and confirm the session is restored.
7. Verify a regular user cannot perform an admin-only action.
8. Sign out and confirm protected workspace access is removed.
9. Repeat after a canister upgrade and verify roles and data remain intact.

The existing local-replica CI tests cover backend registration and authorization, but do not replace these browser/mainnet acceptance tests.

## 6. Operational safeguards

- Keep the owner identity as a controller. Add a separately secured backup controller only after verifying its principal and recovery process.
- Keep logs and status visibility controller-only unless there is a documented reason to expose them.
- Check cycle balances after deployment and periodically thereafter.
- Top up before the freezing threshold is reached; a frozen canister stops processing update calls.
- Do not claim production readiness until browser sign-in, session restoration, protected backend calls, role enforcement, and logout pass on the deployed canisters.

## Current status

- [x] Explicit ICP mainnet `production` environment prepared in `icp.yaml`.
- [x] 90-day freezing thresholds and controller-only log/status visibility configured for both canisters.
- [ ] Owner creates and backs up a dedicated ICP identity.
- [ ] Owner acquires ICP and mints cycles.
- [ ] Admin runtime secret is configured securely.
- [ ] Mainnet canisters are created and deployed.
- [ ] Real browser Internet Identity acceptance tests pass.
