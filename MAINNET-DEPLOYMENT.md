# CloudSentinels ICP Mainnet Deployment Runbook

## Deployment target

CloudSentinels currently serves its React application and authenticated API gateway from Vercel. The gateway forwards authenticated Clerk sessions to the ICP backend canister. For this architecture, deploy **only the `backend` canister** to ICP mainnet; do not deploy the ICP `frontend` asset canister as part of this run unless the hosting architecture is deliberately changed.

The repository's `icp.yaml` lists both `src/frontend` and `src/backend`. The explicit target command below prevents an accidental deployment of both.

## Hard stop: no cycle expenditure without approval

Do not run any of these before the user approves the exact spend:
- `icp canister create backend -e ic`
- `icp deploy backend -e ic`
- `icp cycles mint ... -n ic`
- `icp cycles buy ... -n ic`
- any wallet/ledger transfer or canister top-up

Local builds, local-replica tests, configuration review, and read-only mainnet status/balance checks do not authorize cycle spending.

## Readiness gates

All gates must pass before a mainnet deployment is proposed:

1. GitHub Actions frontend and backend jobs pass on the exact commit intended for deployment.
2. The local replica smoke suite passes, including caller isolation and upgrade-persistence checks.
3. The Clerk/Vercel preview integration is configured:
   - `CLERK_SECRET_KEY` is set as a Sensitive Preview variable for the intended preview branch.
   - `CLERK_ISSUER` is the matching Clerk issuer.
   - `CLERK_AUTHORIZED_PARTIES` contains the exact Vercel preview origin(s), never a wildcard.
   - `VITE_CLERK_PUBLISHABLE_KEY` matches that Clerk instance.
   - `ICP_GATEWAY_IDENTITY_SECRET` remains unchanged; rotating it changes every user's derived ICP principal.
   - `ICP_HOST=https://icp-api.io`.
4. A dedicated deployment identity is controlled by the user. Its private key/seed must never be committed or pasted into chat.
5. The identity's mainnet cycles balance and the selected canister initial balance are checked before any create/deploy action.
6. A backup controller principal and a recovery plan are identified before production use.
7. The user approves the exact canister, initial cycles, funding source, and maximum cycle expenditure.

## Build and inspect without spending cycles

From the repository root, with the ICP CLI version pinned by the project toolchain:

```sh
icp build backend
```

Inspect the mainnet mapping before deployment:

```sh
icp canister status backend -e ic
```

If no backend canister ID exists yet, the status command may report that the canister is not mapped/created. Do not create it as part of this inspection.

Check the deployment identity's cycles balance read-only:

```sh
icp cycles balance -n ic --identity <DEPLOYMENT_IDENTITY>
```

## Cost model to present for approval

The current ICP CLI documentation describes a default initial canister balance of 2T cycles for `icp deploy`. Creating a canister through the cycles ledger also incurs a 100M-cycle ledger transaction fee. The canister creation fee and Wasm installation costs are paid from the canister's own initial balance.

For one new backend canister at the default 2T initial balance, budget at least:

- 2,000,000,000,000 cycles allocated to the new backend canister;
- 100,000,000 cycles for the cycles-ledger create transaction;
- an additional safety margin for installation and initial operation.

This is a planning estimate, not an authorization or a final quote. Confirm the exact CLI version, creation mode, canister balance, current cycle balance, and any existing canister mapping before asking for approval. If a higher initial balance is proposed, state it explicitly. Do not automatically mint or buy cycles.

## Deployment sequence — approval required before step 1

After all readiness gates pass and the user approves the exact amount:

1. Create/deploy only the backend canister using the approved initial balance, for example:

   ```sh
   icp deploy backend -e ic --cycles <USER-APPROVED-CYCLES>
   ```

2. Record the resulting backend canister ID and verify the canister status and cycle balance:

   ```sh
   icp canister status backend -e ic
   ```

3. Add the resulting `ICP_BACKEND_CANISTER_ID` to the Vercel Preview environment for the intended branch. Keep `CLERK_SECRET_KEY` server-only and Sensitive.
4. Verify the exact preview origin is included in `CLERK_AUTHORIZED_PARTIES`.
5. Run end-to-end tests against the mainnet backend using the Vercel preview and the development Clerk instance. Do not use production credentials until a production Clerk instance and production Vercel environment are separately reviewed.
6. Confirm user isolation, profile CRUD, incident CRUD, alert/metric CRUD, and restart/upgrade behavior.
7. Configure a backup controller and a production-appropriate freezing threshold only after reviewing the expected storage and compute needs.

## Current known blockers

- No backend mainnet canister ID is provisioned in the repository configuration.
- Vercel Preview is missing `CLERK_SECRET_KEY`.
- Vercel Preview is missing `ICP_BACKEND_CANISTER_ID`; this value is available only after canister creation.
- The latest backend CI failure was traced to a smoke-test fixture using a hard-coded incident ID after sample data had already consumed IDs. The test now captures the ID returned for the regular user's own incident; the fix still requires a green CI run.
- The current Clerk instance is a development instance. Mainnet backend testing can use it through a protected Preview deployment, but this is not production authentication configuration.

## Explicit approval record

No mainnet create, deploy, funding, mint, purchase, transfer, or top-up operation is authorized by this runbook. Obtain fresh explicit approval for the exact action and maximum cycle amount immediately before execution.
