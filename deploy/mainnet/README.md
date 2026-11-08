# CloudSentinels ICP Mainnet Deployment Preparation

> **Deployment hold:** The Clerk migration is in progress on `feat/clerk-authentication`. Do not deploy this branch to mainnet or follow the legacy Internet Identity acceptance steps until the Clerk server-side token verifier, trusted ICP gateway identity, and Motoko authorization bridge are implemented and security-tested. The current frontend intentionally fails closed after Clerk sign-in.

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

Before any transaction, confirm the selected identity name with `icp identity list` and confirm its public principal with `icp identity principal`.

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

## 3. Authentication secrets (Clerk migration pending)

Do **not** configure the legacy `CLOUDSENTINELS_ADMIN_TOKEN` as the production authentication mechanism for this migration. The current Motoko backend still uses Internet Computer principal-based access control; the Clerk gateway and its trusted canister authorization path have not yet been implemented.

When the gateway is implemented, its Clerk secret key and dedicated ICP signing identity must be stored only in the gateway's server-side secret manager. Never place either value in a `VITE_*` variable, frontend bundle, `icp.yaml`, GitHub commit, CI log, or this chat. The public Clerk publishable key is not a secret.


## 4. Build and deploy only after funding and secret configuration

The project uses the ICP CLI's implicit `ic` environment for mainnet. After deployment, explicitly apply a 90-day freezing threshold and controller-only log visibility to both canisters; status visibility remains at the controller-only default.

Run a clean build first:

```sh
icp build
```

Review the build output and verify that the frontend build receives the backend canister ID. Then deploy to the implicit mainnet environment:

```sh
icp deploy -e ic
```

Apply production resource and log settings to both canisters:

```sh
icp canister settings update backend --freezing-threshold 90d --log-visibility controllers -e ic
icp canister settings update frontend --freezing-threshold 90d --log-visibility controllers -e ic
```

Immediately after deployment, set `CLOUDSENTINELS_ADMIN_TOKEN` as described in step 3 and before the first browser login.

This creates the canisters if they do not exist, so it spends cycles. Do not run it until the active identity, cycles balance, and deployment target have been checked.

After deployment, inspect both canisters:

```sh
icp canister status backend -e ic
icp canister status frontend -e ic
```

Record the actual IDs from the CLI output and generated `.icp/data/mappings/ic.ids.json`. Canister IDs are public configuration, not secrets. Never replace them with guessed values.

## 5. Authentication acceptance tests (Clerk migration pending)

Do not consider authentication production-ready until all of the following pass in a real browser and through the deployed gateway:

1. Clerk sign-up and sign-in complete on the verified production domain.
2. The gateway verifies Clerk JWT signature, issuer, authorized party/origin, expiry, and session status server-side.
3. Missing, malformed, expired, revoked, wrong-issuer, and wrong-origin tokens are rejected.
4. The gateway uses its dedicated ICP identity; browser users never receive its signing key.
5. The Motoko backend accepts gateway-only entry points exclusively from the configured gateway principal.
6. Two distinct Clerk users cannot read or mutate each other's records.
7. A regular user cannot perform an administrator-only operation; administrator roles are sourced from trusted backend policy, not user-editable frontend metadata.
8. Direct anonymous and direct browser calls to protected canister methods are rejected.
9. Session refresh, sign-out, gateway failure, and canister upgrade behavior are tested.

The existing local-replica tests for Internet Computer principal-based registration do not validate Clerk JWT verification or the new gateway trust boundary.

## 6. Operational safeguards

- Keep the owner identity as a controller. Add a separately secured backup controller only after verifying its principal and recovery process.
- Keep logs and status visibility controller-only unless there is a documented reason to expose them.
- Check cycle balances after deployment and periodically thereafter.
- Top up before the freezing threshold is reached; a frozen canister stops processing update calls.
- Do not claim production readiness until browser sign-in, session restoration, protected backend calls, role enforcement, and logout pass on the deployed canisters.

## Current status

- [x] ICP CLI implicit `ic` mainnet environment selected; no custom environment syntax required.
- [ ] Apply 90-day freezing thresholds and controller-only log visibility to both canisters after deployment; status visibility remains controller-only by default.
- [ ] Owner creates and backs up a dedicated ICP identity.
- [ ] Owner acquires ICP and mints cycles.
- [ ] Gateway server-side Clerk and ICP secrets are configured securely.
- [ ] Mainnet canisters are created and deployed.
- [ ] Clerk server-side verifier and trusted ICP gateway are implemented and security-tested.
- [ ] Real browser and gateway-based Clerk acceptance tests pass.
